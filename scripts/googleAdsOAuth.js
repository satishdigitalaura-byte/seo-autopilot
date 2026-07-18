// One-time helper: gets a Google Ads API refresh token via OAuth consent.
// Run with `node scripts/googleAdsOAuth.js`, open the printed URL, log in
// with the Google account that has access to the Ads account, grant access.
// This script catches the redirect locally and prints the refresh token —
// paste that into .env as GOOGLE_ADS_OAUTH_REFRESH_TOKEN.
import 'dotenv/config';
import http from 'node:http';
import { google } from 'googleapis';

const PORT = 8080;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_ADS_OAUTH_CLIENT_ID,
  process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET,
  REDIRECT_URI,
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/adwords'],
});

console.log('\nOpen this URL, log in with the Google account that has access to the Ads account, and approve:\n');
console.log(authUrl);
console.log('\nWaiting for you to approve in the browser...\n');

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/oauth2callback')) {
    res.writeHead(404);
    res.end();
    return;
  }
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<h2>Denied: ${error}</h2>You can close this tab.`);
    console.error('Consent denied or errored:', error);
    server.close();
    process.exit(1);
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>Success — refresh token captured.</h2>You can close this tab and go back to the terminal.');
    console.log('\n=== SUCCESS ===');
    console.log('Refresh token (add this to .env as GOOGLE_ADS_OAUTH_REFRESH_TOKEN):\n');
    console.log(tokens.refresh_token);
    console.log('');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end('<h2>Token exchange failed.</h2>Check the terminal.');
    console.error('Token exchange failed:', err.message);
  } finally {
    server.close();
  }
});

server.listen(PORT);
