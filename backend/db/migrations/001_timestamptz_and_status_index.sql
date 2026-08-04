-- Migration: convert timestamp columns to TIMESTAMPTZ and replace the
-- bare status index with a composite (status, created_at) index.
--
-- schema.sql uses `CREATE TABLE IF NOT EXISTS`, so it only affects a
-- fresh database — it will never alter columns on a database that
-- already has these tables. Run this migration once against any
-- existing database (local or production) to bring it in line with
-- the current schema.sql. Safe to run more than once.
--
-- Usage: psql "$DATABASE_URL" -f backend/db/migrations/001_timestamptz_and_status_index.sql

ALTER TABLE leads
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE follow_ups
  ALTER COLUMN scheduled_at TYPE TIMESTAMPTZ USING scheduled_at AT TIME ZONE 'UTC',
  ALTER COLUMN completed_at TYPE TIMESTAMPTZ USING completed_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

DROP INDEX IF EXISTS idx_leads_status;
CREATE INDEX IF NOT EXISTS idx_leads_status_created_at ON leads(status, created_at DESC);
