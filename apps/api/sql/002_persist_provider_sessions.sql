ALTER TABLE users
  ADD COLUMN IF NOT EXISTS provider_user_id bigint,
  ADD COLUMN IF NOT EXISTS roles jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS users_provider_user_id_unique
  ON users (provider_user_id)
  WHERE provider_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);
