import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';

/**
 * Shared Google service-account auth loader for GSC + GA4.
 * Reads credentials from (in order):
 *  1. GOOGLE_SERVICE_ACCOUNT_JSON env var (raw JSON string) — used in GitHub Actions.
 *  2. ./secrets/gsc-ga4-service-account.json — used for local runs (gitignored).
 */
function loadCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  }
  const localPath = './secrets/gsc-ga4-service-account.json';
  if (existsSync(localPath)) {
    return JSON.parse(readFileSync(localPath, 'utf8'));
  }
  throw new Error(
    'No Google service account credentials found — set GOOGLE_SERVICE_ACCOUNT_JSON (GitHub Actions secret) ' +
    'or place the key at secrets/gsc-ga4-service-account.json (local dev).'
  );
}

export async function getGoogleAuthClient(scopes) {
  const credentials = loadCredentials();
  const auth = new google.auth.GoogleAuth({ credentials, scopes });
  return auth.getClient();
}
