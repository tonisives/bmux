CREATE TABLE IF NOT EXISTS bmux_projects (
 id uuid PRIMARY KEY, owner text NOT NULL, name text NOT NULL, timezone text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner,id)
);
CREATE TABLE IF NOT EXISTS bmux_personas (
 id uuid PRIMARY KEY, owner text NOT NULL, project_id uuid NOT NULL, name text NOT NULL,
 interests text NOT NULL DEFAULT '', UNIQUE(owner,id),
 FOREIGN KEY(owner,project_id) REFERENCES bmux_projects(owner,id)
);
CREATE TABLE IF NOT EXISTS bmux_managed_accounts (
 id uuid PRIMARY KEY, owner text NOT NULL, persona_id uuid NOT NULL, platform text NOT NULL
 CHECK(platform IN ('tiktok','instagram','youtube','x','reddit','linkedin')),
 handle text NOT NULL, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','paused','ready','archived')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner,id),
 FOREIGN KEY(owner,persona_id) REFERENCES bmux_personas(owner,id)
);
CREATE TABLE IF NOT EXISTS bmux_account_schedules (
 id uuid PRIMARY KEY, owner text NOT NULL, account_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('warmup','post','analytics')), job text NOT NULL,
 inputs jsonb NOT NULL DEFAULT '{}', scheduled_at timestamptz NOT NULL,
 duration_minutes integer NOT NULL CHECK(duration_minutes BETWEEN 1 AND 180),
 status text NOT NULL DEFAULT 'blocked' CHECK(status IN ('blocked','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner,id),
 FOREIGN KEY(owner,account_id) REFERENCES bmux_managed_accounts(owner,id)
);
CREATE INDEX IF NOT EXISTS bmux_projects_owner ON bmux_projects(owner);
CREATE INDEX IF NOT EXISTS bmux_personas_owner ON bmux_personas(owner,project_id);
CREATE INDEX IF NOT EXISTS bmux_managed_accounts_owner ON bmux_managed_accounts(owner,persona_id);
CREATE INDEX IF NOT EXISTS bmux_account_schedules_owner ON bmux_account_schedules(owner,scheduled_at);
