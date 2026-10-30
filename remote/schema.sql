CREATE TABLE IF NOT EXISTS bmux_services (
  id text PRIMARY KEY,
  owner text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  public_key jsonb,
  revoked boolean NOT NULL DEFAULT false
);
ALTER TABLE bmux_services ALTER COLUMN public_key DROP NOT NULL;
CREATE TABLE IF NOT EXISTS bmux_grants (
  service text NOT NULL REFERENCES bmux_services(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  permission text NOT NULL CHECK (permission IN ('watch', 'control')),
  PRIMARY KEY (service, user_id)
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
CREATE TABLE IF NOT EXISTS bmux_accounts (
  owner text PRIMARY KEY,
  email text NOT NULL,
  name text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bmux_entitlements (
  owner text PRIMARY KEY,
  expires timestamptz NOT NULL,
  max_streams integer NOT NULL CHECK (max_streams BETWEEN 1 AND 100),
  source text NOT NULL DEFAULT 'stripe'
);
CREATE TABLE IF NOT EXISTS bmux_host_presence (
  host text PRIMARY KEY,
  service text NOT NULL REFERENCES bmux_services(id),
  generation text NOT NULL,
  connected boolean NOT NULL DEFAULT true,
  seen timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bmux_stream_leases (
  connection text PRIMARY KEY,
  owner text NOT NULL,
  host text NOT NULL,
  generation text NOT NULL,
  viewer text NOT NULL,
  pane text NOT NULL,
  expires timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS bmux_stream_leases_owner ON bmux_stream_leases(owner,expires);
CREATE TABLE IF NOT EXISTS bmux_attention (
  id uuid PRIMARY KEY,
  owner text NOT NULL,
  service text NOT NULL REFERENCES bmux_services(id),
  host text NOT NULL,
  generation text NOT NULL,
  session text NOT NULL,
  pane text NOT NULL,
  episode text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('help','challenge','account-warning','rate-limit')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE(service,host,generation,episode)
);
CREATE TABLE IF NOT EXISTS bmux_push_devices (
  owner text NOT NULL,
  device text NOT NULL,
  token text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY(owner,device)
);
CREATE TABLE IF NOT EXISTS bmux_push_outbox (
  attention_id uuid NOT NULL REFERENCES bmux_attention(id),
  owner text NOT NULL,
  device text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  receipt_id text,
  token_hash text,
  sent_at timestamptz,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(attention_id,owner,device)
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
ALTER TABLE bmux_attention ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE bmux_attention ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE bmux_attention ADD COLUMN IF NOT EXISTS attempt jsonb;
ALTER TABLE bmux_attention ADD COLUMN IF NOT EXISTS read_at timestamptz;
ALTER TABLE bmux_attention ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;
UPDATE bmux_attention SET status='resolved' WHERE resolved_at IS NOT NULL AND status='pending';
ALTER TABLE bmux_push_outbox ADD COLUMN IF NOT EXISTS event_revision integer NOT NULL DEFAULT 1;
ALTER TABLE bmux_stream_leases ADD COLUMN IF NOT EXISTS started_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE bmux_services ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'standard';
ALTER TABLE bmux_host_presence ADD COLUMN IF NOT EXISTS instance text;
ALTER TABLE bmux_host_presence ADD COLUMN IF NOT EXISTS sessions jsonb NOT NULL DEFAULT '[]';
ALTER TABLE bmux_host_presence ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS bmux_activity_events(id uuid PRIMARY KEY,owner text NOT NULL,episode uuid NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS bmux_activity_episodes(id uuid PRIMARY KEY,owner text NOT NULL,host text NOT NULL,generation text NOT NULL,session text NOT NULL,ended boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS bmux_activity_hooks(id uuid PRIMARY KEY,owner text NOT NULL,enabled boolean NOT NULL DEFAULT false,filter jsonb NOT NULL DEFAULT '{}',events jsonb NOT NULL,destination jsonb NOT NULL,secret text,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS bmux_hook_deliveries(id uuid PRIMARY KEY,hook uuid NOT NULL REFERENCES bmux_activity_hooks(id) ON DELETE CASCADE,event uuid NOT NULL REFERENCES bmux_activity_events(id),status text NOT NULL DEFAULT 'pending',attempts int NOT NULL DEFAULT 0,error text,next_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(hook,event));
ALTER TABLE bmux_hook_deliveries ADD COLUMN IF NOT EXISTS trigger_id uuid;
ALTER TABLE bmux_hook_deliveries ADD COLUMN IF NOT EXISTS failures integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS bmux_hook_delivery_pending ON bmux_hook_deliveries(next_at) WHERE status='pending';
