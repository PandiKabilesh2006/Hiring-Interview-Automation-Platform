import { auth } from "@clerk/nextjs/server";
import { pool } from "./db";
import { v4 as uuidv4 } from "uuid";

// Dummy authOptions to prevent import errors in existing code
export const authOptions = {};

/**
 * Gets the user from the database or dynamically syncs from Clerk if not found.
 */
export async function getOrSyncUser(clerkUserId: string) {
  // Try to find user in DB
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name, u.role, u.org_id, o.name as org_name
     FROM users u
     JOIN organizations o ON u.org_id = o.id
     WHERE u.clerk_id = $1`,
    [clerkUserId]
  );

  if (rows.length > 0) {
    const user = rows[0];
    const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";
    if (user.role !== "candidate" && user.org_id === DEFAULT_ORG_ID) {
      // Check if they have created any jobs or interviews
      const { rows: jobsRows } = await pool.query(
        "SELECT 1 FROM jobs WHERE created_by = $1",
        [user.id]
      );
      const { rows: interviewsRows } = await pool.query(
        "SELECT 1 FROM interviews WHERE created_by = $1",
        [user.id]
      );
      if (jobsRows.length === 0 && interviewsRows.length === 0) {
        console.log(`Migrating legacy user ${user.email} (${user.id}) out of DEFAULT_ORG_ID...`);
        const newOrgId = uuidv4();
        const orgSlug = `org-${user.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${Math.random().toString(36).substring(2, 8)}`;
        const orgName = "NammaYatri";
        await pool.query(
          `INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)`,
          [newOrgId, orgName, orgSlug]
        );
        await pool.query(
          `UPDATE users SET org_id = $1 WHERE id = $2`,
          [newOrgId, user.id]
        );
        // Refetch user with new organization
        const { rows: refetchedRows } = await pool.query(
          `SELECT u.id, u.email, u.name, u.role, u.org_id, o.name as org_name
           FROM users u
           JOIN organizations o ON u.org_id = o.id
           WHERE u.id = $1`,
          [user.id]
        );
        if (refetchedRows.length > 0) {
          return refetchedRows[0];
        }
      }
    }
    return rows[0];
  }

  // User doesn't exist in local database. Let's sync them dynamically!
  console.log(`User ${clerkUserId} not found in database. Syncing from Clerk...`);
  
  if (!process.env.CLERK_SECRET_KEY) {
    console.error("CLERK_SECRET_KEY is missing in env. Cannot sync user dynamically.");
    return null;
  }

  try {
    const clerkRes = await fetch(`https://api.clerk.com/v1/users/${clerkUserId}`, {
      headers: {
        Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
      },
    });

    if (!clerkRes.ok) {
      console.error(`Failed to fetch user from Clerk API: ${clerkRes.status} ${clerkRes.statusText}`);
      return null;
    }

    const clerkUser = await clerkRes.json();
    const email = clerkUser.email_addresses?.[0]?.email_address;
    if (!email) {
      console.error("No email address found for Clerk user");
      return null;
    }

    const name = `${clerkUser.first_name || ""} ${clerkUser.last_name || ""}`.trim() || email.split("@")[0];
    const rawRole = clerkUser.public_metadata?.role || clerkUser.unsafe_metadata?.role;
    const isCandidate = rawRole === "candidate";
    const role = isCandidate ? "candidate" : (rawRole || "interviewer");
    
    const CANDIDATE_ORG_ID = "00000000-0000-0000-0000-000000000002";

    // Check if a user with this email already exists but lacks clerk_id (e.g. legacy DB row)
    const { rows: existingEmailRows } = await pool.query(
      "SELECT id, org_id FROM users WHERE email = $1",
      [email]
    );

    let userUuid: string;
    let orgId: string;

    if (existingEmailRows.length > 0) {
      userUuid = existingEmailRows[0].id;
      orgId = existingEmailRows[0].org_id; // keep existing organization

      const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";
      if (role !== "candidate" && orgId === DEFAULT_ORG_ID) {
        // Check if they have created any jobs or interviews
        const { rows: jobsRows } = await pool.query(
          "SELECT 1 FROM jobs WHERE created_by = $1",
          [userUuid]
        );
        const { rows: interviewsRows } = await pool.query(
          "SELECT 1 FROM interviews WHERE created_by = $1",
          [userUuid]
        );
        if (jobsRows.length === 0 && interviewsRows.length === 0) {
          console.log(`Migrating legacy user by email ${email} (${userUuid}) out of DEFAULT_ORG_ID...`);
          const newOrgId = uuidv4();
          const orgSlug = `org-${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${Math.random().toString(36).substring(2, 8)}`;
          const orgName = "NammaYatri";
          await pool.query(
            `INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)`,
            [newOrgId, orgName, orgSlug]
          );
          orgId = newOrgId;
        }
      }

      await pool.query(
        `UPDATE users 
         SET clerk_id = $1, name = $2, role = $3, org_id = $4, is_active = true 
         WHERE id = $5`,
        [clerkUserId, name, role, orgId, userUuid]
      );
      console.log(`Linked existing user email ${email} to Clerk ID ${clerkUserId}`);
    } else {
      userUuid = uuidv4();
      if (isCandidate) {
        orgId = CANDIDATE_ORG_ID;
      } else {
        // Dynamically create a brand new organization for the new admin/interviewer
        orgId = uuidv4();
        const orgSlug = `org-${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${Math.random().toString(36).substring(2, 8)}`;
        const orgName = "NammaYatri";
        await pool.query(
          `INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)`,
          [orgId, orgName, orgSlug]
        );
        console.log(`Created new organization "${orgName}" (${orgId}) for new admin`);
      }

      await pool.query(
        `INSERT INTO users (id, org_id, email, name, password_hash, role, is_active, clerk_id)
         VALUES ($1, $2, $3, $4, '', $5, true, $6)`,
        [userUuid, orgId, email, name, role, clerkUserId]
      );
      console.log(`Synced new user ${userUuid} with Clerk ID ${clerkUserId}`);
    }

    if (isCandidate) {
      await pool.query(
        `INSERT INTO candidate_profiles (id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO NOTHING`,
        [uuidv4(), userUuid]
      );
    }

    // Re-run the query
    const refetched = await pool.query(
      `SELECT u.id, u.email, u.name, u.role, u.org_id, o.name as org_name
       FROM users u
       JOIN organizations o ON u.org_id = o.id
       WHERE u.clerk_id = $1`,
      [clerkUserId]
    );
    
    return refetched.rows[0] || null;
  } catch (error: any) {
    if (error?.code === "23505" || error?.constraint === "users_clerk_id_key") {
      console.log(`User ${clerkUserId} was synced concurrently by another request. Fetching from database...`);
      try {
        const refetched = await pool.query(
          `SELECT u.id, u.email, u.name, u.role, u.org_id, o.name as org_name
           FROM users u
           JOIN organizations o ON u.org_id = o.id
           WHERE u.clerk_id = $1`,
          [clerkUserId]
        );
        if (refetched.rows.length > 0) {
          return refetched.rows[0];
        }
      } catch (refetchError) {
        console.error("Error refetching concurrently synced user:", refetchError);
      }
    }
    console.error("Error syncing user from Clerk dynamically:", error);
    return null;
  }
}

/**
 * Custom getServerSession that retrieves the current session using Clerk,
 * querying the PostgreSQL database to match NextAuth's return format.
 */
export async function getServerSession(options?: any) {
  const { userId } = auth();
  if (!userId) return null;

  try {
    const user = await getOrSyncUser(userId);
    if (!user) return null;

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        orgId: user.org_id,
        orgName: user.org_name,
      },
    };
  } catch (error) {
    console.error("Error retrieving user session via Clerk:", error);
    return null;
  }
}
