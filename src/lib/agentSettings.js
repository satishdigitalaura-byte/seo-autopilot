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
