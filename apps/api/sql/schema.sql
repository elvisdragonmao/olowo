-- olowo API schema. Applied by the API on startup; every statement is idempotent.
-- Not deployed yet, so this file is the single source of truth (no migrations).

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  provider_user_id bigint UNIQUE,
  roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Only SHA-256 of the opaque session cookie is stored.
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

-- The oloo JWT as an AES-256-GCM envelope (SESSION_ENCRYPTION_KEY); one per user, shared by their sessions.
CREATE TABLE IF NOT EXISTS provider_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ciphertext bytea NOT NULL,
  key_version integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Server-side ride timers (automatic return / return and reborrow).
CREATE TABLE IF NOT EXISTS scheduled_actions (
  id uuid PRIMARY KEY,
  provider_user_id bigint NOT NULL,
  ride_id bigint NOT NULL,
  scooter_id bigint NOT NULL,
  action text NOT NULL,
  trigger_at timestamptz NOT NULL,
  state text NOT NULL,
  error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS scheduled_actions_pending_idx
  ON scheduled_actions (trigger_at)
  WHERE state IN ('scheduled', 'running');

-- Idempotency-Key claims for rent / return / reservation / checkout, shared across API instances.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  provider_user_id bigint NOT NULL,
  scope text NOT NULL,
  key text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'completed', 'failed')),
  response jsonb,
  error_status integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_user_id, scope, key)
);

CREATE INDEX IF NOT EXISTS idempotency_keys_created_at_idx ON idempotency_keys (created_at);

-- Reservations and cancellations made through olowo, for the rider's recent-usage hint.
CREATE TABLE IF NOT EXISTS reservation_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_user_id bigint NOT NULL,
  action text NOT NULL CHECK (action IN ('reserve', 'cancel')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reservation_events_user_time_idx ON reservation_events (provider_user_id, created_at);
