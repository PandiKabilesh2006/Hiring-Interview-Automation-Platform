import { NextResponse } from "next/server";
import { getServerSession, authOptions } from "@/lib/auth";
import mammoth from "mammoth";
import { evaluateResumeGlobally } from "@/lib/ats-evaluate";

async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  try {
    const pdfParse = require("pdf-parse/lib/pdf-parse.js");
    const data = await pdfParse(buffer);
    const text = data.text?.trim() || "";
    return text || "Resume provided but could not be parsed.";
  } catch (err) {
    console.error("PDF parse failed:", err);
    return "Resume provided but could not be parsed.";
  }
}

async function extractTextFromDOC(buffer: Buffer): Promise<string> {
  try {
    const WordExtractorModule = await import("word-extractor");
    const WordExtractor = (WordExtractorModule.default || WordExtractorModule) as any;
    const extractor = new WordExtractor();
    const doc = await extractor.extract(buffer);
    const text = doc.getBody()?.trim() || "";
    return text || "Resume provided but could not be parsed.";
  } catch (err) {
    console.error("DOC parse failed:", err);
    return "Resume provided but could not be parsed.";
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const resumeFile = formData.get("resume") as File | null;

    if (!resumeFile || resumeFile.size === 0) {
      return NextResponse.json({ error: "Resume file is required" }, { status: 400 });
    }

    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (resumeFile.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "Resume file too large. Maximum size is 10MB." }, { status: 400 });
    }

    const ALLOWED_EXTENSIONS = [".pdf", ".doc", ".docx", ".txt"];
    const ext = resumeFile.name.toLowerCase().split(".").pop();
    if (!ext || !ALLOWED_EXTENSIONS.includes(`.${ext}`)) {
      return NextResponse.json({ error: "Invalid file type. Supported: PDF, DOC, DOCX, TXT." }, { status: 400 });
    }

    const arrayBuffer = await resumeFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    let resumeText = "";

    if (resumeFile.name.toLowerCase().endsWith(".pdf")) {
      resumeText = await extractTextFromPDF(buffer);
    } else if (resumeFile.name.toLowerCase().endsWith(".doc")) {
      resumeText = await extractTextFromDOC(buffer);
    } else if (resumeFile.name.toLowerCase().endsWith(".docx")) {
      const result = await mammoth.extractRawText({ buffer });
      resumeText = result.value;
    } else {
      resumeText = buffer.toString("utf-8");
    }

    if (!resumeText || resumeText.trim().length < 20) {
      return NextResponse.json(
        { error: "Could not extract text from resume. Ensure the file is not password-protected." },
        { status: 422 }
      );
    }

    const result = await evaluateResumeGlobally(resumeText);

    return NextResponse.json({
      atsScore: result.score,
      atsLabel: result.label,
      atsResult: {
        score: result.score,
        grade: result.grade,
        label: result.label,
        overall_summary: result.overall_summary,
        positives: result.positives,
        negatives: result.negatives,
        ats_summary: result.ats_summary,
      },
    });
  } catch (error: any) {
    console.error("Failed to evaluate resume globally:", error);
    const msg = error?.message || "";
    if (msg.includes("abort") || msg.includes("timeout")) {
      return NextResponse.json({ error: "ATS evaluation timed out. Please try again." }, { status: 504 });
    }
    return NextResponse.json({ error: "Failed to evaluate resume. Please try again." }, { status: 500 });
  }
}
