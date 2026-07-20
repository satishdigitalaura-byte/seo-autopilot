import 'dotenv/config';
import { getSupabaseClient } from '../lib/supabaseClient.js';
import { processGuardrailTask } from '../agents/policyGuardrailAgent.js';
import { isAutomationPaused } from '../lib/systemStatus.js';
import { isAgentEnabled } from '../lib/agentSettings.js';

async function main() {
  const { paused, reason } = await isAutomationPaused();
  if (paused) {
    console.log(`Automation is PAUSED (${reason || 'no reason given'}) — skipping this run entirely.`);
    return;
  }

  // Note: no run_interval throttle here on purpose — same reasoning as
  // content_draft_agent. This processes an already-queued review task, and
  // content-draft.yml also calls this runner directly, back-to-back with the
  // draft, right after "Create Topic" — throttling it would silently
  // reintroduce the reject/revise-forever bug that was fixed earlier.
  const enabled = await isAgentEnabled('policy_guardrail_agent');
  if (!enabled) {
    console.log('Policy Guardrail Agent is turned OFF in the panel — skipping this run.');
    return;
  }

  const supabase = getSupabaseClient();

  const { data: tasks, error } = await supabase
    .from('agent_tasks')
    .select('*')
    .eq('target_agent', 'policy_guardrail_agent')
    .eq('status', 'pending')
    .order('priority', { ascending: false })
    .limit(20);

  if (error) throw error;

  if (!tasks || tasks.length === 0) {
    console.log('No pending policy_guardrail_agent tasks.');
    return;
  }

  console.log(`Processing ${tasks.length} task(s)...`);

  for (const task of tasks) {
    await supabase.from('agent_tasks').update({ status: 'in_progress' }).eq('id', task.id);
    try {
      const result = await processGuardrailTask(task);
      console.log(`Task ${task.id}: ${result.decision}`);
    } catch (err) {
      console.error(`Task ${task.id} failed:`, err.message);
      await supabase.from('agent_tasks').update({
        status: 'failed',
        error_message: err.message,
        retry_count: (task.retry_count || 0) + 1,
      }).eq('id', task.id);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
