import { headers } from "next/headers";
import { Webhook } from "svix";
import { pool } from "@/lib/db";
import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";
const CANDIDATE_ORG_ID = "00000000-0000-0000-0000-000000000002";

export async function POST(req: Request) {
  if (!WEBHOOK_SECRET) {
    console.error("Missing CLERK_WEBHOOK_SECRET in environment variables");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  // Get the headers
  const headerPayload = headers();
  const svix_id = headerPayload.get("svix-id");
  const svix_timestamp = headerPayload.get("svix-timestamp");
  const svix_signature = headerPayload.get("svix-signature");

  // If there are no headers, error out
  if (!svix_id || !svix_timestamp || !svix_signature) {
    return NextResponse.json({ error: "Missing svix headers" }, { status: 400 });
  }

  // Get the body
  const payload = await req.json();
  const body = JSON.stringify(payload);

  // Create a new Svix instance with your secret.
  const wh = new Webhook(WEBHOOK_SECRET);

  let evt: any;

  // Verify the payload with the headers
  try {
    evt = wh.verify(body, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    });
  } catch (err) {
    console.error("Error verifying webhook:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const { id: eventId, type: eventType } = evt;
  console.log(`Received Clerk webhook event ${eventType} (id: ${eventId})`);

  try {
    if (eventType === "user.created" || eventType === "user.updated") {
      const { id: clerkUserId, email_addresses, first_name, last_name, public_metadata, unsafe_metadata } = evt.data;

      const email = email_addresses && email_addresses[0]?.email_address;
      if (!email) {
        return NextResponse.json({ error: "No email address found in user event" }, { status: 400 });
      }

      const name = `${first_name || ""} ${last_name || ""}`.trim() || email.split("@")[0];

      // Check role from metadata
      const rawRole = public_metadata?.role || unsafe_metadata?.role;
      const isCandidate = rawRole === "candidate";
      const role = isCandidate ? "candidate" : (rawRole || "interviewer");
      // 1. Check if user already exists by email (to link legacy accounts)
      const { rows: existingUserRows } = await pool.query(
        "SELECT id, org_id FROM users WHERE email = $1",
        [email]
      );

      let userUuid: string;
      let orgId: string;

      if (existingUserRows.length > 0) {
        // Legacy user exists! Link by updating clerk_id
        userUuid = existingUserRows[0].id;
        orgId = existingUserRows[0].org_id; // keep existing organization

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
            console.log(`Migrating webhook legacy user by email ${email} (${userUuid}) out of DEFAULT_ORG_ID...`);
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
        console.log(`Linked existing user ${userUuid} with Clerk ID ${clerkUserId}`);
      } else {
        // Create a new user record
        userUuid = uuidv4();
        if (isCandidate) {
          orgId = CANDIDATE_ORG_ID;
        } else {
          // Create a new organization for the new admin/interviewer!
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
        console.log(`Created new user ${userUuid} with Clerk ID ${clerkUserId}`);
      }

      // If candidate, ensure candidate_profiles exists
      if (isCandidate) {
        await pool.query(
          `INSERT INTO candidate_profiles (id, user_id)
           VALUES ($1, $2)
           ON CONFLICT (user_id) DO NOTHING`,
          [uuidv4(), userUuid]
        );
      }
    } 
    
    else if (eventType === "organization.created" || eventType === "organization.updated") {
      const { id: clerkOrgId, name, slug } = evt.data;

      // Check if organization exists by slug
      const { rows: existingOrgRows } = await pool.query(
        "SELECT id FROM organizations WHERE slug = $1",
        [slug || name.toLowerCase().replace(/[^a-z0-9]/g, "-")]
      );

      let orgUuid: string;

      if (existingOrgRows.length > 0) {
        orgUuid = existingOrgRows[0].id;
        await pool.query(
          `UPDATE organizations SET clerk_id = $1, name = $2 WHERE id = $3`,
          [clerkOrgId, name, orgUuid]
        );
        console.log(`Linked existing organization ${orgUuid} with Clerk ID ${clerkOrgId}`);
      } else {
        orgUuid = uuidv4();
        await pool.query(
          `INSERT INTO organizations (id, name, slug, clerk_id)
           VALUES ($1, $2, $3, $4)`,
          [orgUuid, name, slug || name.toLowerCase().replace(/[^a-z0-9]/g, "-"), clerkOrgId]
        );
        console.log(`Created new organization ${orgUuid} with Clerk ID ${clerkOrgId}`);
      }
    }

    else if (eventType === "organizationMembership.created") {
      const { organization, public_user_data, role: clerkRole } = evt.data;
      
      if (organization?.id && public_user_data?.user_id) {
        const clerkOrgId = organization.id;
        const clerkUserId = public_user_data.user_id;
        
        // Find DB UUIDs for the Clerk IDs
        const { rows: orgRows } = await pool.query("SELECT id FROM organizations WHERE clerk_id = $1", [clerkOrgId]);
        const { rows: userRows } = await pool.query("SELECT id FROM users WHERE clerk_id = $1", [clerkUserId]);

        if (orgRows.length > 0 && userRows.length > 0) {
          const orgUuid = orgRows[0].id;
          const userUuid = userRows[0].id;
          const role = clerkRole?.includes("admin") ? "admin" : "interviewer";

          await pool.query(
            `UPDATE users SET org_id = $1, role = $2 WHERE id = $3`,
            [orgUuid, role, userUuid]
          );

          console.log(`Synced organization membership: User ${userUuid} joined Org ${orgUuid} as ${role}`);
        }
      }
    }

    else if (eventType === "user.deleted") {
      const { id: clerkUserId } = evt.data;

      // Mark user as inactive in DB
      await pool.query(
        `UPDATE users SET is_active = false WHERE clerk_id = $1`,
        [clerkUserId]
      );

      console.log(`Marked deleted Clerk user (Clerk ID: ${clerkUserId}) as inactive in DB`);
    }

    return NextResponse.json({ success: true });
  } catch (dbErr) {
    console.error("Database sync error during webhook processing:", dbErr);
    return NextResponse.json({ error: "Failed to sync to database" }, { status: 500 });
  }
}
