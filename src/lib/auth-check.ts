import { auth } from "@clerk/nextjs/server";
import { pool } from "./db";
import { getOrSyncUser } from "./auth";

/**
 * Validates either: logged-in Clerk session OR valid interview token.
 * Returns the session if authenticated, or null if unauthorized.
 */
export async function validateAccess(req: Request, interviewId: string): Promise<{ authorized: boolean; session: any }> {
  // Check Clerk session first
  const { userId } = auth();
  
  if (userId) {
    // Fetch user details from local database by clerk_id (auto-syncing if missing)
    const user = await getOrSyncUser(userId);

    if (user) {
      if (user.role !== "candidate") {
        // Verify interview belongs to user's org
        const { rows: interviewRows } = await pool.query(
          "SELECT org_id FROM interviews WHERE id = $1", 
          [interviewId]
        );
        if (
          interviewRows.length > 0 && 
          interviewRows[0].org_id && 
          user.org_id && 
          interviewRows[0].org_id !== user.org_id
        ) {
          return { authorized: false, session: null };
        }
        return {
          authorized: true,
          session: {
            user: {
              id: user.id,
              email: user.email,
              name: user.name,
              role: user.role,
              orgId: user.org_id,
              orgName: user.org_name,
            }
          }
        };
      }
    }
  }

  // Check token (candidate)
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (token) {
    const { rows } = await pool.query(
      "SELECT id FROM interviews WHERE id = $1 AND token = $2", 
      [interviewId, token]
    );
    if (rows.length > 0) return { authorized: true, session: null };
  }

  return { authorized: false, session: null };
}

/**
 * Validates that interviewId exists in the database.
 */
export async function validateInterviewExists(interviewId: string): Promise<boolean> {
  const { rows } = await pool.query("SELECT id FROM interviews WHERE id = $1", [interviewId]);
  return rows.length > 0;
}

/**
 * Validates access for POST endpoints: checks session OR interview token from request body.
 */
export async function validateAccessPost(interviewId: string, token?: string): Promise<boolean> {
  const { userId } = auth();

  if (userId) {
    const user = await getOrSyncUser(userId);

    if (user) {
      if (user.role !== "candidate") {
        // Verify interview belongs to user's org
        const { rows: interviewRows } = await pool.query(
          "SELECT org_id FROM interviews WHERE id = $1", 
          [interviewId]
        );
        if (
          interviewRows.length > 0 && 
          interviewRows[0].org_id && 
          user.org_id && 
          interviewRows[0].org_id !== user.org_id
        ) {
          return false;
        }
        return true;
      }
    }
  }

  // Check token (candidate)
  if (token) {
    const { rows } = await pool.query(
      "SELECT id FROM interviews WHERE id = $1 AND token = $2", 
      [interviewId, token]
    );
    if (rows.length > 0) return true;
  }

  return false;
}
