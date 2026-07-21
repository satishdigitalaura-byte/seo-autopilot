import { getSupabaseClient } from '../lib/supabaseClient.js';
import { generateText } from '../lib/llmClient.js';
import { getInternalLinkCandidates } from '../lib/siteLinkInventory.js';
import { sendNotificationEmail } from '../lib/emailClient.js';
import { renderEmailShell } from '../lib/emailTemplate.js';
import { getAgentConfig } from '../lib/agentSettings.js';

/**
 * On-Page SEO Agent — an ADVISORY-ONLY per-page on-page audit. It fetches a
 * handful of the site's REAL live pages (from the site's own public nav API,
 * never a guessed URL list), downloads each page's raw HTML, and mechanically
 * checks the real on-page factors that matter for rankings:
 *
 *   - <title> presence + length (50-60 chars ideal)
 *   - meta description presence + length (150-160 chars ideal)
 *   - exactly one <h1>
 *   - heading hierarchy sanity (no skipped levels, e.g. h2 -> h4)
 *   - image alt-text coverage
 *   - internal link count
 *   - visible word count
 *   - canonical tag presence
 *   - JSON-LD structured-data presence
 *
 * EVERY number reported comes from the real parsed HTML — the mechanical
 * checks are done in code, never invented. The LLM is only ever handed those
 * real findings to write a short prioritized human summary; it is explicitly
 * told to reason only over the data given and never to fabricate metrics.
 *
 * This agent NEVER modifies the live site and NEVER creates content tasks —
 * it emails a branded report and logs to agent_results, nothing more.
 */

const PAGE_CAP = 8; // bound runtime — only audit up to this many top pages

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function analyzeHtml(html, pageUrl, siteDomain) {
  const findings = [];

  // <title>
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : null;
  const titleLen = title ? title.length : 0;
  if (!title) findings.push('Missing <title> tag.');
  else if (titleLen < 50) findings.push(`Title is short (${titleLen} chars; aim for 50-60).`);
  else if (titleLen > 60) findings.push(`Title is long (${titleLen} chars; aim for 50-60, it may truncate in results).`);

  // meta description
  const metaMatch = html.match(/<meta[^>]+name=["']description["'][^>]*>/i);
  const metaContent = metaMatch ? (metaMatch[0].match(/content=["']([\s\S]*?)["']/i)?.[1] || '').replace(/\s+/g, ' ').trim() : null;
  const metaLen = metaContent ? metaContent.length : 0;
  if (!metaContent) findings.push('Missing meta description.');
  else if (metaLen < 150) findings.push(`Meta description is short (${metaLen} chars; aim for 150-160).`);
  else if (metaLen > 160) findings.push(`Meta description is long (${metaLen} chars; aim for 150-160, it may truncate).`);

  // headings
  const h1Count = (html.match(/<h1[\s>]/gi) || []).length;
  if (h1Count === 0) findings.push('No <h1> found.');
  else if (h1Count > 1) findings.push(`Multiple <h1> tags (${h1Count}); a page should have exactly one.`);

  // heading hierarchy — flag skipped levels (e.g. h2 followed by h4)
  const headingLevels = [...html.matchAll(/<h([1-6])[\s>]/gi)].map((m) => Number(m[1]));
  let skipped = false;
  for (let i = 1; i < headingLevels.length; i++) {
    if (headingLevels[i] - headingLevels[i - 1] > 1) { skipped = true; break; }
  }
  if (skipped) findings.push('Heading hierarchy skips a level (e.g. an <h2> jumps straight to <h4>).');

  // images + alt coverage
  const imgTags = html.match(/<img\b[^>]*>/gi) || [];
  const imgsWithAlt = imgTags.filter((t) => /\balt=["'][^"']*["']/i.test(t) && !/\balt=["']["']/i.test(t)).length;
  const altCoverage = imgTags.length ? Math.round((imgsWithAlt / imgTags.length) * 100) : 100;
  if (imgTags.length && altCoverage < 100) {
    findings.push(`${imgTags.length - imgsWithAlt} of ${imgTags.length} images missing alt text (${altCoverage}% covered).`);
  }

  // internal links
  const hrefs = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map((m) => m[1]);
  const internalLinks = hrefs.filter((h) => h.startsWith('/') || h.includes(siteDomain)).length;
  if (internalLinks < 3) findings.push(`Only ${internalLinks} internal link(s); consider adding more to strengthen internal linking.`);

  // visible word count
  const wordCount = stripTags(html).split(/\s+/).filter(Boolean).length;
  if (wordCount < 300) findings.push(`Thin content (~${wordCount} visible words).`);

  // canonical
  const hasCanonical = /<link[^>]+rel=["']canonical["'][^>]*>/i.test(html);
  if (!hasCanonical) findings.push('No canonical tag found.');

  // JSON-LD schema
  const hasJsonLd = /<script[^>]+type=["']application\/ld\+json["']/i.test(html);
  if (!hasJsonLd) findings.push('No JSON-LD structured data found.');

  // per-page score: start at 100, subtract for each real issue
  const score = Math.max(0, 100 - findings.length * 10);

  return {
    url: pageUrl,
    score,
    title,
    titleLen,
    metaLen,
    hasMeta: !!metaContent,
    h1Count,
    headingSkipped: skipped,
    imageCount: imgTags.length,
    altCoverage,
    internalLinks,
    wordCount,
    hasCanonical,
    hasJsonLd,
    findings,
  };
}

async function fetchPageHtml(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': 'SEO-Autopilot-OnPageBot/1.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function runOnPageAuditForSite(site) {
  const supabase = getSupabaseClient();
  const siteDomain = site.domain;
  const base = `https://${siteDomain}`.replace(/\/+$/, '');

  // Real live pages, straight from the site's own nav API.
  const navPages = await getInternalLinkCandidates(site);
  const urls = [base, ...navPages.map((p) => p.url)];
  const uniqueUrls = [...new Set(urls)].slice(0, PAGE_CAP);

  if (uniqueUrls.length === 0) {
    return { skipped: true, reason: 'no live pages discoverable from the site nav API' };
  }

  const pages = [];
  for (const url of uniqueUrls) {
    try {
      const html = await fetchPageHtml(url);
      pages.push(analyzeHtml(html, url, siteDomain));
    } catch (err) {
      // Fail-soft: one bad page must never abort the whole run.
      console.warn(`On-page audit skipped ${url}: ${err.message}`);
    }
  }

  if (pages.length === 0) {
    return { skipped: true, reason: 'no pages could be fetched' };
  }

  const avgScore = Math.round(pages.reduce((s, p) => s + p.score, 0) / pages.length);
  const totalIssues = pages.reduce((s, p) => s + p.findings.length, 0);

  let summary = '';
  try {
    summary = await buildLlmSummary(site, pages);
  } catch (err) {
    console.warn(`On-page LLM summary failed for ${siteDomain} (non-fatal): ${err.message}`);
  }

  const result = {
    pagesAudited: pages.length,
    averageScore: avgScore,
    totalIssues,
    pages,
    summary,
  };

  await supabase.from('agent_results').insert({
    site_id: site.id,
    agent_name: 'on_page_seo_agent',
    result,
  });

  await sendNotificationEmail({
    subject: `[On-Page SEO] ${siteDomain} — avg score ${avgScore}/100 across ${pages.length} pages`,
    html: buildEmail(site, result),
  });

  try {
    await supabase.from('event_log').insert({
      site_id: site.id,
      actor: 'on_page_seo_agent',
      action: 'on_page_audit_completed',
      details: { pagesAudited: pages.length, averageScore: avgScore, totalIssues },
    });
  } catch (err) {
    console.warn(`event_log insert failed (non-fatal): ${err.message}`);
  }

  return { site: siteDomain, ...result };
}

// Backwards/naming-friendly alias matching seoAuditAgent's exported style.
export const runOnPageSeoAudit = runOnPageAuditForSite;

async function buildLlmSummary(site, pages) {
  const agentConfig = await getAgentConfig('on_page_seo_agent');
  // Hand the LLM ONLY the real mechanical findings. It must not invent metrics.
  const findingsBlock = pages.map((p) => {
    const path = p.url.replace(/^https?:\/\/[^/]+/, '') || '/';
    return `Page: ${path} (score ${p.score}/100)\n` +
      (p.findings.length ? p.findings.map((f) => `  - ${f}`).join('\n') : '  - No issues found.');
  }).join('\n\n');

  const prompt = `You are an SEO analyst. Below are REAL on-page audit findings for ${site.domain}, produced by mechanically parsing each page's live HTML. Do NOT invent any numbers, pages, or issues that are not listed here — only reason over what is given.

Write a short (max ~150 words), prioritized, plain-English summary for a non-technical site owner: which 3-4 fixes would have the biggest SEO impact and why, in order. Be concrete and reference the actual pages/issues listed.

FINDINGS:
${findingsBlock}`;

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
  const cell = (c, extra = '') => `<td style="padding:6px 10px;border-bottom:1px solid #E5E7EB;font-size:13px;${extra}">${c}</td>`;
  const scoreColor = (s) => (s >= 80 ? '#22C55E' : s >= 50 ? '#FF6B2B' : '#EF4444');

  const pageBlocks = r.pages.map((p) => {
    const path = p.url.replace(/^https?:\/\/[^/]+/, '') || '/';
    const issues = p.findings.length
      ? `<ul style="margin:6px 0 0;padding-left:18px;color:#374151;font-size:12px;">${p.findings.map((f) => `<li style="margin-bottom:3px;">${f}</li>`).join('')}</ul>`
      : `<p style="margin:6px 0 0;color:#22C55E;font-size:12px;">No issues found — this page passes all on-page checks.</p>`;
    return `
      <div style="margin-bottom:16px;padding:12px 14px;border:1px solid #E5E7EB;border-radius:10px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-size:13px;font-weight:600;color:#0A1628;word-break:break-all;">${path}</td>
          <td style="text-align:right;white-space:nowrap;"><span style="font-size:13px;font-weight:700;color:${scoreColor(p.score)};">${p.score}/100</span></td>
        </tr></table>
        <div style="font-size:11px;color:#6B7280;margin-top:4px;">
          title ${p.titleLen}ch &middot; meta ${p.hasMeta ? p.metaLen + 'ch' : 'missing'} &middot; ${p.h1Count} h1 &middot; ${p.wordCount} words &middot; alt ${p.altCoverage}% &middot; ${p.internalLinks} internal links &middot; canonical ${p.hasCanonical ? 'yes' : 'no'} &middot; schema ${p.hasJsonLd ? 'yes' : 'no'}
        </div>
        ${issues}
      </div>`;
  }).join('');

  const summaryHtml = r.summary
    ? `<div style="background:#F8FAFF;border-radius:10px;padding:14px 16px;margin:0 0 20px;font-size:13px;color:#374151;line-height:1.6;white-space:pre-wrap;">${r.summary}</div>`
    : '';

  const bodyHtml = `
    <p style="color:#6B7280;font-size:13px;">Audited ${r.pagesAudited} live page(s) &middot; average on-page score <strong style="color:${scoreColor(r.averageScore)};">${r.averageScore}/100</strong> &middot; ${r.totalIssues} total issue(s) found.</p>
    ${summaryHtml}
    <h3 style="color:#0A1628;font-size:15px;margin:20px 0 8px;">Per-page findings</h3>
    <p style="color:#6B7280;font-size:12px;margin:0 0 12px;">Every number below was read directly from the page's live HTML. Advisory only — nothing was changed on your site.</p>
    ${pageBlocks}`;

  return renderEmailShell({
    badgeLabel: 'On-Page SEO',
    badgeTone: r.averageScore >= 80 ? 'good' : 'warning',
    heading: `${site.domain} — On-Page SEO Report`,
    bodyHtml,
  });
}
