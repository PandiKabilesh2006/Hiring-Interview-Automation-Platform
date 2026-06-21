/**
 * Global ATS resume quality evaluator.
 * Evaluates a resume on universal quality metrics — not against any specific JD.
 * Pass threshold: score >= 50
 */
export async function evaluateResumeGlobally(resumeText: string): Promise<{
  score: number;
  label: string;
  grade: string;
  overall_summary: string;
  positives: string[];
  negatives: { issue: string; advice: string }[];
  ats_summary: string;
}> {
  const aiBaseUrl = process.env.AI_BASE_URL || "https://api.openai.com";
  const aiApiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.INTERVIEW_AI_MODEL || process.env.AI_MODEL || "gpt-4o-mini";

  if (!aiApiKey) throw new Error("AI API key not configured");

  const prompt = `You are an expert ATS (Applicant Tracking System) and resume quality evaluator.
Evaluate the following resume on its GLOBAL quality — not against any specific job description.
This is a universal resume quality assessment.

Scoring criteria (total 100 points):
- Completeness (25 pts): Has contact info, summary/objective, work experience, education, and skills sections
- Impact & Achievements (30 pts): Quantified results, strong action verbs, clear demonstrations of impact
- Skills Coverage (20 pts): Technical and soft skills clearly articulated and comprehensive
- Professional Presentation (15 pts): Clear structure, appropriate length, no red flags
- Education & Credentials (10 pts): Education details, certifications, notable projects or awards

Thresholds: A=85+, B=70-84, C=55-69, D=40-54, F=0-39
Pass threshold: 50 (candidates below 50 are not qualified)

RESUME:
${resumeText.substring(0, 5000)}

Return ONLY valid JSON (no markdown, no code fences, no explanation):
{
  "score": <integer 0-100>,
  "grade": "<single letter A/B/C/D/F>",
  "overall_summary": "<2-3 sentence assessment of the resume's overall quality and readiness>",
  "positives": [
    "<specific strength of the resume — e.g. 'Quantified achievements with specific metrics like 40% performance improvement'>",
    "<another pro — max 4 total>"
  ],
  "negatives": [
    {
      "issue": "<specific gap or weakness — e.g. 'No professional summary section'>",
      "advice": "<concrete, actionable advice — e.g. 'Add a 2-3 sentence professional summary stating your role, key skills, and career goal'>"
    }
  ],
  "ats_summary": "<A comprehensive 3-5 sentence ATS-focused summary: what the resume communicates to an ATS parser, what keywords and skills are visible, how well it will parse and rank, and an overall hiring-readiness assessment>"
}

Guidelines:
- positives: 3-4 specific, concrete pros of the resume as written
- negatives: 2-4 issues, each paired with specific actionable advice — real improvements, not generic
- ats_summary: write as if you are the ATS system summarizing what it sees — technical, specific, honest`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(`${aiBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are an expert ATS resume quality evaluator. Always return valid JSON only. Never include markdown or code blocks in your response.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 1200,
        temperature: 0.1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`AI API error: ${res.status} ${errText}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Strip any accidental markdown fences
    const cleaned = content.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    const parsed = JSON.parse(cleaned);

    const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
    const grade =
      parsed.grade ||
      (score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F");

    // Normalise negatives — handle both string[] and {issue,advice}[] from the model
    const rawNegatives: any[] = Array.isArray(parsed.negatives) ? parsed.negatives : [];
    const negatives = rawNegatives.map((n: any) =>
      typeof n === "string"
        ? { issue: n, advice: "Review and improve this area of your resume." }
        : { issue: n.issue || n.problem || "", advice: n.advice || n.suggestion || "" }
    );

    return {
      score,
      label: score >= 50 ? "Pass" : "Reject",
      grade,
      overall_summary: parsed.overall_summary || "",
      positives: Array.isArray(parsed.positives) ? parsed.positives : [],
      negatives,
      ats_summary: parsed.ats_summary || parsed.overall_summary || "",
    };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}
