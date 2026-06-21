import { pool } from "./db";

type WeightedScorecard = {
  overall?: number | null;
  combinedScore?: number | null;
  atsScore?: number | null;
};

function clampScore(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function applyAtsWeightedScore<T extends WeightedScorecard>(scorecard: T, atsScore: number | null | undefined): T {
  if (scorecard.overall == null || atsScore == null || Number.isNaN(Number(atsScore))) return scorecard;

  const interviewScore = clampScore(Number(scorecard.overall), 0, 5);
  const interviewScorePercent = (interviewScore / 5) * 100;
  const normalizedAtsScore = clampScore(Number(atsScore), 0, 100);

  scorecard.combinedScore = Math.round(0.7 * interviewScorePercent + 0.3 * normalizedAtsScore);
  scorecard.atsScore = Math.round(normalizedAtsScore);

  return scorecard;
}

export async function getRoleAtsScoreForInterview(interview: { token?: string; atsScore?: number | null }) {
  if (interview.atsScore != null) return Number(interview.atsScore);
  if (!interview.token) return null;

  const { rows } = await pool.query(
    `SELECT ae.score FROM ats_evaluations ae
     JOIN job_applications ja ON ja.ats_evaluation_id = ae.id
     JOIN interview_tokens it ON it.id = ja.interview_token_id
     WHERE it.token = $1 AND ae.is_global = false
     ORDER BY ae.created_at DESC LIMIT 1`,
    [interview.token]
  );

  return rows[0]?.score ?? null;
}

export async function applyAtsWeightedScoreForInterview<T extends WeightedScorecard>(
  scorecard: T,
  interview: { token?: string; atsScore?: number | null }
) {
  const atsScore = await getRoleAtsScoreForInterview(interview);
  return applyAtsWeightedScore(scorecard, atsScore);
}
