import 'dotenv/config';
import { getSupabaseClient } from '../lib/supabaseClient.js';
import { runTechnicalAuditForSite } from '../agents/technicalAuditAgent.js';
import { isAutomationPaused } from '../lib/systemStatus.js';
import { isAgentEnabled } from '../lib/agentSettings.js';

async function main() {
  const { paused, reason } = await isAutomationPaused();
  if (paused) {
    console.log(`Automation is PAUSED (${reason || 'no reason given'}) — skipping this run entirely.`);
    return;
  }

  if (!(await isAgentEnabled('technical_audit_agent'))) {
    console.log('Technical Audit Agent is disabled from the panel — skipping this run.');
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
    console.log(`\n--- Technical audit: ${site.domain} ---`);
    try {
      const result = await runTechnicalAuditForSite(site);
      if (result.skipped) {
        console.log(`Skipped: ${result.reason}`);
        continue;
      }
      console.log(`Issues: ${result.issueCount} | Pages checked: ${result.pagesChecked} | Duplicate meta: ${result.duplicateMeta}`);
    } catch (err) {
      console.error(`Technical audit failed for ${site.domain}:`, err.message);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
