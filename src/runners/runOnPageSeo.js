import 'dotenv/config';
import { getSupabaseClient } from '../lib/supabaseClient.js';
import { runOnPageAuditForSite } from '../agents/onPageSeoAgent.js';
import { isAutomationPaused } from '../lib/systemStatus.js';
import { isAgentEnabled } from '../lib/agentSettings.js';

async function main() {
  const { paused, reason } = await isAutomationPaused();
  if (paused) {
    console.log(`Automation is PAUSED (${reason || 'no reason given'}) — skipping this run entirely.`);
    return;
  }

  if (!(await isAgentEnabled('on_page_seo_agent'))) {
    console.log('On-Page SEO Agent is disabled from the panel — skipping this run.');
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
    console.log(`\n--- On-page audit: ${site.domain} ---`);
    try {
      const result = await runOnPageAuditForSite(site);
      if (result.skipped) {
        console.log(`Skipped: ${result.reason}`);
        continue;
      }
      console.log(`Pages audited: ${result.pagesAudited} | Avg score: ${result.averageScore}/100 | Issues: ${result.totalIssues}`);
    } catch (err) {
      console.error(`On-page audit failed for ${site.domain}:`, err.message);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
