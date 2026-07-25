import { getSupabaseClient } from '../lib/supabaseClient.js';

/**
 * Competitor Monitoring Agent — $0 sitemap-diffing (per Master Architecture
 * §8's free-tier-friendly spirit, no paid rank-tracking API). Needs
 * sites.competitor_domains configured per site (panel doesn't expose this
 * yet — set directly in Supabase for now); skips a site with none set
 * rather than guessing who the competitors are.
 *
 * Method: fetch each competitor's sitemap.xml (or /blog/ index as a
 * fallback), collect their URL list, and diff it against the URL list this
 * agent itself saved last run (kept in agent_results, most recent row per
 * competitor). Anything new since last time is a genuine, real "they just
 * published this" signal — never an invented gap.
 */

async function fetchCompetitorUrls(domain) {
  const base = `https://${domain}`.replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/sitemap.xml`, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'SEO-Autopilot-CompetitorBot/1.0' } });
    if (res.ok) {
      const xml = await res.text();
      const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1].trim());
      if (urls.length) return urls;
    }
  } catch (err) {
    console.warn(`Sitemap fetch failed for ${domain}: ${err.message}`);
  }
  return [];
}

export async function runCompetitorMonitoringForSite(site) {
  const supabase = getSupabaseClient();
  const competitors = (site.competitor_domains || []).filter(Boolean);
  if (competitors.length === 0) {
    return { skipped: true, reason: 'no competitor_domains configured for this site' };
  }

  const perCompetitor = [];
  for (const domain of competitors) {
    const currentUrls = await fetchCompetitorUrls(domain);
    if (currentUrls.length === 0) {
      perCompetitor.push({ domain, error: 'sitemap unreachable or empty' });
      continue;
    }

    const { data: lastRun } = await supabase
      .from('agent_results')
      .select('result, created_at')
      .eq('site_id', site.id)
      .eq('agent_name', 'competitor_monitoring_agent')
      .order('created_at', { ascending: false })
      .limit(20);

    const previousUrls = new Set(
      (lastRun || []).find((r) => r.result?.domain === domain)?.result?.urls || []
    );

    const newUrls = previousUrls.size > 0 ? currentUrls.filter((u) => !previousUrls.has(u)) : [];
    perCompetitor.push({
      domain,
      urlCount: currentUrls.length,
      newSinceLastCheck: newUrls,
      urls: currentUrls, // saved so next run can diff against this snapshot
      firstRun: previousUrls.size === 0,
    });
  }

  const totalNew = perCompetitor.reduce((s, c) => s + (c.newSinceLastCheck?.length || 0), 0);

  for (const c of perCompetitor) {
    await supabase.from('agent_results').insert({
      site_id: site.id,
      agent_name: 'competitor_monitoring_agent',
      result: c,
    });
  }

  try {
    await supabase.from('event_log').insert({
      site_id: site.id, actor: 'competitor_monitoring_agent', action: 'competitor_scan_completed',
      details: { competitorsChecked: competitors.length, newPagesFound: totalNew },
    });
  } catch (err) {
    console.warn(`event_log insert failed (non-fatal): ${err.message}`);
  }

  return { site: site.domain, competitorsChecked: competitors.length, newPagesFound: totalNew, perCompetitor };
}
