import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // 1. Check local database first
    const { rows } = await pool.query("SELECT role FROM users WHERE email = $1", [normalizedEmail]);
    if (rows.length > 0) {
      return NextResponse.json({ role: rows[0].role });
    }

    // 2. Fallback to Clerk API if user exists in Clerk but not synced yet
    if (process.env.CLERK_SECRET_KEY) {
      const clerkRes = await fetch(
        `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(normalizedEmail)}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
          },
        }
      );

      if (clerkRes.ok) {
        const clerkUsers = await clerkRes.json();
        if (Array.isArray(clerkUsers) && clerkUsers.length > 0) {
          const clerkUser = clerkUsers[0];
          const rawRole = clerkUser.public_metadata?.role || clerkUser.unsafe_metadata?.role;
          const isCandidate = rawRole === "candidate";
          const role = isCandidate ? "candidate" : (rawRole || "interviewer");
          return NextResponse.json({ role });
        }
      }
    }

    return NextResponse.json({ role: null });
  } catch (err) {
    console.error("[check-role:POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
