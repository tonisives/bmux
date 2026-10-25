CREATE TABLE IF NOT EXISTS bmux_mobile_flows (
  id_hash text PRIMARY KEY,
  state text NOT NULL,
  challenge text NOT NULL,
  redirect_uri text NOT NULL,
  expires timestamptz NOT NULL,
  code_hash text UNIQUE,
  owner text,
  code_expires timestamptz
);
CREATE TABLE IF NOT EXISTS bmux_mobile_sessions (
  id uuid PRIMARY KEY,
  owner text NOT NULL,
  expires timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bmux_mobile_access (
  token_hash text PRIMARY KEY REFERENCES bmux_logins(token_hash) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES bmux_mobile_sessions(id)
);
CREATE TABLE IF NOT EXISTS bmux_mobile_refresh (
  token_hash text PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES bmux_mobile_sessions(id),
  expires timestamptz NOT NULL,
  consumed boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS bmux_mobile_devices (
  device_id text PRIMARY KEY REFERENCES bmux_devices(id),
  session_id uuid NOT NULL REFERENCES bmux_mobile_sessions(id)
);
CREATE TABLE IF NOT EXISTS bmux_web_auth (
  token_hash text PRIMARY KEY REFERENCES bmux_logins(token_hash) ON DELETE CASCADE,
  owner text NOT NULL,
  google_reauthenticated_at timestamptz
);
CREATE TABLE IF NOT EXISTS bmux_provider_identities (
  provider text NOT NULL CHECK(provider='apple'),
  subject text NOT NULL,
  owner text NOT NULL REFERENCES bmux_accounts(owner),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider,subject),
  UNIQUE(provider,owner)
);
CREATE TABLE IF NOT EXISTS bmux_provider_flows (
  id_hash text PRIMARY KEY,
  purpose text NOT NULL CHECK(purpose IN ('apple-login','apple-link','google-reauth')),
  nonce text NOT NULL,
  owner text,
  login_hash text,
  expires timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS bmux_mobile_access_session ON bmux_mobile_access(session_id);
CREATE INDEX IF NOT EXISTS bmux_mobile_devices_session ON bmux_mobile_devices(session_id);
