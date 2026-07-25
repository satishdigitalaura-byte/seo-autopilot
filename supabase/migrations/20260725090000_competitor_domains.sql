-- Optional per-site list of competitor domains the Competitor Monitoring
-- Agent should watch. NULL/empty means "not configured yet" — the agent
-- skips that site rather than guessing competitors.
alter table sites add column if not exists competitor_domains text[];
