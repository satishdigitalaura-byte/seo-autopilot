import 'dotenv/config';
import { getSupabaseClient } from '../lib/supabaseClient.js';
import { processContentDraftTask } from '../agents/contentDraftAgent.js';

async function main() {
  const supabase = getSupabaseClient();

  const { data: tasks, error } = await supabase
    .from('agent_tasks')
    .select('*')
    .eq('target_agent', 'content_draft_agent')
    .eq('status', 'pending')
    .order('priority', { ascending: false })
    .limit(10);

  if (error) throw error;

  if (!tasks || tasks.length === 0) {
    console.log('No pending content_draft_agent tasks.');
    return;
  }

  console.log(`Processing ${tasks.length} draft task(s)...`);

  for (const task of tasks) {
    await supabase.from('agent_tasks').update({ status: 'in_progress' }).eq('id', task.id);
    try {
      const result = await processContentDraftTask(task);
      console.log(`Task ${task.id}: ${result.decision}${result.title ? ` — ${result.title}` : ''}`);
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
