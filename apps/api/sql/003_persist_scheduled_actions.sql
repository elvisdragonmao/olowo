CREATE TABLE IF NOT EXISTS scheduled_actions (
  id uuid PRIMARY KEY,
  provider_user_id bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ride', 'reservation')),
  ride_id bigint,
  scooter_id bigint NOT NULL,
  engine_license_number text,
  action text,
  trigger_at timestamptz NOT NULL,
  state text NOT NULL,
  error text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS scheduled_actions_pending_idx
  ON scheduled_actions (trigger_at)
  WHERE state IN ('scheduled', 'running');
