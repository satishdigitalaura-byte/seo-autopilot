// Thin REST client for the Google Ads API — used only for Keyword Planner's
// real search-volume data (KeywordPlanIdeaService.GenerateKeywordIdeas).
// No SDK dependency: a plain refresh-token -> access-token exchange, then a
// single REST call, keeps this agent's footprint small.
const API_VERSION = 'v21'; // Google Ads API deprecates old versions fast — v18/v19/v20 are already sunset as of 2026-07.
const GEO_TARGET_INDIA = 'geoTargetConstants/2356';
const LANGUAGE_ENGLISH = 'languageConstants/1000';

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

    return (data.results || []).map((r) => ({
      keyword: r.text,
      avgMonthlySearches: Number(r.keywordIdeaMetrics?.avgMonthlySearches || 0),
      competition: r.keywordIdeaMetrics?.competition || 'UNSPECIFIED',
      competitionIndex: Number(r.keywordIdeaMetrics?.competitionIndex || 0),
    }));
  } catch (err) {
    console.warn('Google Ads API call failed (non-fatal, falling back to GSC-only):', err.message);
    return [];
  }
}
