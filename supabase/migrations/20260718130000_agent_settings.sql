-- Per-agent on/off switch, separate from system_status.automation_paused.
-- automation_paused is the global kill-switch (stops EVERY agent).
-- agent_settings.enabled lets a human turn ONE specific agent off/on
-- (starting with topic_discovery_agent) without touching any other agent.
create table if not exists agent_settings (
  agent_name  text primary key,
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

insert into agent_settings (agent_name, enabled)
values ('topic_discovery_agent', true)
on conflict (agent_name) do nothing;

alter table agent_settings enable row level security;
