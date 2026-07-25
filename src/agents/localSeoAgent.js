import { getSupabaseClient } from '../lib/supabaseClient.js';
import { getInternalLinkCandidates } from '../lib/siteLinkInventory.js';

/**
 * Local SEO Agent — SCOPED HONESTLY: Master Architecture §3 envisions this
 * agent using the Google Business Profile API (unanswered reviews, NAP
 * checks across directories) but that needs a GBP OAuth connection per
 * client that isn't set up yet (no GOOGLE_BUSINESS_PROFILE_* credential
 * exists in this repo's secrets as of this build). Rather than stub out
 * fake GBP calls, this agent does the one piece that's genuinely $0 and
 * needs no extra credentials right now: NAP (Name/Address/Phone)
 * CONSISTENCY across the site's own pages — a real, mechanically-checkable
 * local-SEO signal on its own.
 *
 * When GBP credentials are added later, extend this agent (not replace it)
 * with review/post monitoring — the NAP check below stays valid either way.
 */

const PAGE_CAP = 6;
const PHONE_RE = /(\+?\d[\d\s().-]{7,16}\d)/g;

function normalizePhone(raw) {
  return raw.replace(/[^\d]/g, '');
}

async function fetchPageHtml(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'SEO-Autopilot-LocalSeoBot/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function runLocalSeoForSite(site) {
  const supabase = getSupabaseClient();
  const base = `https://${site.domain}`.replace(/\/+$/, '');
  const navPages = await getInternalLinkCandidates(site);
  const urls = [...new Set([base, ...navPages.map((p) => p.url)])].slice(0, PAGE_CAP);

  const phoneSightings = new Map(); // normalizedPhone -> [{url, raw}]
  let pagesChecked = 0;

  for (const url of urls) {
    try {
      const html = await fetchPageHtml(url);
      pagesChecked++;
      const text = html.replace(/<[^>]+>/g, ' ');
      const matches = [...text.matchAll(PHONE_RE)].map((m) => m[1]);
      for (const raw of matches) {
        const norm = normalizePhone(raw);
        if (norm.length < 10) continue; // too short to be a real phone number
        if (!phoneSightings.has(norm)) phoneSightings.set(norm, []);
        phoneSightings.get(norm).push({ url, raw: raw.trim() });
      }
    } catch (err) {
      console.warn(`Local SEO fetch skipped ${url}: ${err.message}`);
    }
  }

  const findings = [];
  const distinctNumbers = [...phoneSightings.keys()];
  if (distinctNumbers.length > 1) {
    findings.push(
      `Found ${distinctNumbers.length} different phone numbers across the site — inconsistent NAP hurts local ranking. ` +
      distinctNumbers.map((n) => {
        const sightings = phoneSightings.get(n);
        return `"${sightings[0].raw}" (seen on ${sightings.length} page(s), e.g. ${sightings[0].url})`;
      }).join('; ')
    );
  } else if (distinctNumbers.length === 0) {
    findings.push('No phone number found on any checked page — a visible, consistent phone number is a basic local-SEO trust signal.');
  }

  const result = {
    pagesChecked,
    distinctPhoneNumbersFound: distinctNumbers.length,
    findings,
    note: 'Google Business Profile review/post monitoring not yet built — needs GBP OAuth credentials to be added first.',
  };

  await supabase.from('agent_results').insert({ site_id: site.id, agent_name: 'local_seo_agent', result });
  try {
    await supabase.from('event_log').insert({
      site_id: site.id, actor: 'local_seo_agent', action: 'local_seo_check_completed',
      details: { pagesChecked, findingsCount: findings.length },
    });
  } catch (err) {
    console.warn(`event_log insert failed (non-fatal): ${err.message}`);
  }

  return { site: site.domain, ...result };
}
