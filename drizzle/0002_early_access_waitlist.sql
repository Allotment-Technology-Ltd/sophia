-- Early access waitlist (Neon Postgres)
-- Apply with: psql "$DATABASE_URL" -f drizzle/0002_early_access_waitlist.sql

CREATE TABLE IF NOT EXISTS early_access_waitlist (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_path TEXT,
  user_agent TEXT,
  CONSTRAINT early_access_waitlist_email_unique UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_early_access_waitlist_created_at
  ON early_access_waitlist (created_at DESC);
