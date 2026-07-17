import { getSupabaseClient } from '../lib/supabaseClient.js';
import { getStrikingDistanceQueries, getUnderperformingCtrPages, getQueryMovement, getContentGapQueries } from '../lib/gscClient.js';
import { getConversionOpportunities } from '../lib/ga4Client.js';
import { sendNotificationEmail } from '../lib/emailClient.js';
import { renderEmailShell } from '../lib/emailTemplate.js';

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

  await sendNotificationEmail({
    subject: `[SEO Audit] ${site.domain} — ${strikingDistance.length} striking-distance opportunities found`,
    html: buildAuditEmail(site, result),
  });

  await supabase.from('event_log').insert({
    site_id: site.id,
    actor: 'seo_audit_agent',
    action: 'audit_completed',
    details: { strikingDistanceCount: strikingDistance.length, underperformingCtrCount: underperformingCtr.length },
  });

  return { site: site.domain, ...result };
}

function buildAuditEmail(site, r) {
  const row = (cells) => `<tr>${cells.map((c) => `<td style="padding:6px 10px;border-bottom:1px solid #E5E7EB;font-size:13px;">${c}</td>`).join('')}</tr>`;
  const table = (headers, rows) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 20px;border-collapse:collapse;">
      <tr>${headers.map((h) => `<th style="text-align:left;padding:6px 10px;font-size:11px;color:#6B7280;text-transform:uppercase;border-bottom:2px solid #0A1628;">${h}</th>`).join('')}</tr>
      ${rows}
    </table>`;

  const strikingRows = r.strikingDistance.slice(0, 10).map((k) => row([
    `<strong>${k.query}</strong><br/><span style="color:#6B7280;font-size:11px;">${k.page.replace(/^https?:\/\/[^/]+/, '')}</span>`,
    `Pos ${k.position.toFixed(1)}`, `${k.impressions} impr.`, `${k.clicks} clicks`,
  ])).join('') || row(['No striking-distance keywords found this period.', '', '', '']);

  const ctrRows = r.underperformingCtr.slice(0, 8).map((p) => row([
    p.page.replace(/^https?:\/\/[^/]+/, ''),
    `Pos ${p.position.toFixed(1)}`,
    `${(p.ctr * 100).toFixed(1)}% CTR (expected ~${(p.expectedCtr * 100).toFixed(0)}%)`,
    `${p.ctrGapPct}%`,
  ])).join('') || row(['No significant CTR gaps found this period.', '', '', '']);

  const gainingRows = r.queryMovement.gaining.filter((q) => q.delta > 0).slice(0, 5)
    .map((q) => row([q.query, `+${q.delta} clicks`, `Pos ${q.positionNow?.toFixed(1) ?? '-'}`])).join('');
  const losingRows = r.queryMovement.losing.filter((q) => q.delta < 0).slice(0, 5)
    .map((q) => row([q.query, `${q.delta} clicks`, `Pos ${q.positionNow?.toFixed(1) ?? '-'}`])).join('');

  const croRows = r.conversionOpportunities.slice(0, 8).map((c) => row([
    c.path, `${c.sessions} sessions`, `${c.conversions} conversions`, `${(c.conversionRate * 100).toFixed(2)}%`,
  ])).join('') || row(['Not enough GA4 data this period.', '', '', '']);

  const gapRows = r.contentGaps.slice(0, 10).map((g) => row([
    `<strong>${g.query}</strong><br/><span style="color:#6B7280;font-size:11px;">currently landing on: ${g.page.replace(/^https?:\/\/[^/]+/, '')}</span>`,
    `Pos ${g.position.toFixed(1)}`, `${g.impressions} impr.`,
  ])).join('') || row(['No content-gap candidates found this period.', '', '']);

  const bodyHtml = `
    <p style="color:#6B7280;font-size:13px;">${r.dateRanges.current.startDate} → ${r.dateRanges.current.endDate} (28-day window)</p>

    <h3 style="color:#0A1628;font-size:15px;margin:20px 0 4px;">🎯 Striking-distance keywords (position 4-20)</h3>
    <p style="color:#6B7280;font-size:12px;margin:0 0 4px;">Already ranking, already relevant to Google — cheapest wins available.</p>
    ${table(['Query / Page', 'Position', 'Impressions', 'Clicks'], strikingRows)}

    <h3 style="color:#0A1628;font-size:15px;margin:20px 0 4px;">📉 Pages with below-expected CTR</h3>
    <p style="color:#6B7280;font-size:12px;margin:0 0 4px;">Ranking well, but the title/meta description isn't earning the click it's positioned for.</p>
    ${table(['Page', 'Position', 'CTR vs expected', 'Gap'], ctrRows)}

    <h3 style="color:#0A1628;font-size:15px;margin:20px 0 4px;">📈 Top gaining queries</h3>
    ${gainingRows ? table(['Query', 'Change', 'Position'], gainingRows) : '<p style="font-size:13px;color:#6B7280;">No notable gainers this period.</p>'}

    <h3 style="color:#0A1628;font-size:15px;margin:20px 0 4px;">📉 Top losing queries</h3>
    ${losingRows ? table(['Query', 'Change', 'Position'], losingRows) : '<p style="font-size:13px;color:#6B7280;">No notable losers this period.</p>'}

    <h3 style="color:#0A1628;font-size:15px;margin:20px 0 4px;">💰 CRO opportunities (GA4)</h3>
    <p style="color:#6B7280;font-size:12px;margin:0 0 4px;">High traffic, low conversion — the highest-leverage pages to improve.</p>
    ${table(['Page', 'Sessions', 'Conversions', 'Rate'], croRows)}

    <h3 style="color:#0A1628;font-size:15px;margin:20px 0 4px;">🆕 Content gap candidates (page 3+, position 21-50)</h3>
    <p style="color:#6B7280;font-size:12px;margin:0 0 4px;">Real queries already tied to this site but stuck deep — worth considering a dedicated new page. Needs a real client fact/case-study to write from, doesn't auto-draft.</p>
    ${table(['Query', 'Position', 'Impressions'], gapRows)}
  `;

  return renderEmailShell({
    badgeLabel: 'SEO Audit',
    badgeTone: 'info',
    heading: `${site.domain} — SEO Opportunity Report`,
    bodyHtml,
  });
}
