import 'dotenv/config';
import { getSupabaseClient } from '../lib/supabaseClient.js';
import { runCompetitorMonitoringForSite } from '../agents/competitorMonitoringAgent.js';
import { isAutomationPaused } from '../lib/systemStatus.js';
import { isAgentEnabled } from '../lib/agentSettings.js';

async function main() {
  const { paused, reason } = await isAutomationPaused();
  if (paused) {
    console.log(`Automation is PAUSED (${reason || 'no reason given'}) — skipping this run entirely.`);
    return;
  }
  if (!(await isAgentEnabled('competitor_monitoring_agent'))) {
    console.log('Competitor Monitoring Agent is disabled from the panel — skipping this run.');
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
    console.log(`\n--- Competitor monitoring: ${site.domain} ---`);
    try {
      const result = await runCompetitorMonitoringForSite(site);
      if (result.skipped) {
        console.log(`Skipped: ${result.reason}`);
        continue;
      }
      console.log(`Checked ${result.competitorsChecked} competitor(s), ${result.newPagesFound} new page(s) found.`);
    } catch (err) {
      console.error(`Competitor monitoring failed for ${site.domain}:`, err.message);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
