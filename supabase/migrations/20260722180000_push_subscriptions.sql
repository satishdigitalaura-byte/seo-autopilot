-- Browser push subscriptions for desktop notifications (critical alerts —
-- automation paused, real traffic drops) so those reach the admin even when
-- the panel tab isn't open, mirroring what used to be email-only.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  endpoint text not null unique,
  keys jsonb not null,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;
-- No policies defined — same pattern as every other table in this project:
-- only the service_role key (used server-side by the panel API and agent
-- runners) can read/write it.
