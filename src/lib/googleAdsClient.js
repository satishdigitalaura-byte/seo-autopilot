// Thin REST client for the Google Ads API — used only for Keyword Planner's
// real search-volume data (KeywordPlanIdeaService.GenerateKeywordIdeas).
// No SDK dependency: a plain refresh-token -> access-token exchange, then a
// single REST call, keeps this agent's footprint small.
const API_VERSION = 'v21'; // Google Ads API deprecates old versions fast — v18/v19/v20 are already sunset as of 2026-07.
const GEO_TARGET_INDIA = 'geoTargetConstants/2356';
const LANGUAGE_ENGLISH = 'languageConstants/1000';

/**
 * Labels a real 12-month volume series as rising / falling / stable by
 * comparing the most recent 3 months against the earliest 3 months. Purely
 * derived from Google's own returned numbers — no invented data. Returns
 * 'unknown' when there isn't enough of a series to judge.
 */
function classifyTrend(series) {
  if (!Array.isArray(series) || series.length < 6) return 'unknown';
  const first = series.slice(0, 3);
  const last = series.slice(-3);
  const avg = (a) => a.reduce((s, n) => s + n, 0) / a.length;
  const earlyAvg = avg(first);
  const lateAvg = avg(last);
  if (earlyAvg === 0) return lateAvg > 0 ? 'rising' : 'stable';
  const change = (lateAvg - earlyAvg) / earlyAvg;
  if (change >= 0.2) return 'rising';
  if (change <= -0.2) return 'falling';
  return 'stable';
}

async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_ADS_OAUTH_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google OAuth token refresh failed: ${data.error_description || data.error}`);
  return data.access_token;
}

/**
 * Returns real Google Ads keyword ideas (avgMonthlySearches, competition) for
 * the given seed keywords. Returns [] on any failure (rate limit, no access,
 * account not yet approved) rather than throwing — keyword research must
 * keep working on GSC-only data if Ads API is unavailable.
 */
export async function getKeywordIdeas(seedKeywords, { geoTarget = GEO_TARGET_INDIA, language = LANGUAGE_ENGLISH } = {}) {
  const customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, '');
  if (!customerId || !process.env.GOOGLE_ADS_OAUTH_REFRESH_TOKEN) return [];

  try {
    const accessToken = await getAccessToken();
    const res = await fetch(
      `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}:generateKeywordIdeas`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          keywordSeed: { keywords: seedKeywords.slice(0, 20) },
          geoTargetConstants: [geoTarget],
          language,
          keywordPlanNetwork: 'GOOGLE_SEARCH',
        }),
      },
    );

    const data = await res.json();
    if (!res.ok) {
      console.warn('Google Ads API error (non-fatal, falling back to GSC-only):', JSON.stringify(data).slice(0, 500));
      return [];
    }

    return (data.results || []).map((r) => {
      const m = r.keywordIdeaMetrics || {};
      // Real last-12-month volume series Google returns per idea — genuine data,
      // used to detect whether demand is genuinely rising or fading (not guessed).
      const series = (m.monthlySearchVolumes || [])
        .map((v) => Number(v.monthlySearches || 0))
        .filter((n) => Number.isFinite(n));
      return {
        keyword: r.text,
        avgMonthlySearches: Number(m.avgMonthlySearches || 0),
        competition: m.competition || 'UNSPECIFIED',
        competitionIndex: Number(m.competitionIndex || 0),
        monthlySearchVolumes: series,
        demandTrend: classifyTrend(series),
      };
    });
  } catch (err) {
    console.warn('Google Ads API call failed (non-fatal, falling back to GSC-only):', err.message);
    return [];
  }
}
