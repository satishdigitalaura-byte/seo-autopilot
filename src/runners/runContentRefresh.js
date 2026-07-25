import 'dotenv/config';
import { getSupabaseClient } from '../lib/supabaseClient.js';
import { processContentRefreshTask } from '../agents/contentRefreshAgent.js';
import { isAutomationPaused } from '../lib/systemStatus.js';
import { isAgentEnabled } from '../lib/agentSettings.js';

async function main() {
  const { paused, reason } = await isAutomationPaused();
  if (paused) {
    console.log(`Automation is PAUSED (${reason || 'no reason given'}) — skipping this run entirely.`);
    return;
  }

  if (!(await isAgentEnabled('content_refresh_agent'))) {
    console.log('Content Refresh Agent is disabled from the panel — skipping this run.');
    return;
  }

  const supabase = getSupabaseClient();
  const { data: tasks, error } = await supabase
    .from('agent_tasks')
    .select('*')
    .eq('target_agent', 'content_refresh_agent')
    .eq('status', 'pending')
    .order('priority', { ascending: false })
    .limit(10);
  if (error) throw error;

  if (!tasks || tasks.length === 0) {
    console.log('No pending content_refresh_agent tasks.');
    return;
  }

  console.log(`Processing ${tasks.length} refresh-investigation task(s)...`);
  for (const task of tasks) {
    await supabase.from('agent_tasks').update({ status: 'in_progress' }).eq('id', task.id);
    try {
      const result = await processContentRefreshTask(task);
      console.log(`Task ${task.id}: ${result.decision}`);
    } catch (err) {
      console.error(`Task ${task.id} failed:`, err.message);
      await supabase.from('agent_tasks').update({
        status: 'failed', error_message: err.message, retry_count: (task.retry_count || 0) + 1,
      }).eq('id', task.id);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
