import { NextResponse } from "next/server";
import { getInterview, addTranscriptEntry, getProctoringViolationCount, updateInterview } from "@/lib/store";
import { getAIResponse } from "@/lib/ai";
import { rateLimit } from "@/lib/rate-limit";
import { validateAccessPost } from "@/lib/auth-check";
import { pool } from "@/lib/db";
import { ENGLISH_ONLY_WARNING, NON_ENGLISH_TRANSCRIPT_TEXT, isLikelyEnglishSpeech, sanitizeCandidateSpeech } from "@/lib/language";

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!rateLimit(ip, 30, 60000)) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const { interviewId, transcript, token } = await req.json();

    if (!interviewId) {
      return NextResponse.json({ error: "Missing interviewId" }, { status: 400 });
    }

    if (!(await validateAccessPost(interviewId, token))) {
      return NextResponse.json({ error: "Invalid interview" }, { status: 403 });
    }

    const interview = await getInterview(interviewId);
    if (!interview) {
      return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    }

    // Server-side proctoring enforcement
    const MAX_STRIKES = parseInt(process.env.MAX_PROCTORING_STRIKES || process.env.NEXT_PUBLIC_MAX_PROCTORING_STRIKES || "5");
    const violations = await getProctoringViolationCount(interviewId);
    if (violations >= MAX_STRIKES) {
      await updateInterview(interviewId, { status: "completed", endedAt: new Date().toISOString() });
      return NextResponse.json({ error: "Interview terminated due to proctoring violations" }, { status: 403 });
    }

    // Check proctoring heartbeat — flag if no heartbeat for >45s
    const { rows: hbRows } = await pool.query(
      "SELECT last_heartbeat_at FROM interviews WHERE id = $1",
      [interviewId]
    );
    if (hbRows.length > 0 && hbRows[0].last_heartbeat_at) {
      const lastHb = new Date(hbRows[0].last_heartbeat_at).getTime();
      const elapsed = Date.now() - lastHb;
      if (elapsed > 45000) {
        // Heartbeat missing — proctoring may be disabled, log it
        const { addProctoringEvent } = await import("@/lib/store");
        await addProctoringEvent(interviewId, {
          type: "heartbeat_missing",
          severity: "warning",
          message: `No proctoring heartbeat for ${Math.round(elapsed / 1000)}s`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    const lastEntry = transcript?.length > 0 ? transcript[transcript.length - 1] : null;
    if (lastEntry?.role === "candidate" && lastEntry.text && !isLikelyEnglishSpeech(lastEntry.text)) {
      await addTranscriptEntry(interviewId, {
        role: "candidate",
        text: NON_ENGLISH_TRANSCRIPT_TEXT,
        timestamp: new Date().toISOString(),
      });
      await addTranscriptEntry(interviewId, {
        role: "ai",
        text: ENGLISH_ONLY_WARNING,
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json({ text: ENGLISH_ONLY_WARNING, endInterview: false });
    }
    if (lastEntry?.role === "candidate" && lastEntry.text) {
      lastEntry.text = sanitizeCandidateSpeech(lastEntry.text) || lastEntry.text;
    }

    // Save the latest candidate message if present in transcript
    if (transcript?.length > 0) {
      if (lastEntry?.role === "candidate" && lastEntry.text) {
        await addTranscriptEntry(interviewId, {
          role: "candidate",
          text: lastEntry.text,
          timestamp: new Date().toISOString(),
        });
      }
    }

    const aiRaw = await getAIResponse(interview, transcript ?? interview.transcript);
    const hasEndSignal = aiRaw.includes("[END_INTERVIEW]");
    const aiResponse = aiRaw.replace(/\[END_INTERVIEW\]/g, "").trim();

    await addTranscriptEntry(interviewId, {
      role: "ai",
      text: aiResponse,
      timestamp: new Date().toISOString(),
    });

    if (hasEndSignal) {
      await updateInterview(interviewId, { status: "completed", endedAt: new Date().toISOString() });
    }

    return NextResponse.json({ text: aiResponse, endInterview: hasEndSignal });
  } catch (error) {
    console.error("AI response error:", error);
    return NextResponse.json({ error: "Failed to get AI response" }, { status: 500 });
  }
}
