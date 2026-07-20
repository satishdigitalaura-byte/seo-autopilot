import { getSupabaseClient } from './supabaseClient.js';

/**
 * Per-agent on/off switch — separate from systemStatus.js's global kill
 * switch. Turning ONE agent off here (e.g. from the panel) must never touch
 * any other agent's ability to run. No row for an agent = enabled by default,
 * so this never blocks an agent that was never explicitly configured.
 */
export async function isAgentEnabled(agentName) {
  const supabase = getSupabaseClient();
  const { data } = await supabase.from('agent_settings').select('enabled').eq('agent_name', agentName).single();
  if (!data) return true;
  return data.enabled !== false;
}

export async function setAgentEnabled(agentName, enabled, updatedBy = 'panel') {
  const supabase = getSupabaseClient();
  await supabase.from('agent_settings').upsert({
    agent_name: agentName,
    enabled,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  });
}

/**
 * Full per-agent config row, with every field defaulted so an agent that's
 * never been touched from the panel behaves exactly like before this table
 * grew these columns — null/missing always means "use the code's own
 * built-in default", never "block" or "zero".
 */
export async function getAgentConfig(agentName) {
  const supabase = getSupabaseClient();
  const { data } = await supabase.from('agent_settings').select('*').eq('agent_name', agentName).single();
  return {
    enabled: data?.enabled !== false,
    modelProvider: data?.model_provider || 'gemini',
    modelName: data?.model_name || null,
    minTokens: data?.min_tokens ?? null,
    maxTokens: data?.max_tokens ?? null,
    runIntervalMinutes: data?.run_interval_minutes ?? null,
  };
}

export async function setAgentConfig(agentName, config, updatedBy = 'panel') {
  const supabase = getSupabaseClient();
  const row = { agent_name: agentName, updated_at: new Date().toISOString(), updated_by: updatedBy };
  if (config.enabled !== undefined) row.enabled = config.enabled;
  if (config.modelProvider !== undefined) row.model_provider = config.modelProvider;
  if (config.modelName !== undefined) row.model_name = config.modelName || null;
  if (config.minTokens !== undefined) row.min_tokens = config.minTokens === '' ? null : config.minTokens;
  if (config.maxTokens !== undefined) row.max_tokens = config.maxTokens === '' ? null : config.maxTokens;
  if (config.runIntervalMinutes !== undefined) row.run_interval_minutes = config.runIntervalMinutes === '' ? null : config.runIntervalMinutes;
  const { error } = await supabase.from('agent_settings').upsert(row);
  if (error) throw error;
}

/**
 * Interval throttle: has enough time passed since this agent's last logged
 * result to let it run again? Used by runners to honor run_interval_minutes
 * (e.g. "content generation every 2-3 days") without needing a different
 * cron schedule per agent — the workflow can still run often, this just
 * makes the agent itself a no-op until its own interval is up.
 */
export async function isAgentDueToRun(agentName) {
  const config = await getAgentConfig(agentName);
  if (!config.runIntervalMinutes) return true;
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('agent_results')
    .select('created_at')
    .eq('agent_name', agentName)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (!data) return true;
  const minutesSinceLastRun = (Date.now() - new Date(data.created_at).getTime()) / 60000;
  return minutesSinceLastRun >= config.runIntervalMinutes;
}
