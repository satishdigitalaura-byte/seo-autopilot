import 'dotenv/config';
import { getSupabaseClient } from '../lib/supabaseClient.js';
import { runWatcherForSite } from '../agents/gscGa4WatcherAgent.js';

async function main() {
  const supabase = getSupabaseClient();
  const { data: sites, error } = await supabase.from('sites').select('*').eq('status', 'active');
  if (error) throw error;

  if (!sites || sites.length === 0) {
    console.log('No active sites to watch.');
    return;
  }

  for (const site of sites) {
    console.log(`\n--- Watching ${site.domain} ---`);
    try {
      const result = await runWatcherForSite(site);
      if (result.skipped) {
        console.log(`Skipped: ${result.reason}`);
        continue;
      }
      if (result.suppressed) {
        console.log('Core update suppression active — data logged, no alert tasks created.');
        continue;
      }
      console.log(`Pages checked: ${result.pagesChecked} | Drops found: ${result.findings} | Tasks created: ${result.tasksCreated}`);
    } catch (err) {
      console.error(`Watcher failed for ${site.domain}:`, err.message);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
