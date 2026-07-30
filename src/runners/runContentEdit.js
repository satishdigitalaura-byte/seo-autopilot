import 'dotenv/config';
import { getSupabaseClient } from '../lib/supabaseClient.js';
import { runContentEditForSite } from '../agents/contentEditAgent.js';
import { isAutomationPaused } from '../lib/systemStatus.js';
import { isAgentEnabled } from '../lib/agentSettings.js';

async function main() {
  const { paused, reason } = await isAutomationPaused();
  if (paused) {
    console.log(`Automation is PAUSED (${reason || 'no reason given'}) — skipping this run entirely.`);
    return;
  }

  const enabled = await isAgentEnabled('content_edit_agent');
  if (!enabled) {
    console.log('Content Edit Agent is turned OFF in the panel — skipping this run.');
    return;
  }

  const supabase = getSupabaseClient();
  const { data: sites, error } = await supabase.from('sites').select('*');
  if (error) throw error;

  for (const site of sites || []) {
    try {
      const result = await runContentEditForSite(site);
      console.log(`${site.domain}: ${result.skipped ? `skipped — ${result.reason}` : `${result.proposalsCreated} edit proposal(s) queued for approval`}`);
    } catch (err) {
      console.error(`${site.domain} failed:`, err.message);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
