-- SEO Autopilot — Supabase schema (the "shared brain")
-- Run this once in Supabase SQL Editor (or via `supabase db push`) on a fresh project.
-- Safe to re-run: every statement is idempotent (CREATE ... IF NOT EXISTS).

create extension if not exists "pgcrypto";

-- ============================================================
-- 1. SITES — registry of every client site the system manages
-- ============================================================
create table if not exists sites (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,                 -- e.g. "Digital Aura"
  domain            text not null unique,           -- e.g. "thedigitalaura.com"
  host_type         text not null default 'other'
                      check (host_type in ('vercel','netlify','vps','hostinger','siteground','shared','wordpress','other')),
  api_base_url      text,                            -- e.g. https://thedigitalaura.com/api/seo-agent (null until integration is live)
  cms               text default 'unknown',          -- 'wordpress' | 'nextjs' | 'vite-react' | 'static' | 'unknown'
  is_ymyl           boolean not null default false,  -- Your-Money-Your-Life site → stricter policy bar
  timezone          text not null default 'Asia/Kolkata',
  slack_channel_id  text,                            -- per-client Slack channel for approvals
  status            text not null default 'active'
                      check (status in ('active','paused','archived')),
  settings          jsonb not null default '{}'::jsonb, -- per-site thresholds: click_drop_pct, cwv targets, refresh cadence, etc.
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ============================================================
-- 2. SITE_CREDENTIALS — per-site secrets/config
-- NOTE: credential_value should hold either a non-secret config
-- value, or a reference id into Supabase Vault (recommended for
-- real secrets like the shared publish secret / API keys) rather
-- than the raw secret itself. Decide this before storing anything
-- sensitive here.
-- ============================================================
create table if not exists site_credentials (
  id                uuid primary key default gen_random_uuid(),
  site_id           uuid not null references sites(id) on delete cascade,
  credential_key    text not null,   -- e.g. 'shared_secret', 'gsc_property', 'ga4_property_id'
  credential_value  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (site_id, credential_key)
);

-- ============================================================
-- 3. AGENT_TASKS — the task queue that makes agents "talk"
-- ============================================================
create table if not exists agent_tasks (
  id                  uuid primary key default gen_random_uuid(),
  site_id             uuid not null references sites(id) on delete cascade,
  source_agent        text not null,   -- who created this task, e.g. 'gsc_watcher'
  target_agent        text not null,   -- who should pick it up, e.g. 'content_refresh_agent'
  task_type           text not null,   -- e.g. 'investigate_drop', 'draft_refresh', 'approve_draft', 'publish'
  payload             jsonb not null default '{}'::jsonb,
  status              text not null default 'pending'
                        check (status in ('pending','in_progress','awaiting_approval','approved','completed','failed','rejected')),
  approved_by_human   boolean not null default false,  -- publish tasks MUST check this before executing
  approved_by         text,
  approved_at         timestamptz,
  priority            int not null default 5,
  retry_count         int not null default 0,
  error_message       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  completed_at        timestamptz
);

create index if not exists idx_agent_tasks_target_status on agent_tasks (target_agent, status);
create index if not exists idx_agent_tasks_site on agent_tasks (site_id, status);

-- ============================================================
-- 4. AGENT_RESULTS — history/results per agent per site
-- ============================================================
create table if not exists agent_results (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid references agent_tasks(id) on delete set null,
  site_id     uuid references sites(id) on delete cascade, -- nullable: manager_agent isn't scoped to one site
  agent_name  text not null,
  result      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_agent_results_site on agent_results (site_id, agent_name);

-- ============================================================
-- 5. EVENT_LOG — who triggered what, when, why (audit trail)
-- ============================================================
create table if not exists event_log (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid references sites(id) on delete set null, -- null = agency-wide event
  actor       text not null,   -- agent name or human identifier (e.g. slack user)
  action      text not null,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_event_log_site on event_log (site_id, created_at desc);

-- ============================================================
-- 6. CORE_UPDATE_STATUS — Core Update Watch Agent state
-- Drives the "suppress alarm alerts for 1 week" rule (Guidelines §8)
-- ============================================================
create table if not exists core_update_status (
  id                     uuid primary key default gen_random_uuid(),
  source                 text not null check (source in ('google','bing')),
  update_name            text not null,
  status                 text not null check (status in ('rolling_out','completed')),
  started_at             timestamptz,
  completed_at           timestamptz,
  suppress_alerts_until  timestamptz,
  created_at             timestamptz not null default now()
);

-- ============================================================
-- updated_at auto-touch trigger (shared by sites + agent_tasks + site_credentials)
-- ============================================================
create or replace function touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sites_touch on sites;
create trigger trg_sites_touch before update on sites
  for each row execute function touch_updated_at();

drop trigger if exists trg_agent_tasks_touch on agent_tasks;
create trigger trg_agent_tasks_touch before update on agent_tasks
  for each row execute function touch_updated_at();

drop trigger if exists trg_site_credentials_touch on site_credentials;
create trigger trg_site_credentials_touch before update on site_credentials
  for each row execute function touch_updated_at();

-- ============================================================
-- Row Level Security — lock every table to the service_role key only.
-- GitHub Actions and the npm package both talk to Supabase using the
-- service_role key (server-side only, never exposed to a browser),
-- which bypasses RLS by default — enabling RLS here just guarantees
-- no anon/public key can ever read or write these tables.
-- ============================================================
alter table sites               enable row level security;
alter table site_credentials    enable row level security;
alter table agent_tasks         enable row level security;
alter table agent_results       enable row level security;
alter table event_log           enable row level security;
alter table core_update_status  enable row level security;
