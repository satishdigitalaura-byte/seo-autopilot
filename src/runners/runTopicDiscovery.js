import 'dotenv/config';
import { getSupabaseClient } from '../lib/supabaseClient.js';
import { runTopicDiscoveryForSite } from '../agents/topicDiscoveryAgent.js';
import { isAutomationPaused } from '../lib/systemStatus.js';
import { isAgentEnabled, isAgentDueToRun } from '../lib/agentSettings.js';

async function main() {
  const { paused, reason } = await isAutomationPaused();
  if (paused) {
    console.log(`Automation is PAUSED (${reason || 'no reason given'}) — skipping this run entirely.`);
    return;
  }

  // Independent of the global pause: this agent has its own on/off switch in
  // the panel. Turning it off must never affect any other agent's runner.
  const enabled = await isAgentEnabled('topic_discovery_agent');
  if (!enabled) {
    console.log('Topic Discovery Agent is turned OFF in the panel — skipping this run.');
    return;
  }

  // This agent runs on its own initiative (a daily cron, not a task queue),
  // so it's the one runner where "run every N minutes/days" from the panel
  // (Agent Settings) makes sense to honor directly.
  const dueToRun = await isAgentDueToRun('topic_discovery_agent');
  if (!dueToRun) {
    console.log('Topic Discovery Agent already ran within its configured interval — skipping this run.');
    return;
  }

  const supabase = getSupabaseClient();
  const { data: sites, error } = await supabase.from('sites').select('*').eq('status', 'active');
  if (error) throw error;

  if (!sites || sites.length === 0) {
    console.log('No active sites to analyze.');
    return;
  }

  for (const site of sites) {
    console.log(`\n--- Topic discovery for ${site.domain} ---`);
    try {
      const result = await runTopicDiscoveryForSite(site);
      if (result.skipped) {
        console.log(`Skipped: ${result.reason}`);
        continue;
      }
      console.log(`Decision: ${result.decision}${result.picksCount != null ? ` | Picks: ${result.picksCount}` : ''}`);
    } catch (err) {
      console.error(`Topic discovery failed for ${site.domain}:`, err.message);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
