import 'dotenv/config';
import { getSupabaseClient } from '../lib/supabaseClient.js';
import { runAuditForSite } from '../agents/seoAuditAgent.js';
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

  if (!sites || sites.length === 0) {
    console.log('No active sites to audit.');
    return;
  }

  for (const site of sites) {
    console.log(`\n--- Auditing ${site.domain} ---`);
    try {
      const result = await runAuditForSite(site);
      if (result.skipped) {
        console.log(`Skipped: ${result.reason}`);
        continue;
      }
      console.log(`Striking-distance: ${result.strikingDistanceCount} | Low-CTR pages: ${result.underperformingCtr.length} | CRO opportunities: ${result.conversionOpportunities.length}`);
    } catch (err) {
      console.error(`Audit failed for ${site.domain}:`, err.message);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
