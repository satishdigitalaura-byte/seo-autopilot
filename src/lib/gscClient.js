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
