import { NextResponse } from "next/server";
import { getServerSession, authOptions } from "@/lib/auth";
import { pool } from "@/lib/db";

const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY || "ats-internal-key";
const BASE_URL = process.env.NEXTAUTH_URL || "http://localhost:3000";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session.user as { id: string; role: string };
    if (user.role !== "candidate") return NextResponse.json({ error: "Candidates only" }, { status: 403 });

    await pool.query("ALTER TABLE candidate_profiles ADD COLUMN IF NOT EXISTS resume_base64 TEXT;");

    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.name, cp.*
       FROM users u
       LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
       WHERE u.id = $1`,
      [user.id]
    );

    if (rows.length === 0) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    return NextResponse.json({ profile: rows[0] });
  } catch (err) {
    console.error("[CandidateProfile:GET]", err);
    return NextResponse.json({ error: "Failed to fetch profile" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session.user as { id: string; name: string; email: string; role: string };
    if (user.role !== "candidate") return NextResponse.json({ error: "Candidates only" }, { status: 403 });

    await pool.query("ALTER TABLE candidate_profiles ADD COLUMN IF NOT EXISTS resume_base64 TEXT;");

    const body = await req.json();
    const { resumeText, resumeFilename, resumeBase64, phone, linkedin_url, portfolio_url, bio, recomputeAts } = body;

    // Upsert profile fields
    await pool.query(
      `INSERT INTO candidate_profiles (id, user_id, resume_text, resume_filename, resume_base64, phone, linkedin_url, portfolio_url, bio, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         resume_text     = EXCLUDED.resume_text,
         resume_filename = EXCLUDED.resume_filename,
         resume_base64   = EXCLUDED.resume_base64,
         phone           = EXCLUDED.phone,
         linkedin_url    = EXCLUDED.linkedin_url,
         portfolio_url   = EXCLUDED.portfolio_url,
         bio             = EXCLUDED.bio,
         global_ats_score = CASE WHEN EXCLUDED.resume_text IS NULL THEN NULL ELSE candidate_profiles.global_ats_score END,
         global_ats_label = CASE WHEN EXCLUDED.resume_text IS NULL THEN NULL ELSE candidate_profiles.global_ats_label END,
         global_ats_result = CASE WHEN EXCLUDED.resume_text IS NULL THEN NULL ELSE candidate_profiles.global_ats_result END,
         global_ats_updated_at = CASE WHEN EXCLUDED.resume_text IS NULL THEN NULL ELSE candidate_profiles.global_ats_updated_at END,
         updated_at      = NOW()`,
      [user.id, resumeText || null, resumeFilename || null, resumeBase64 || null, phone || null, linkedin_url || null, portfolio_url || null, bio || null]
    );

    // Also update user name if provided
    if (body.name && body.name !== user.name) {
      await pool.query("UPDATE users SET name=$1 WHERE id=$2", [body.name, user.id]);
    }

    let globalAts = null;

    // Call ATS Service to compute global score when resume is provided
    if (resumeText && recomputeAts !== false) {
      try {
        const atsRes = await fetch(`${BASE_URL}/api/services/ats/global`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-key": INTERNAL_KEY,
          },
          body: JSON.stringify({ resumeText, candidateId: user.id }),
        });
        if (atsRes.ok) {
          globalAts = await atsRes.json();
        }
      } catch (e) {
        console.error("[CandidateProfile] ATS global scoring failed:", e);
      }
    }

    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.name, cp.*
       FROM users u LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
       WHERE u.id = $1`,
      [user.id]
    );

    return NextResponse.json({ profile: rows[0], globalAts });
  } catch (err) {
    console.error("[CandidateProfile:POST]", err);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}
