import { google } from 'googleapis';
import { getGoogleAuthClient } from './googleAuth.js';

const SCOPES = ['https://www.googleapis.com/auth/analytics.readonly'];

async function runReport(propertyId, startDate, endDate, conversionMetric) {
  const authClient = await getGoogleAuthClient(SCOPES);
  const analyticsdata = google.analyticsdata({ version: 'v1beta', auth: authClient });

  return analyticsdata.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'sessions' }, { name: conversionMetric }],
      limit: 500,
    },
  });
}

/**
 * Pull per-page sessions + conversions from GA4 for one property, for
 * context alongside a GSC clicks drop (did traffic/conversions actually
 * fall too, or is this just a search-visibility issue?).
 *
 * `propertyId` must be the bare numeric id (e.g. "540645058"), not the
 * "properties/540645058" form the Admin API returns — that prefix is
 * added here.
 *
 * GA4's conversion metric was renamed from "conversions" to "keyEvents" —
 * try the new name first and fall back for older/differently configured
 * properties instead of failing the whole watcher run.
 */
export async function getPageSessions(propertyId, startDate, endDate) {
  let res;
  try {
    res = await runReport(propertyId, startDate, endDate, 'keyEvents');
  } catch {
    res = await runReport(propertyId, startDate, endDate, 'conversions');
  }

  const byPage = new Map();
  for (const row of res.data.rows || []) {
    const path = row.dimensionValues[0].value;
    byPage.set(path, {
      sessions: Number(row.metricValues[0].value || 0),
      conversions: Number(row.metricValues[1].value || 0),
    });
  }
  return byPage;
}
