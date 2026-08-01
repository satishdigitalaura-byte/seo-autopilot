import 'dotenv/config';
import { getSupabaseClient } from '../lib/supabaseClient.js';
import { runAnalyticsSnapshotForSite } from '../agents/analyticsSnapshotAgent.js';
import { isAutomationPaused } from '../lib/systemStatus.js';

async function main() {
  const { paused, reason } = await isAutomationPaused();
  if (paused) {
    console.log(`Automation is PAUSED (${reason || 'no reason given'}) — skipping this run entirely.`);
    return;
  }

  const supabase = getSupabaseClient();
  const { data: sites, error } = await supabase.from('sites').select('*').eq('status', 'active');
  if (error) throw error;

  for (const site of sites || []) {
    try {
      const result = await runAnalyticsSnapshotForSite(site);
      console.log(`${site.domain}: snapshot saved${result.errors?.length ? ` (warnings: ${result.errors.join(' | ')})` : ''}`);
    } catch (err) {
      console.error(`${site.domain} failed:`, err.message);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
