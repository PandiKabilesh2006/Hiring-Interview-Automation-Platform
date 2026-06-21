-- Migration 008: Add clerk_id to users and organizations
-- Run: psql -U postgres -d ai_interview_platform -f migrations/008_clerk_id.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS clerk_id VARCHAR(255) UNIQUE;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS clerk_id VARCHAR(255) UNIQUE;

CREATE INDEX IF NOT EXISTS idx_users_clerk ON users(clerk_id);
CREATE INDEX IF NOT EXISTS idx_organizations_clerk ON organizations(clerk_id);
