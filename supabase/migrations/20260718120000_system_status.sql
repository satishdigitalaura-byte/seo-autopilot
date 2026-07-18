-- Single-row table the Manager Agent uses as a kill-switch: when
-- automation_paused is true, every runner (content draft, policy guardrail,
-- etc.) refuses to process any task until a human reviews and resumes it
-- from the panel. This is the actual safety mechanism, not just an alert.
create table if not exists system_status (
  id int primary key default 1,
  automation_paused boolean not null default false,
  pause_reason text,
  paused_at timestamptz,
  paused_by text,
  resumed_at timestamptz,
  resumed_by text,
  constraint single_row check (id = 1)
);

insert into system_status (id, automation_paused)
values (1, false)
on conflict (id) do nothing;

alter table system_status enable row level security;
-- No policies defined — same pattern as every other table in this project:
-- only the service_role key (used server-side by runners and Edge Functions)
-- can read/write it.
