import { getSupabaseClient } from '../lib/supabaseClient.js';
import { getPageClicks } from '../lib/gscClient.js';
import { getPageSessions } from '../lib/ga4Client.js';
import { sendNotificationEmail } from '../lib/emailClient.js';
import { renderEmailShell, renderBeforeAfterBars } from '../lib/emailTemplate.js';

/**
 * GSC/GA4 Watcher Agent — per SEO_AUTOPILOT_MASTER_ARCHITECTURE.md §2/§3.
 *
 * WHAT IT DOES: runs daily, compares two 7-day windows of real Search
 * Console + Analytics data per page, and flags pages with a real,
 * significant traffic drop. It never writes or publishes anything itself —
 * it only raises a flag by creating an `investigate_drop` task for the
 * (future) Content Refresh Agent, exactly like the worked example in
 * MASTER_ARCHITECTURE.md §2: "GSC Watcher (daily) finds a drop → writes
 * task: {target: content_refresh_agent, type: investigate_drop, payload}".
 *
 * WHY THE THRESHOLDS EXIST (avoiding false alarms, Guidelines §8 spirit —
 * don't overreact to noise or normal fluctuation):
 *  - minClicksSample: a page with 2 clicks last week and 0 this week is not
 *    a "40% drop", it's noise. We require a minimum baseline before a page
 *    is even considered.
 *  - dropPct: a small day-to-day wobble is normal; only a genuinely large,
 *    sustained drop (default 20%) is worth a human's attention.
 *  - Core Update suppression: Guidelines §8 — during/right after a known
 *    Google core update, ranking volatility is expected and NOT a signal
 *    of a site-specific problem. If `core_update_status` has an active
 *    suppression window, we still record the data (for later analysis) but
 *    skip creating alert tasks, so the agency isn't flooded with false
 *    "your page broke" alerts that are really just Google recalibrating.
 *  - GSC reporting lag: GSC data for the last ~2-3 days is incomplete, so
 *    both comparison windows end 3 days before "today" (see gscClient.js).
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

function pathOf(fullUrl) {
  try {
    return new URL(fullUrl).pathname;
  } catch {
    return fullUrl;
  }
}

export async function runWatcherForSite(site) {
  const supabase = getSupabaseClient();

  const { data: creds } = await supabase
    .from('site_credentials')
    .select('credential_key, credential_value')
    .eq('site_id', site.id)
    .in('credential_key', ['gsc_property', 'ga4_property_id']);

  const credMap = Object.fromEntries((creds || []).map((c) => [c.credential_key, c.credential_value]));
  if (!credMap.gsc_property) {
    return { skipped: true, reason: 'no gsc_property set in site_credentials for this site' };
  }

  const current = dateRange(10, 3);   // 7-day window ending 3 days ago
  const previous = dateRange(17, 10); // the 7-day window before that

  const [currentClicks, previousClicks] = await Promise.all([
    getPageClicks(credMap.gsc_property, current.startDate, current.endDate),
    getPageClicks(credMap.gsc_property, previous.startDate, previous.endDate),
  ]);

  let currentSessions = new Map();
  if (credMap.ga4_property_id) {
    try {
      currentSessions = await getPageSessions(credMap.ga4_property_id, current.startDate, current.endDate);
    } catch (err) {
      console.warn(`GA4 fetch failed for ${site.domain}: ${err.message} — continuing with GSC-only data.`);
    }
  }

  const dropPct = site.settings?.click_drop_pct ?? 20;
  const minClicksSample = site.settings?.click_drop_min_sample ?? 5;

  const { data: suppression } = await supabase
    .from('core_update_status')
    .select('*')
    .gt('suppress_alerts_until', new Date().toISOString())
    .limit(1);
  const isSuppressed = (suppression || []).length > 0;

  const pages = new Set([...currentClicks.keys(), ...previousClicks.keys()]);
  const findings = [];

  for (const page of pages) {
    const now = currentClicks.get(page) || { clicks: 0, impressions: 0, position: 0 };
    const before = previousClicks.get(page) || { clicks: 0, impressions: 0, position: 0 };

    if (before.clicks < minClicksSample) continue; // too small a sample to be meaningful

    const changePct = ((now.clicks - before.clicks) / before.clicks) * 100;
    if (changePct > -dropPct) continue; // not a significant drop

    findings.push({
      url: page,
      clicksBefore: before.clicks,
      clicksAfter: now.clicks,
      changePct: Math.round(changePct),
      impressionsBefore: before.impressions,
      impressionsAfter: now.impressions,
      positionBefore: Math.round(before.position * 10) / 10,
      positionAfter: Math.round(now.position * 10) / 10,
      ga4Sessions: currentSessions.get(pathOf(page))?.sessions ?? null,
      ga4Conversions: currentSessions.get(pathOf(page))?.conversions ?? null,
    });
  }

  findings.sort((a, b) => a.changePct - b.changePct); // biggest drops first

  await supabase.from('agent_results').insert({
    site_id: site.id,
    agent_name: 'gsc_ga4_watcher',
    result: {
      dateRanges: { current, previous },
      pagesChecked: pages.size,
      findingsCount: findings.length,
      suppressed: isSuppressed,
      findings: findings.slice(0, 50),
    },
  });

  if (isSuppressed) {
    // Not critical — visible as a notification card in the panel (result
    // above already records suppressed:true), no email for a routine pause.
    return { site: site.domain, pagesChecked: pages.size, findings: findings.length, tasksCreated: 0, suppressed: true };
  }

  let tasksCreated = 0;
  for (const f of findings) {
    // Priority 1-10: weigh both absolute clicks lost and % severity, so a
    // page that lost 200 clicks outranks one that lost 6, even if the % is similar.
    const clicksLost = f.clicksBefore - f.clicksAfter;
    const priority = Math.max(1, Math.min(10, Math.round(clicksLost / 5) + Math.round(Math.abs(f.changePct) / 20)));

    await supabase.from('agent_tasks').insert({
      site_id: site.id,
      source_agent: 'gsc_ga4_watcher',
      target_agent: 'content_refresh_agent',
      task_type: 'investigate_drop',
      priority,
      payload: { ...f, dateRanges: { current, previous } },
      status: 'pending',
    });
    tasksCreated++;
  }

  await supabase.from('event_log').insert({
    site_id: site.id,
    actor: 'gsc_ga4_watcher',
    action: 'watch_run_completed',
    details: { pagesChecked: pages.size, findingsCount: findings.length, tasksCreated },
  });

  // CRITICAL — real, current traffic loss is the one case in this agent that
  // genuinely needs an inbox interruption, not just a panel notification.
  // The "all clear" case is routine and stays panel-only (see agent_results above).
  if (findings.length > 0) {
    try {
      const barsHtml = renderBeforeAfterBars(
        findings.slice(0, 10).map((f) => ({
          label: `${f.url} — ${f.changePct}% (position ${f.positionBefore} → ${f.positionAfter})`,
          before: f.clicksBefore,
          after: f.clicksAfter,
        })),
        { beforeLabel: 'Clicks — previous 7 days', afterLabel: 'Clicks — last 7 days' }
      );

      await sendNotificationEmail({
        subject: `[SEO Watcher] ${site.domain} — ${findings.length} page(s) lost significant traffic`,
        html: renderEmailShell({
          badgeLabel: 'Action Needed',
          badgeTone: 'alert',
          heading: `${findings.length} page${findings.length > 1 ? 's' : ''} lost significant traffic`,
          bodyHtml: `
            <p style="color:#6B7280;font-size:13px;margin-bottom:20px;">${current.startDate} → ${current.endDate} compared to the 7 days before (${previous.startDate} → ${previous.endDate})</p>
            ${barsHtml}
            <p style="margin-top:8px;">${tasksCreated} investigation task${tasksCreated === 1 ? '' : 's'} queued for review.</p>
          `,
        }),
      });
    } catch (err) {
      console.warn('Email notification failed (non-fatal):', err.message);
    }
  }

  return { site: site.domain, pagesChecked: pages.size, findings: findings.length, tasksCreated, suppressed: false };
}
