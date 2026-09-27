CREATE TABLE auth_rate_limits (
  key text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 1,
  window_started_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_security (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mfa_secret text,
  mfa_enabled boolean NOT NULL DEFAULT false,
  last_totp_step bigint NOT NULL DEFAULT -1
);
CREATE TABLE password_reset_tokens (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX password_reset_expiry ON password_reset_tokens(expires_at);
