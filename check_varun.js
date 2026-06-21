const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const envFile = path.join(__dirname, ".env.local");
const envContent = fs.readFileSync(envFile, "utf8");
const env = {};
envContent.split(/\r?\n/).forEach((line) => {
  line = line.trim();
  if (!line || line.startsWith("#")) return;
  const parts = line.split("=");
  const key = parts[0].trim();
  let val = parts.slice(1).join("=").trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  env[key] = val;
});

const CLERK_SECRET_KEY = env.CLERK_SECRET_KEY;
const DATABASE_URL = env.DATABASE_URL;

async function check() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  console.log("--- Checking user in PostgreSQL ---");
  const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", ["23bit10@wcc.edu.in"]);
  console.log("Postgres user row:", rows[0]);

  console.log("--- Checking user in Clerk ---");
  if (rows[0] && rows[0].clerk_id) {
    const clerkRes = await fetch(`https://api.clerk.com/v1/users/${rows[0].clerk_id}`, {
      headers: {
        Authorization: `Bearer ${CLERK_SECRET_KEY}`,
      },
    });
    if (clerkRes.ok) {
      const clerkUser = await clerkRes.json();
      console.log("Clerk User Details:");
      console.log("ID:", clerkUser.id);
      console.log("Email:", clerkUser.email_addresses?.[0]?.email_address);
      console.log("Public Metadata:", clerkUser.public_metadata);
      console.log("Unsafe Metadata:", clerkUser.unsafe_metadata);
    } else {
      console.log("Failed to fetch Clerk user details:", clerkRes.statusText);
    }
  } else {
    // Search by email in Clerk
    const clerkRes = await fetch(`https://api.clerk.com/v1/users?limit=100`, {
      headers: {
        Authorization: `Bearer ${CLERK_SECRET_KEY}`,
      },
    });
    if (clerkRes.ok) {
      const users = await clerkRes.json();
      const match = users.find(u => u.email_addresses?.some(e => e.email_address === "23bit10@wcc.edu.in"));
      if (match) {
        console.log("Clerk User found by email search:");
        console.log("ID:", match.id);
        console.log("Public Metadata:", match.public_metadata);
        console.log("Unsafe Metadata:", match.unsafe_metadata);
      } else {
        console.log("No matching user found in Clerk.");
      }
    }
  }

  await pool.end();
}

check().catch(console.error);
