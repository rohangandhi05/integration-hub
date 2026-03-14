-- Integration Hub Database Schema
-- Run automatically on first postgres container start

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Core events table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_service  VARCHAR(50) NOT NULL,
  target_service  VARCHAR(50) NOT NULL,
  event_type      VARCHAR(100) NOT NULL,
  payload_in      JSONB,
  payload_out     JSONB,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','success','failed','dead_letter')),
  error_message   TEXT,
  retry_count     INT         NOT NULL DEFAULT 0,
  message_id      VARCHAR(255) UNIQUE,
  pgp_signed      BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_status      ON integration_events(status);
CREATE INDEX idx_events_created_at  ON integration_events(created_at DESC);
CREATE INDEX idx_events_source      ON integration_events(source_service);
CREATE INDEX idx_events_event_type  ON integration_events(event_type);

-- ─── Field mapping config ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS field_mappings (
  id            SERIAL      PRIMARY KEY,
  source_format VARCHAR(20) NOT NULL,
  target_format VARCHAR(20) NOT NULL,
  source_path   VARCHAR(200) NOT NULL,
  target_path   VARCHAR(200) NOT NULL,
  transform_fn  VARCHAR(50),
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── API keys table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id          SERIAL      PRIMARY KEY,
  key_hash    VARCHAR(64) UNIQUE NOT NULL,
  label       VARCHAR(100),
  rate_limit  INT         NOT NULL DEFAULT 100,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  last_used   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Dead letter queue ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dead_letters (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  original_event  UUID        REFERENCES integration_events(id),
  queue_name      VARCHAR(100),
  raw_payload     JSONB,
  failure_reason  TEXT,
  retry_count     INT         NOT NULL DEFAULT 0,
  resolved        BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Auto-update updated_at ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_events_updated_at
  BEFORE UPDATE ON integration_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Seed field mappings ──────────────────────────────────────────────────────
INSERT INTO field_mappings (source_format, target_format, source_path, target_path, transform_fn) VALUES
  ('xml', 'json', 'employee.id',         'employeeId',      NULL),
  ('xml', 'json', 'employee.name',       'fullName',        'trim'),
  ('xml', 'json', 'employee.department', 'department',      'uppercase'),
  ('xml', 'json', 'employee.startDate',  'startDate',       'iso_date'),
  ('xml', 'json', 'employee.salary',     'baseSalary',      'parse_float'),
  ('xml', 'json', 'employee.status',     'employmentStatus','lowercase');
