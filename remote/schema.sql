CREATE TABLE IF NOT EXISTS bmux_services (
  id text PRIMARY KEY,
  owner text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  public_key jsonb NOT NULL,
  revoked boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS bmux_devices (
  id text PRIMARY KEY,
  owner text NOT NULL,
  public_key jsonb NOT NULL,
  revoked boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS bmux_logins (
  token_hash text PRIMARY KEY,
  owner text NOT NULL,
  expires timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS bmux_usage (
  service text NOT NULL REFERENCES bmux_services(id),
  host text NOT NULL,
  generation text NOT NULL,
  sequence bigint NOT NULL,
  day date NOT NULL DEFAULT CURRENT_DATE,
  recorded timestamptz NOT NULL DEFAULT now(),
  started bigint NOT NULL,
  succeeded bigint NOT NULL,
  failed bigint NOT NULL,
  active integer NOT NULL,
  browser_ms bigint NOT NULL,
  PRIMARY KEY (service, host, generation, day)
);
CREATE INDEX IF NOT EXISTS bmux_usage_recorded ON bmux_usage(recorded);
