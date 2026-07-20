-- Extends agent_settings (already used for the topic_discovery_agent on/off
-- toggle) into a full per-agent config: which model to think with, how much
-- it's allowed to generate per call, and how often it's allowed to run.
-- Defaults are chosen so a row that doesn't exist yet, or a column that's
-- null, behaves exactly like the current hardcoded behavior (Gemini, no cap
-- beyond what the calling code already passes, run every scheduled tick).
alter table agent_settings add column if not exists model_provider text not null default 'gemini';
alter table agent_settings add column if not exists model_name text;
alter table agent_settings add column if not exists min_tokens int;
alter table agent_settings add column if not exists max_tokens int;
alter table agent_settings add column if not exists run_interval_minutes int;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'agent_settings_provider_check'
  ) then
    alter table agent_settings add constraint agent_settings_provider_check
      check (model_provider in ('gemini', 'claude', 'openai'));
  end if;
end $$;
