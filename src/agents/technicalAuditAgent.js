import { getSupabaseClient } from '../lib/supabaseClient.js';
import { generateText } from '../lib/llmClient.js';
import { getInternalLinkCandidates } from '../lib/siteLinkInventory.js';
import { getPageClicks } from '../lib/gscClient.js';
import { sendNotificationEmail } from '../lib/emailClient.js';
import { renderEmailShell } from '../lib/emailTemplate.js';
import { getAgentConfig } from '../lib/agentSettings.js';

/**
 * Technical Audit Agent — an ADVISORY-ONLY, site-wide technical SEO health
 * check. Every check is a REAL HTTP request or real GSC data; nothing is
 * invented. It:
 *
 *   - GETs robots.txt (present/absent) and sitemap.xml (present/absent + real
 *     URL count parsed from the XML).
 *   - Fetches the homepage + a few real key pages and checks, per page:
 *       * HTTPS
 *       * canonical correctness — the canonical should point to the page's OWN
 *         URL, NOT the homepage. Pointing every page's canonical at the
 *         homepage is a KNOWN real bug on this project's SPA sites, so any page
 *         whose canonical != its own URL is flagged loudly.
 *       * unique <title>/meta per page — if the title/meta is identical across
 *         pages, that's the known SPA meta bug (the shell's static tags never
 *         get overwritten per route), also flagged.
 *       * viewport meta (mobile-friendliness signal)
 *       * structured data (JSON-LD) presence
 *   - Pulls real GSC index-coverage signal (how many pages GSC actually has
 *     data for) when a gsc_property credential exists.
 *
 * The LLM only ever summarizes the real findings — it is told never to
 * fabricate. This agent NEVER modifies the site and NEVER creates content tasks.
 */

const PAGE_CAP = 6;

function normalizeUrl(u) {
  return (u || '').replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase();
}

async function fetchText(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': 'SEO-Autopilot-TechBot/1.0' },
  });
  return { ok: res.ok, status: res.status, text: res.ok ? await res.text() : '', finalUrl: res.url };
}

function analyzePageHtml(html, pageUrl) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : null;

  const metaMatch = html.match(/<meta[^>]+name=["']description["'][^>]*>/i);
  const meta = metaMatch ? (metaMatch[0].match(/content=["']([\s\S]*?)["']/i)?.[1] || '').replace(/\s+/g, ' ').trim() : null;

  const canonMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i);
  const canonical = canonMatch ? (canonMatch[0].match(/href=["']([^"']+)["']/i)?.[1] || null) : null;

  const hasViewport = /<meta[^>]+name=["']viewport["'][^>]*>/i.test(html);
  const hasJsonLd = /<script[^>]+type=["']application\/ld\+json["']/i.test(html);

  return { url: pageUrl, title, meta, canonical, hasViewport, hasJsonLd };
}

function parseSitemapUrlCount(xml) {
  const locs = xml.match(/<loc>/gi);
  return locs ? locs.length : 0;
}

export async function runTechnicalAuditForSite(site) {
  const supabase = getSupabaseClient();
  const siteDomain = site.domain;
  const base = `https://${siteDomain}`.replace(/\/+$/, '');
  const issues = [];

  // robots.txt
  let robots = { present: false };
  try {
    const r = await fetchText(`${base}/robots.txt`);
    robots = { present: r.ok, status: r.status, hasSitemapDirective: /sitemap:/i.test(r.text) };
    if (!r.ok) issues.push('robots.txt is missing or unreachable.');
  } catch (err) {
    issues.push(`robots.txt could not be fetched: ${err.message}`);
  }

  // sitemap.xml
  let sitemap = { present: false, urlCount: 0 };
  try {
    const s = await fetchText(`${base}/sitemap.xml`);
    sitemap = { present: s.ok, status: s.status, urlCount: s.ok ? parseSitemapUrlCount(s.text) : 0 };
    if (!s.ok) issues.push('sitemap.xml is missing or unreachable.');
    else if (sitemap.urlCount === 0) issues.push('sitemap.xml is present but contains 0 URLs.');
  } catch (err) {
    issues.push(`sitemap.xml could not be fetched: ${err.message}`);
  }

  // Pick real key pages: homepage + a few from the live nav API.
  const navPages = await getInternalLinkCandidates(site);
  const urls = [base, ...navPages.map((p) => p.url)];
  const uniqueUrls = [...new Set(urls)].slice(0, PAGE_CAP);

  const pages = [];
  for (const url of uniqueUrls) {
    try {
      const r = await fetchText(url);
      if (!r.ok) {
        issues.push(`${url} returned HTTP ${r.status}.`);
        continue;
      }
      const analyzed = analyzePageHtml(r.text, url);
      analyzed.isHttps = url.startsWith('https://');
      if (!analyzed.isHttps) issues.push(`${url} is not served over HTTPS.`);
      if (!analyzed.hasViewport) issues.push(`${url} is missing a viewport meta tag (mobile-friendliness).`);
      if (!analyzed.hasJsonLd) issues.push(`${url} has no structured data (JSON-LD).`);

      // Canonical correctness — must point to the page's OWN url, not homepage.
      if (!analyzed.canonical) {
        issues.push(`${url} has no canonical tag.`);
      } else {
        const canon = normalizeUrl(analyzed.canonical);
        const self = normalizeUrl(url);
        const home = normalizeUrl(base);
        if (canon !== self) {
          if (canon === home && self !== home) {
            issues.push(`CANONICAL BUG: ${url} has its canonical pointing at the homepage (${analyzed.canonical}) instead of itself — this de-indexes the page.`);
            analyzed.canonicalBug = true;
          } else {
            issues.push(`${url} canonical points to ${analyzed.canonical}, not its own URL.`);
            analyzed.canonicalBug = true;
          }
        }
      }
      pages.push(analyzed);
    } catch (err) {
      console.warn(`Technical audit skipped ${url}: ${err.message}`);
    }
  }

  // Duplicate title / meta across pages = the SPA static-meta bug.
  const titles = pages.map((p) => (p.title || '').trim()).filter(Boolean);
  const metas = pages.map((p) => (p.meta || '').trim()).filter(Boolean);
  const uniqueTitles = new Set(titles);
  const uniqueMetas = new Set(metas);
  let duplicateMeta = false;
  if (pages.length > 1 && titles.length > 1 && uniqueTitles.size === 1) {
    duplicateMeta = true;
    issues.push(`SPA META BUG: all ${titles.length} audited pages share the identical <title> ("${titles[0]}") — per-page titles are not being set.`);
  }
  if (pages.length > 1 && metas.length > 1 && uniqueMetas.size === 1) {
    duplicateMeta = true;
    issues.push(`SPA META BUG: all ${metas.length} audited pages share the identical meta description — per-page descriptions are not being set.`);
  }

  // Real GSC index-coverage signal (optional — only if credential present).
  let gscIndex = { available: false };
  try {
    const { data: creds } = await supabase
      .from('site_credentials')
      .select('credential_key, credential_value')
      .eq('site_id', site.id)
      .eq('credential_key', 'gsc_property');
    const gscProperty = creds && creds[0] ? creds[0].credential_value : null;
    if (gscProperty) {
      const end = new Date(); end.setUTCDate(end.getUTCDate() - 3);
      const start = new Date(); start.setUTCDate(start.getUTCDate() - 31);
      const byPage = await getPageClicks(gscProperty, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10));
      gscIndex = { available: true, pagesWithData: byPage.size };
      if (sitemap.present && sitemap.urlCount > 0 && byPage.size < sitemap.urlCount * 0.5) {
        issues.push(`GSC only has search data for ${byPage.size} page(s) vs. ${sitemap.urlCount} in the sitemap — possible indexing gap worth checking in Search Console.`);
      }
    }
  } catch (err) {
    console.warn(`GSC index-coverage fetch failed for ${siteDomain} (non-fatal): ${err.message}`);
  }

  const result = {
    robots,
    sitemap,
    pagesChecked: pages.length,
    pages,
    duplicateMeta,
    gscIndex,
    issueCount: issues.length,
    issues,
    summary: '',
  };

  try {
    result.summary = await buildLlmSummary(site, result);
  } catch (err) {
    console.warn(`Technical-audit LLM summary failed for ${siteDomain} (non-fatal): ${err.message}`);
  }

  await supabase.from('agent_results').insert({
    site_id: site.id,
    agent_name: 'technical_audit_agent',
    result,
  });

  await sendNotificationEmail({
    subject: `[Technical Audit] ${siteDomain} — ${issues.length} issue(s) found`,
    html: buildEmail(site, result),
  });

  try {
    await supabase.from('event_log').insert({
      site_id: site.id,
      actor: 'technical_audit_agent',
      action: 'technical_audit_completed',
      details: { issueCount: issues.length, pagesChecked: pages.length, duplicateMeta },
    });
  } catch (err) {
    console.warn(`event_log insert failed (non-fatal): ${err.message}`);
  }

  return { site: siteDomain, ...result };
}

// Alias matching the requested export name.
export const runTechnicalAudit = runTechnicalAuditForSite;

async function buildLlmSummary(site, r) {
  const agentConfig = await getAgentConfig('technical_audit_agent');
  const issuesBlock = r.issues.length ? r.issues.map((i) => `  - ${i}`).join('\n') : '  - No technical issues found.';
  const prompt = `You are a technical SEO analyst. Below are REAL technical-audit findings for ${site.domain}, produced by making live HTTP requests and reading real Search Console data. Do NOT invent any issue, page, or number that is not listed — reason only over what is given.

Write a short (max ~150 words), prioritized, plain-English summary for a non-technical site owner: which issues are most urgent (especially any canonical or duplicate-meta bugs, which silently hurt indexing) and what to do about each, in order.

CONTEXT: robots.txt present=${r.robots.present}; sitemap present=${r.sitemap.present} with ${r.sitemap.urlCount} URLs; pages checked=${r.pagesChecked}; GSC pages with data=${r.gscIndex.available ? r.gscIndex.pagesWithData : 'n/a'}.

ISSUES:
${issuesBlock}`;

  try {
    return await generateText({
      prompt,
      maxTokens: agentConfig.maxTokens || 700,
      temperature: 0.4,
      model: agentConfig.modelName || undefined,
      provider: agentConfig.modelProvider,
    });
  } catch (err) {
    console.warn(`${agentConfig.modelProvider} model unavailable, falling back to Gemini lite:`, err.message);
    return generateText({ prompt, maxTokens: 700, temperature: 0.4 });
  }
}

function buildEmail(site, r) {
  const yn = (b) => (b ? '<span style="color:#22C55E;">yes</span>' : '<span style="color:#EF4444;">no</span>');

  const summaryHtml = r.summary
    ? `<div style="background:#F8FAFF;border-radius:10px;padding:14px 16px;margin:0 0 20px;font-size:13px;color:#374151;line-height:1.6;white-space:pre-wrap;">${r.summary}</div>`
    : '';

  const issuesHtml = r.issues.length
    ? `<ul style="margin:6px 0 20px;padding-left:18px;color:#374151;font-size:13px;line-height:1.6;">${r.issues.map((i) => `<li style="margin-bottom:5px;">${i}</li>`).join('')}</ul>`
    : `<p style="color:#22C55E;font-size:13px;">No technical issues found — all checks passed.</p>`;

  const pageRows = r.pages.map((p) => {
    const path = p.url.replace(/^https?:\/\/[^/]+/, '') || '/';
    return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #E5E7EB;font-size:12px;word-break:break-all;">${path}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #E5E7EB;font-size:12px;text-align:center;">${yn(p.isHttps)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #E5E7EB;font-size:12px;text-align:center;">${p.canonicalBug ? '<span style="color:#EF4444;">wrong</span>' : yn(!!p.canonical)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #E5E7EB;font-size:12px;text-align:center;">${yn(p.hasViewport)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #E5E7EB;font-size:12px;text-align:center;">${yn(p.hasJsonLd)}</td>
    </tr>`;
  }).join('');

  const bodyHtml = `
    <p style="color:#6B7280;font-size:13px;">${r.issueCount} issue(s) found across ${r.pagesChecked} page(s). Advisory only — nothing was changed on your site.</p>
    ${summaryHtml}
    <h3 style="color:#0A1628;font-size:15px;margin:20px 0 8px;">Site-wide checks</h3>
    <ul style="margin:6px 0 16px;padding-left:18px;color:#374151;font-size:13px;line-height:1.7;">
      <li>robots.txt present: ${yn(r.robots.present)}</li>
      <li>sitemap.xml present: ${yn(r.sitemap.present)} ${r.sitemap.present ? `(${r.sitemap.urlCount} URLs)` : ''}</li>
      <li>Per-page unique titles/meta: ${r.duplicateMeta ? '<span style="color:#EF4444;">duplicate detected (SPA meta bug)</span>' : yn(true)}</li>
      <li>GSC pages with search data: ${r.gscIndex.available ? r.gscIndex.pagesWithData : 'n/a (no gsc_property credential)'}</li>
    </ul>
    <h3 style="color:#0A1628;font-size:15px;margin:20px 0 8px;">All issues</h3>
    ${issuesHtml}
    <h3 style="color:#0A1628;font-size:15px;margin:20px 0 8px;">Per-page technical checks</h3>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr>${['Page', 'HTTPS', 'Canonical', 'Viewport', 'Schema'].map((h) => `<th style="text-align:${h === 'Page' ? 'left' : 'center'};padding:6px 10px;font-size:11px;color:#6B7280;text-transform:uppercase;border-bottom:2px solid #0A1628;">${h}</th>`).join('')}</tr>
      ${pageRows}
    </table>`;

  return renderEmailShell({
    badgeLabel: 'Technical Audit',
    badgeTone: r.issueCount === 0 ? 'good' : 'warning',
    heading: `${site.domain} — Technical SEO Audit`,
    bodyHtml,
  });
}
