CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE provider_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ciphertext bytea NOT NULL,
  key_version integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ride_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  provider_ride_id text NOT NULL UNIQUE,
  scooter_id text NOT NULL,
  state text NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz
);

CREATE TABLE ride_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES ride_sessions(id),
  idempotency_key uuid NOT NULL UNIQUE,
  action text NOT NULL,
  outcome text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE return_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES ride_sessions(id),
  sha256 bytea NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0),
  provider_image_id text,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cost_guards (
  ride_id uuid PRIMARY KEY REFERENCES ride_sessions(id),
  notify_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  delivered_at timestamptz
);

CREATE TABLE reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  provider_reservation_id text NOT NULL UNIQUE,
  scooter_id text NOT NULL,
  state text NOT NULL,
  starts_at timestamptz,
  expires_at timestamptz
);

CREATE TABLE audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  action text NOT NULL,
  outcome text NOT NULL,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
