import { getInterview, addTranscriptEntry, getProctoringViolationCount, addProctoringEvent } from "@/lib/store";
import { stripThinking, buildInterviewPrompt } from "@/lib/ai";
import { validateAccessPost } from "@/lib/auth-check";
import { rateLimit } from "@/lib/rate-limit";
import { pool } from "@/lib/db";
import { getTTSProvider } from "@/lib/providers";
import { failScoring } from "@/lib/scoring-tracker";
import { ENGLISH_ONLY_WARNING, NON_ENGLISH_TRANSCRIPT_TEXT, isLikelyEnglishSpeech, sanitizeCandidateSpeech } from "@/lib/language";

// Clean text for TTS — remove special characters that cause TTS to speak them literally
function cleanForTTS(text: string): string {
  return text
    .replace(/[*#_~`|<>{}[\]\\]/g, "") // markdown/code chars
    .replace(/\bhttps?:\/\/\S+/g, "")  // URLs
    .replace(/\b[\w.-]+@[\w.-]+\.\w+/g, "") // emails
    .replace(/(\d+)-(\w+)/g, "$1 $2")  // "30-minute" → "30 minute"
    .replace(/(\w+)-(\w+)/g, "$1 $2")  // "real-time" → "real time"
    .replace(/[()]/g, "")              // parentheses
    .replace(/[/:;]/g, " ")            // slashes colons semicolons
    .replace(/\.\.\./g, ".")           // ellipsis
    .replace(/—|–/g, ", ")             // em/en dash → comma pause
    .replace(/\n+/g, " ")              // newlines to space
    .replace(/\s{2,}/g, " ")           // collapse spaces
    .trim();
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!rateLimit(ip, 30, 60000)) {
      return new Response(JSON.stringify({ error: "Too many requests" }), { status: 429 });
    }

    const { interviewId, transcript, token, skipSave } = await req.json();
    if (!interviewId) {
      return new Response(JSON.stringify({ error: "Missing interviewId" }), { status: 400 });
    }

    if (!(await validateAccessPost(interviewId, token))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403 });
    }

    // Parallel: interview + violations + heartbeat
    const [interview, violations, hbResult] = await Promise.all([
      getInterview(interviewId),
      getProctoringViolationCount(interviewId),
      pool.query("SELECT last_heartbeat_at FROM interviews WHERE id = $1", [interviewId]),
    ]);

    if (!interview) {
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    }

    const MAX_STRIKES = parseInt(process.env.MAX_PROCTORING_STRIKES || process.env.NEXT_PUBLIC_MAX_PROCTORING_STRIKES || "5");
    console.log(`[Proctoring] Interview ${interviewId}: violations=${violations}/${MAX_STRIKES}`);
    if (violations >= MAX_STRIKES) {
      return new Response(JSON.stringify({ error: "Interview terminated" }), { status: 403 });
    }

    // Heartbeat check (fire-and-forget)
    const hbRows = hbResult.rows;
    if (hbRows.length > 0 && hbRows[0].last_heartbeat_at) {
      const elapsed = Date.now() - new Date(hbRows[0].last_heartbeat_at).getTime();
      if (elapsed > 45000) {
        addProctoringEvent(interviewId, {
          type: "heartbeat_missing", severity: "warning",
          message: `No heartbeat for ${Math.round(elapsed / 1000)}s`,
          timestamp: new Date().toISOString(),
        }).catch(() => {});
      }
    }

    // Check language of candidate's last message
    let isEnglish = true;
    const lastEntry = transcript?.length > 0 ? transcript[transcript.length - 1] : null;
    if (lastEntry && lastEntry.role === "candidate" && lastEntry.text) {
      if (!isLikelyEnglishSpeech(lastEntry.text)) {
        isEnglish = false;
      } else {
        lastEntry.text = sanitizeCandidateSpeech(lastEntry.text) || lastEntry.text;
      }
    }

    if (!isEnglish && lastEntry) {
      // Save candidate's non-English message and AI warning to DB
      if (!skipSave) {
        await addTranscriptEntry(interviewId, {
          role: "candidate",
          text: NON_ENGLISH_TRANSCRIPT_TEXT,
          timestamp: new Date().toISOString(),
        }).catch(() => {});
      }

      const warningText = ENGLISH_ONLY_WARNING;
      await addTranscriptEntry(interviewId, {
        role: "ai",
        text: warningText,
        timestamp: new Date().toISOString(),
      }).catch(() => {});

      const encoder = new TextEncoder();
      const ttsProvider = getTTSProvider();

      const stream = new ReadableStream({
        async start(controller) {
          try {
            // Stream warning text
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", text: warningText, idx: 0 })}\n\n`));

            // Stream warning audio
            const audioBuffer = await ttsProvider.synthesize(warningText);
            const audioBase64 = audioBuffer.toString("base64");
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: "audio",
              audio: audioBase64,
              contentType: ttsProvider.contentType,
              idx: 0
            })}\n\n`));

            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done", fullText: warningText, endInterview: false })}\n\n`));
            controller.close();
          } catch (err) {
            console.error("[Stream] Warning stream failed:", err);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Stream failed" })}\n\n`));
            controller.close();
          }
        }
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // Save candidate message (fire-and-forget)
    if (!skipSave && transcript?.length > 0) {
      const lastEntry = transcript[transcript.length - 1];
      if (lastEntry.role === "candidate" && lastEntry.text) {
        addTranscriptEntry(interviewId, {
          role: "candidate", text: lastEntry.text, timestamp: new Date().toISOString(),
        }).catch(() => {});
      }
    }

    // Build AI messages using full interview prompt
    const aiMessages = buildInterviewPrompt(interview, transcript || interview.transcript);

    // Stream AI response + TTS pipeline
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const ttsProvider = getTTSProvider();

    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const safeEnqueue = (data: Uint8Array) => {
          if (closed) return;
          try { controller.enqueue(data); } catch { closed = true; }
        };
        const safeClose = () => {
          if (closed) return;
          closed = true;
          try { controller.close(); } catch {}
        };
        // AI fetch with single attempt and reasonable timeout
        const startTime = Date.now();
        const makeAICall = async () => {
          const abort = new AbortController();
          // Reduced timeout from 35s to 15s for faster failure detection
          const timeout = setTimeout(() => abort.abort(), 15000);
          const model = process.env.INTERVIEW_AI_MODEL || process.env.AI_MODEL || "gpt-4o";
          console.log(`[Stream] AI call for ${interviewId} (model=${model}, messages=${aiMessages.length})`);
          try {
            const baseUrl = process.env.AI_BASE_URL || "https://api.openai.com";
            const res = await fetch(`${baseUrl}/v1/chat/completions`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${process.env.AI_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model,
                messages: aiMessages,
                max_tokens: 500,
                temperature: 0.3,
                stream: true,
                // Only send thinking param for MiniMax models (Groq/OpenAI reject it)
                ...(model.includes("minimax") ? { thinking: { type: "disabled" } } : {}),
              }),
              signal: abort.signal,
            });
            clearTimeout(timeout);
            console.log(`[Stream] AI call responded in ${Date.now() - startTime}ms (status=${res.status})`);
            return res;
          } catch (err) {
            clearTimeout(timeout);
            console.error(`[Stream] AI call failed in ${Date.now() - startTime}ms:`, (err as Error).message);
            throw err;
          }
        };

        try {
          let aiRes: Response | null = null;
          let useFallback = false;
          try {
            const response = await makeAICall();
            if (!response.ok || !response.body) {
              console.warn(`[Stream] AI returned ${response.status} for ${interviewId}, switching to local fallback.`);
              useFallback = true;
            } else {
              aiRes = response;
            }
          } catch (err) {
            console.warn(`[Stream] AI call failed for ${interviewId}, switching to local fallback:`, (err as Error).message);
            useFallback = true;
          }

          let fullText = "";
          let sentenceIdx = 0;
          const ttsPromises: Promise<void>[] = [];

          const processSentence = (sentence: string) => {
            const cleaned = stripThinking(sentence).replace(/\[END_INTERVIEW\]/g, "").trim();
            if (!cleaned) return;
            const idx = sentenceIdx++;

            // Send original text for transcript
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", text: cleaned, idx })}\n\n`));

            // Clean for TTS — remove special chars and end signal
            const ttsText = cleanForTTS(cleaned);
            if (!ttsText) return;

            // Generate TTS in parallel (client plays in order using idx)
            const p = ttsProvider.synthesize(ttsText).then((audioBuffer) => {
              const audioBase64 = audioBuffer.toString("base64");
              safeEnqueue(encoder.encode(`data: ${JSON.stringify({
                type: "audio",
                audio: audioBase64,
                contentType: ttsProvider.contentType,
                idx,
              })}\n\n`));
            }).catch((err: any) => {
              console.warn(`[Stream] TTS failed for sentence ${idx}:`, err.message);
              safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: "audio_skip", idx })}\n\n`));
            });
            ttsPromises.push(p);
          };

          if (useFallback) {
            const { getLocalInterviewerFallback } = await import("@/lib/ai");
            fullText = getLocalInterviewerFallback(interview, transcript || interview.transcript);
            console.log(`[Stream:Fallback] Simulating stream for text: "${fullText}"`);

            // Split by sentence boundaries: . ! ?
            const sentences = fullText.match(/[^.!?]+[.!?]+/g) || [fullText];
            for (const s of sentences) {
              const sentence = s.trim();
              if (sentence) processSentence(sentence);
            }
          } else {
            if (!aiRes || !aiRes.body) {
              throw new Error("AI response body is null");
            }
            const reader = aiRes.body.getReader();
            let buffer = "";
            let aiStreamBuffer = "";

            // Read AI stream
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              aiStreamBuffer += decoder.decode(value, { stream: true });
              const lines = aiStreamBuffer.split("\n");
              aiStreamBuffer = lines.pop() || "";

              for (const line of lines) {
                if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
                try {
                  const json = JSON.parse(line.slice(6));
                  const delta = json.choices?.[0]?.delta || {};
                  const token = delta.content || "";
                  if (!token) continue;
                  buffer += token;
                  fullText += token;

                  // Check for sentence boundary
                  const sentenceMatch = buffer.match(/[.!?]\s/);
                  if (sentenceMatch) {
                    const idx = sentenceMatch.index! + 1;
                    const sentence = buffer.slice(0, idx).trim();
                    buffer = buffer.slice(idx);
                    if (sentence) processSentence(sentence);
                  }
                } catch {}
              }
            }

            // Flush remaining buffer
            if (buffer.trim()) processSentence(buffer.trim());
          }

          // Wait for all parallel TTS to complete
          console.log(`[Stream] AI done for ${interviewId} in ${Date.now() - startTime}ms (${sentenceIdx} sentences, waiting for TTS...)`);
          await Promise.all(ttsPromises);
          console.log(`[Stream] TTS done for ${interviewId} in ${Date.now() - startTime}ms total`);

          // Check for [END_INTERVIEW] signal — AI decided to close
          const hasEndSignal = fullText.includes("[END_INTERVIEW]");
          const cleanedFull = stripThinking(fullText).replace(/\[END_INTERVIEW\]/g, "").trim();

          if (cleanedFull) {
            await addTranscriptEntry(interviewId, {
              role: "ai", text: cleanedFull, timestamp: new Date().toISOString(),
            });
          }

          // If AI signaled end, mark interview as completed + trigger scorecard
          if (hasEndSignal) {
            console.log(`[Stream] AI ended interview ${interviewId}`);
            // Mark completed + auto-score in background
            import("@/lib/store").then(async ({ updateInterview, getInterview }) => {
              await updateInterview(interviewId, { status: "completed", endedAt: new Date().toISOString() });
              // Generate scorecard after 3s delay (let transcript save finish)
              setTimeout(async () => {
                try {
                  const { startScoring, completeScoring, failScoring } = await import("@/lib/scoring-tracker");
                  const { generateScorecard } = await import("@/lib/ai");
                  const { normalizeScorecard } = await import("@/lib/normalize-scorecard");
                  const { applyAtsWeightedScoreForInterview } = await import("@/lib/scorecard-weighting");
                  const freshInterview = await getInterview(interviewId);
                  if (freshInterview && freshInterview.transcript.length > 0 && !freshInterview.scorecard) {
                    if (await startScoring(interviewId)) {
                      const raw = await generateScorecard(freshInterview);
                      const { parseScorecardJSON } = await import("@/lib/parse-scorecard");
                      let parsed;
                      try { parsed = parseScorecardJSON(raw); } catch (parseErr) {
                        console.error(`[Stream] Scorecard parse failed for ${interviewId}:`, parseErr);
                      }
                      if (parsed) {
                        const scorecard = normalizeScorecard(parsed);
                        await applyAtsWeightedScoreForInterview(scorecard, freshInterview);
                        await updateInterview(interviewId, { scorecard });
                        await completeScoring(interviewId);
                        console.log(`[Stream] Scorecard generated for ${interviewId}`);
                      } else {
                        await failScoring(interviewId, "Scorecard parse returned null");
                      }
                    }
                  }
                } catch (err) {
                  console.error(`[Stream] Scorecard failed for ${interviewId}:`, err);
                  await failScoring(interviewId, (err as Error).message);
                }
              }, 3000);
            }).catch((err: any) => {
              console.error(`[Stream] Scorecard background import failed for ${interviewId}:`, err?.message || err);
            });
          }

          safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: "done", fullText: cleanedFull, endInterview: hasEndSignal })}\n\n`));
          safeClose();
        } catch (err) {
          console.error("[Stream] Error:", err);
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({ error: "Stream failed" })}\n\n`));
          safeClose();
        } finally {
          // timeouts are cleared inside makeAICall
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Stream error:", error);
    return new Response(JSON.stringify({ error: "Failed" }), { status: 500 });
  }
}
