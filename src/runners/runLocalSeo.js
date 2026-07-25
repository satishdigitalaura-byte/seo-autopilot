import 'dotenv/config';
import { getSupabaseClient } from '../lib/supabaseClient.js';
import { runLocalSeoForSite } from '../agents/localSeoAgent.js';
import { isAutomationPaused } from '../lib/systemStatus.js';
import { isAgentEnabled } from '../lib/agentSettings.js';

async function main() {
  const { paused, reason } = await isAutomationPaused();
  if (paused) {
    console.log(`Automation is PAUSED (${reason || 'no reason given'}) — skipping this run entirely.`);
    return;
  }
  if (!(await isAgentEnabled('local_seo_agent'))) {
    console.log('Local SEO Agent is disabled from the panel — skipping this run.');
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
    console.log(`\n--- Local SEO check: ${site.domain} ---`);
    try {
      const result = await runLocalSeoForSite(site);
      console.log(`Checked ${result.pagesChecked} pages, ${result.distinctPhoneNumbersFound} distinct phone number(s) found.`);
    } catch (err) {
      console.error(`Local SEO check failed for ${site.domain}:`, err.message);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
