import 'dotenv/config';
import { getSupabaseClient } from '../lib/supabaseClient.js';
import { runSchemaAgentForSite } from '../agents/schemaAgent.js';
import { isAutomationPaused } from '../lib/systemStatus.js';
import { isAgentEnabled } from '../lib/agentSettings.js';

async function main() {
  const { paused, reason } = await isAutomationPaused();
  if (paused) {
    console.log(`Automation is PAUSED (${reason || 'no reason given'}) — skipping this run entirely.`);
    return;
  }
  if (!(await isAgentEnabled('schema_agent'))) {
    console.log('Schema Agent is disabled from the panel — skipping this run.');
    return;
  }

  const supabase = getSupabaseClient();
  const { data: sites, error } = await supabase.from('sites').select('*').eq('status', 'active');
  if (error) throw error;
  if (!sites || sites.length === 0) {
    console.log('No active sites.');
    return;
  }

  for (const site of sites) {
    console.log(`\n--- Schema update: ${site.domain} ---`);
    try {
      const result = await runSchemaAgentForSite(site);
      if (result.skipped) {
        console.log(`Skipped: ${result.reason}`);
        continue;
      }
      console.log(`Processed ${result.postsProcessed} posts, updated ${result.postsUpdated}.`);
    } catch (err) {
      console.error(`Schema update failed for ${site.domain}:`, err.message);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
