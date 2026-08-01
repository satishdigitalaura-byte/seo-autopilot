import { getSupabaseClient } from '../lib/supabaseClient.js';
import { getSiteTotals as getGscTotals } from '../lib/gscClient.js';
import { getSiteTotals as getGa4Totals } from '../lib/ga4Client.js';
import { getAnalyticsSummary } from '../lib/siteConnectors/expressSiteConnector.js';
import { withSiteSecret } from '../lib/siteCredentials.js';

/**
 * Analytics Snapshot Agent — the Analytics tab's only data source. Pure
 * read/report, same as the audit agents: it never changes anything, it just
 * pulls real numbers (GSC clicks/impressions, GA4 sessions/conversions, and
 * the site's own published-content/lead counts) into one row so the panel
 * doesn't need live Google API calls on every page load.
 */

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

// GSC's most recent ~3 days are typically incomplete — same rule the watcher
// agent follows — so every window here ends 3 days before "today".
function dateRange(daysBack, endOffset = 3) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - endOffset);
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - daysBack - endOffset);
  return { startDate: fmtDate(start), endDate: fmtDate(end) };
}

export async function runAnalyticsSnapshotForSite(site) {
  const supabase = getSupabaseClient();

  const { data: creds } = await supabase
    .from('site_credentials')
    .select('credential_key, credential_value')
    .eq('site_id', site.id)
    .in('credential_key', ['gsc_property', 'ga4_property_id']);
  const credMap = Object.fromEntries((creds || []).map((c) => [c.credential_key, c.credential_value]));

  const current = dateRange(30);
  const previous = dateRange(60, 33); // the 30 days immediately before `current`

  const result = {
    period: current,
    traffic: null,
    content: null,
    leads: null,
    errors: [],
  };

  if (credMap.gsc_property) {
    try {
      const [gscNow, gscBefore] = await Promise.all([
        getGscTotals(credMap.gsc_property, current.startDate, current.endDate),
        getGscTotals(credMap.gsc_property, previous.startDate, previous.endDate),
      ]);
      result.traffic = { clicksNow: gscNow.clicks, impressionsNow: gscNow.impressions, clicksBefore: gscBefore.clicks, impressionsBefore: gscBefore.impressions };
    } catch (err) {
      result.errors.push(`GSC: ${err.message}`);
    }
  } else {
    result.errors.push('No gsc_property configured for this site — traffic data unavailable.');
  }

  if (credMap.ga4_property_id) {
    try {
      const [ga4Now, ga4Before] = await Promise.all([
        getGa4Totals(credMap.ga4_property_id, current.startDate, current.endDate),
        getGa4Totals(credMap.ga4_property_id, previous.startDate, previous.endDate),
      ]);
      result.traffic = { ...(result.traffic || {}), sessionsNow: ga4Now.sessions, conversionsNow: ga4Now.conversions, sessionsBefore: ga4Before.sessions, conversionsBefore: ga4Before.conversions };
    } catch (err) {
      result.errors.push(`GA4: ${err.message}`);
    }
  }

  try {
    const siteWithSecret = await withSiteSecret(site);
    const summary = await getAnalyticsSummary(siteWithSecret);
    result.content = { publishedBlogs: summary.totalBlogsPublished, publishedPages: summary.totalPagesPublished };
    result.leads = { last30Days: summary.leadsLast30Days, prev30Days: summary.leadsPrev30Days, allTime: summary.leadsAllTime };
  } catch (err) {
    result.errors.push(`Site content/lead counts: ${err.message}`);
  }

  await supabase.from('agent_results').insert({
    site_id: site.id,
    agent_name: 'analytics_snapshot_agent',
    result,
  });

  return { site: site.domain, ...result };
}
