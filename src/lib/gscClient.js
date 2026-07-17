import { google } from 'googleapis';
import { getGoogleAuthClient } from './googleAuth.js';

const SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly'];

/**
 * Query Search Console Search Analytics for one property, grouped by page.
 *
 * IMPORTANT — GSC reporting lag: Search Console data for the most recent
 * ~2-3 days is typically incomplete (Google hasn't finished processing it
 * yet). Callers MUST end their date range at least 3 days before "today",
 * or they will see artificially low clicks that look like a real drop but
 * are actually just missing data.
 */
export async function getPageClicks(propertyUrl, startDate, endDate, { rowLimit = 500 } = {}) {
  const authClient = await getGoogleAuthClient(SCOPES);
  const searchconsole = google.searchconsole({ version: 'v1', auth: authClient });

  const res = await searchconsole.searchanalytics.query({
    siteUrl: propertyUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions: ['page'],
      rowLimit,
    },
  });

  const byPage = new Map();
  for (const row of res.data.rows || []) {
    byPage.set(row.keys[0], {
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: row.ctr || 0,
      position: row.position || 0,
    });
  }
  return byPage;
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * "Striking distance" keywords — queries ranking position 4-20 with real
 * impression volume. This is one of the highest-leverage SEO moves: pushing
 * a query already ranking on page 1-2 up a few spots is far cheaper than
 * trying to rank a brand-new page from nothing, because Google already
 * considers the page relevant enough to show at all.
 */
export async function getStrikingDistanceQueries(propertyUrl, startDate, endDate, { rowLimit = 1000, minImpressions = 10 } = {}) {
  const authClient = await getGoogleAuthClient(SCOPES);
  const searchconsole = google.searchconsole({ version: 'v1', auth: authClient });

  const res = await searchconsole.searchanalytics.query({
    siteUrl: propertyUrl,
    requestBody: { startDate, endDate, dimensions: ['query', 'page'], rowLimit },
  });

  return (res.data.rows || [])
    .filter((r) => r.position >= 4 && r.position <= 20 && r.impressions >= minImpressions)
    .map((r) => ({ query: r.keys[0], page: r.keys[1], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }))
    .sort((a, b) => b.impressions - a.impressions);
}

/**
 * Pages ranking well (top 10) but with CTR well below what that position
 * would typically earn — a strong signal the title/meta description isn't
 * compelling enough to earn the click it's already positioned to get.
 * Industry-observed average CTR by position (directional, not an official
 * Google number — Google doesn't publish this) used only as a rough bar.
 */
const EXPECTED_CTR_BY_POSITION = { 1: 0.28, 2: 0.15, 3: 0.11, 4: 0.08, 5: 0.06, 6: 0.05, 7: 0.04, 8: 0.03, 9: 0.03, 10: 0.02 };

export async function getUnderperformingCtrPages(propertyUrl, startDate, endDate, { rowLimit = 500, minImpressions = 20 } = {}) {
  const authClient = await getGoogleAuthClient(SCOPES);
  const searchconsole = google.searchconsole({ version: 'v1', auth: authClient });

  const res = await searchconsole.searchanalytics.query({
    siteUrl: propertyUrl,
    requestBody: { startDate, endDate, dimensions: ['page'], rowLimit },
  });

  return (res.data.rows || [])
    .filter((r) => r.impressions >= minImpressions && r.position <= 10)
    .map((r) => {
      const bucket = Math.max(1, Math.min(10, Math.round(r.position)));
      const expected = EXPECTED_CTR_BY_POSITION[bucket] || 0.02;
      return {
        page: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
        expectedCtr: expected, ctrGapPct: Math.round(((r.ctr - expected) / expected) * 100),
      };
    })
    .filter((r) => r.ctrGapPct < -30) // actual CTR at least 30% below the position-typical rate
    .sort((a, b) => a.ctrGapPct - b.ctrGapPct);
}

/**
 * Content gap candidates — real queries Google already associates with this
 * site (proof of topical relevance) that are stuck on page 3+ (position
 * 21-50), with real impression volume. Deliberately excludes position 4-20
 * (that's `getStrikingDistanceQueries`'s job — a cheaper win) so the two
 * reports don't overlap. A query stuck this far down usually means either no
 * dedicated page exists for it, or the existing page doesn't cover it well
 * enough — worth a human decision on whether a new page is warranted, using
 * a real client fact as the ORIGINAL ELEMENT per Guidelines §6 (this
 * function only surfaces the opportunity, it never invents content).
 */
export async function getContentGapQueries(propertyUrl, startDate, endDate, { rowLimit = 1000, minImpressions = 15, minPosition = 21, maxPosition = 50 } = {}) {
  const authClient = await getGoogleAuthClient(SCOPES);
  const searchconsole = google.searchconsole({ version: 'v1', auth: authClient });

  const res = await searchconsole.searchanalytics.query({
    siteUrl: propertyUrl,
    requestBody: { startDate, endDate, dimensions: ['query', 'page'], rowLimit },
  });

  return (res.data.rows || [])
    .filter((r) => r.position >= minPosition && r.position <= maxPosition && r.impressions >= minImpressions)
    .map((r) => ({ query: r.keys[0], page: r.keys[1], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }))
    .sort((a, b) => b.impressions - a.impressions);
}

/** Top gaining and losing queries between two periods — real query-level movement, not just page-level. */
export async function getQueryMovement(propertyUrl, current, previous, { rowLimit = 1000 } = {}) {
  const authClient = await getGoogleAuthClient(SCOPES);
  const searchconsole = google.searchconsole({ version: 'v1', auth: authClient });

  const [curRes, prevRes] = await Promise.all([
    searchconsole.searchanalytics.query({ siteUrl: propertyUrl, requestBody: { ...current, dimensions: ['query'], rowLimit } }),
    searchconsole.searchanalytics.query({ siteUrl: propertyUrl, requestBody: { ...previous, dimensions: ['query'], rowLimit } }),
  ]);

  const prevMap = new Map((prevRes.data.rows || []).map((r) => [r.keys[0], r]));
  const moves = (curRes.data.rows || []).map((r) => {
    const prev = prevMap.get(r.keys[0]);
    return {
      query: r.keys[0],
      clicksNow: r.clicks,
      clicksBefore: prev?.clicks || 0,
      positionNow: r.position,
      positionBefore: prev?.position ?? null,
      delta: r.clicks - (prev?.clicks || 0),
    };
  });

  return {
    gaining: [...moves].sort((a, b) => b.delta - a.delta).slice(0, 10),
    losing: [...moves].sort((a, b) => a.delta - b.delta).slice(0, 10),
  };
}

/**
 * Real keyword research grounded in actual Search Console query data — NOT a
 * guessed/invented keyword list. Finds queries people have already used to find
 * this site that match the topic, over a wide 90-day window (keyword research
 * needs more history than the 7-day drop-detection windows the watcher uses).
 *
 * Uses GSC's `includingRegex` query filter, so this is real historical search
 * behavior, not a third-party estimate.
 */
export async function getRelatedQueries(propertyUrl, topicKeywords, { days = 90, rowLimit = 50 } = {}) {
  const authClient = await getGoogleAuthClient(SCOPES);
  const searchconsole = google.searchconsole({ version: 'v1', auth: authClient });

  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 3);
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - days);

  const terms = topicKeywords.filter(Boolean).map((k) => k.toLowerCase().trim()).filter(Boolean);
  if (terms.length === 0) return [];
  const regex = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

  try {
    const res = await searchconsole.searchanalytics.query({
      siteUrl: propertyUrl,
      requestBody: {
        startDate: fmtDate(start),
        endDate: fmtDate(end),
        dimensions: ['query'],
        dimensionFilterGroups: [{ filters: [{ dimension: 'query', operator: 'includingRegex', expression: regex }] }],
        rowLimit,
      },
    });
    return (res.data.rows || []).map((row) => ({
      query: row.keys[0],
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: row.ctr || 0,
      position: row.position || 0,
    })).sort((a, b) => b.impressions - a.impressions);
  } catch (err) {
    console.warn('GSC related-query lookup failed:', err.message);
    return [];
  }
}
