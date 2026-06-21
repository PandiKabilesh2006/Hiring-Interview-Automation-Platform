const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

// Read and parse env file
const envFile = path.join(__dirname, ".env.local");
if (!fs.existsSync(envFile)) {
  console.error(".env.local file not found at " + envFile);
  process.exit(1);
}

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

if (!CLERK_SECRET_KEY) {
  console.error("CLERK_SECRET_KEY is missing in .env.local");
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error("DATABASE_URL is missing in .env.local");
  process.exit(1);
}

async function clearClerk() {
  console.log("----------------------------------------");
  console.log("Clearing Clerk Users...");
  console.log("----------------------------------------");
  
  let hasMore = true;
  
  while (hasMore) {
    const url = `https://api.clerk.com/v1/users?limit=100`;
    const usersRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${CLERK_SECRET_KEY}`,
      },
    });
    
    if (!usersRes.ok) {
      throw new Error(`Failed to fetch Clerk users: ${usersRes.statusText}`);
    }
    
    const users = await usersRes.json();
    if (users.length === 0) {
      console.log("No users found in Clerk.");
      hasMore = false;
      break;
    }
    
    for (const user of users) {
      const email = user.email_addresses?.[0]?.email_address || "no-email";
      console.log(`Deleting Clerk user: ${user.id} (${email})...`);
      const delRes = await fetch(`https://api.clerk.com/v1/users/${user.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${CLERK_SECRET_KEY}`,
        },
      });
      if (!delRes.ok) {
        console.error(`Failed to delete user ${user.id}: ${delRes.statusText}`);
      } else {
        console.log(`Deleted user ${user.id}`);
      }
    }
    
    if (users.length < 100) {
      hasMore = false;
    }
  }

  console.log("----------------------------------------");
  console.log("Clearing Clerk Organizations...");
  console.log("----------------------------------------");
  
  let orgsHasMore = true;
  try {
    while (orgsHasMore) {
      const orgsRes = await fetch("https://api.clerk.com/v1/organizations?limit=100", {
        headers: {
          Authorization: `Bearer ${CLERK_SECRET_KEY}`,
        },
      });
      
      if (!orgsRes.ok) {
        if (orgsRes.status === 403) {
          console.warn("Organizations feature is disabled or Forbidden in Clerk configuration. Skipping organization clearing.");
          orgsHasMore = false;
          break;
        }
        throw new Error(`Failed to fetch Clerk organizations: ${orgsRes.statusText}`);
      }
      
      const orgs = await orgsRes.json();
      if (orgs.length === 0) {
        console.log("No organizations found in Clerk.");
        orgsHasMore = false;
        break;
      }
      
      for (const org of orgs) {
        console.log(`Deleting Clerk organization: ${org.id} (${org.name})...`);
        const delRes = await fetch(`https://api.clerk.com/v1/organizations/${org.id}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${CLERK_SECRET_KEY}`,
          },
        });
        if (!delRes.ok) {
          console.error(`Failed to delete organization ${org.id}: ${delRes.statusText}`);
        } else {
          console.log(`Deleted organization ${org.id}`);
        }
      }
      
      if (orgs.length < 100) {
        orgsHasMore = false;
      }
    }
  } catch (err) {
    console.warn("Unable to clear Clerk organizations:", err.message);
  }
}

async function clearPostgres() {
  console.log("----------------------------------------");
  console.log("Clearing PostgreSQL Database...");
  console.log("----------------------------------------");
  
  const pool = new Pool({ connectionString: DATABASE_URL });
  
  try {
    console.log("Running TRUNCATE query...");
    await pool.query(`
      TRUNCATE TABLE
        proctoring_events,
        transcript_entries,
        interviews,
        candidate_profiles,
        job_applications,
        interview_tokens,
        ats_evaluations,
        jobs,
        users,
        organizations
      CASCADE;
    `);
    console.log("All data tables truncated successfully.");
    
    console.log("Re-seeding default organizations...");
    await pool.query(`
      INSERT INTO organizations (id, name, slug)
      VALUES 
        ('00000000-0000-0000-0000-000000000001', 'NammaYatri', 'nammayatri'),
        ('00000000-0000-0000-0000-000000000002', 'Candidate Portal', 'candidate-portal')
      ON CONFLICT (id) DO NOTHING;
    `);
    console.log("Seeding complete.");
  } catch (err) {
    console.error("Database error:", err);
    throw err;
  } finally {
    await pool.end();
  }
}

async function main() {
  try {
    await clearClerk();
    await clearPostgres();
    console.log("----------------------------------------");
    console.log("System successfully reset to initial clean state!");
    console.log("----------------------------------------");
  } catch (error) {
    console.error("Reset failed:", error);
    process.exit(1);
  }
}

main();
