import { getSupabaseClient } from '../lib/supabaseClient.js';
import { getStrikingDistanceQueries, getUnderperformingCtrPages, getQueryMovement, getContentGapQueries } from '../lib/gscClient.js';
import { getConversionOpportunities } from '../lib/ga4Client.js';

/**
 * SEO Audit Agent — a periodic "what's actually going on in GSC/GA4" report,
 * focused on the signals that actually move rankings/leads, not vanity
 * metrics. Complements the daily drop-detecting GSC/GA4 Watcher (which is
 * reactive/alert-only) with a proactive opportunity report.
 *
 * Four sections, each tied to a real SEO lever:
 *  1. Striking-distance keywords (position 4-20) — cheapest ranking wins,
 *     since Google already considers the page relevant.
 *  2. Underperforming-CTR pages — ranking well but title/meta isn't earning
 *     the click; a copy fix here is pure upside with no new content needed.
 *  3. Query movement — real gainers/losers at the query level (more precise
 *     than page-level, catches cannibalization/shifts a page-level view misses).
 *  4. GA4 conversion opportunities — high traffic, low conversion pages
 *     (Guidelines-aligned CRO signal: fix the highest-leverage page first).
 *  5. Content gap candidates (position 21-50) — real queries with proven
 *     topical relevance but stuck on page 3+, flagged for a human to decide
 *     whether a new page is worth building (needs a real ORIGINAL ELEMENT
 *     before content_draft_agent can act on it — this only surfaces the gap).
 *
 * Uses a 28-day window (vs. the Watcher's 7-day drop-detection window)
 * because these signals need more data to be meaningful/stable.
 */

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

function dateRange(daysAgoStart, daysAgoEnd) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - daysAgoEnd);
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - daysAgoStart);
  return { startDate: fmtDate(start), endDate: fmtDate(end) };
}

export async function runAuditForSite(site) {
  const supabase = getSupabaseClient();

  const { data: creds } = await supabase
    .from('site_credentials')
    .select('credential_key, credential_value')
    .eq('site_id', site.id)
    .in('credential_key', ['gsc_property', 'ga4_property_id']);
  const credMap = Object.fromEntries((creds || []).map((c) => [c.credential_key, c.credential_value]));

  if (!credMap.gsc_property) {
    return { skipped: true, reason: 'no gsc_property set for this site' };
  }

  const current = dateRange(31, 3);   // 28-day window ending 3 days ago (GSC lag)
  const previous = dateRange(59, 31); // the 28 days before that

  const [strikingDistance, underperformingCtr, queryMovement, contentGaps] = await Promise.all([
    getStrikingDistanceQueries(credMap.gsc_property, current.startDate, current.endDate),
    getUnderperformingCtrPages(credMap.gsc_property, current.startDate, current.endDate),
    getQueryMovement(credMap.gsc_property, current, previous),
    getContentGapQueries(credMap.gsc_property, current.startDate, current.endDate),
  ]);

  let conversionOpportunities = [];
  if (credMap.ga4_property_id) {
    try {
      conversionOpportunities = await getConversionOpportunities(credMap.ga4_property_id, current.startDate, current.endDate);
    } catch (err) {
      console.warn(`GA4 conversion-opportunity fetch failed for ${site.domain}: ${err.message}`);
    }
  }

  const result = {
    dateRanges: { current, previous },
    strikingDistanceCount: strikingDistance.length,
    strikingDistance: strikingDistance.slice(0, 15),
    underperformingCtr: underperformingCtr.slice(0, 10),
    queryMovement,
    conversionOpportunities,
    contentGapCount: contentGaps.length,
    contentGaps: contentGaps.slice(0, 15),
  };

  await supabase.from('agent_results').insert({
    site_id: site.id,
    agent_name: 'seo_audit_agent',
    result,
  });

  // Not critical — routine weekly report, already saved above and rendered
  // as a notification card in the panel's Activity feed, no email sent.

  await supabase.from('event_log').insert({
    site_id: site.id,
    actor: 'seo_audit_agent',
    action: 'audit_completed',
    details: { strikingDistanceCount: strikingDistance.length, underperformingCtrCount: underperformingCtr.length },
  });

  return { site: site.domain, ...result };
}

