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
