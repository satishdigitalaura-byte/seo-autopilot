import { getSupabaseClient } from '../lib/supabaseClient.js';
import { generateText } from '../lib/llmClient.js';
import { getInternalLinkCandidates } from '../lib/siteLinkInventory.js';
import { getAgentConfig } from '../lib/agentSettings.js';
import { getKnowledgeBlock, SEO_EXPERT_PERSONA } from '../lib/seoKnowledge.js';

/**
 * E-E-A-T Agent — an ADVISORY-ONLY audit of real, live pages against
 * Google's Experience/Expertise/Authoritativeness/Trustworthiness signals
 * (Guidelines §3). Per that section: E-E-A-T is not a literal ranking score
 * to compute — it's a quality-rater framework. This agent checks the
 * concrete, page-level PROXIES the Guidelines doc lists as what an audit
 * agent should actually look for, never invents a numeric "E-E-A-T score"
 * as if it were a real Google metric.
 *
 * Checks, all mechanical (regex/string) against real fetched HTML — nothing
 * here is guessed or invented:
 *   - Named author byline present (not "Admin"/empty)
 *   - A linked author bio (credentials) reachable from the byline
 *   - A visible "last updated/reviewed" date
 *   - At least one outbound citation to an external authoritative source
 *   - Site-wide trust signals: About page and Contact page exist in nav
 *
 * NEVER edits the live site or drafts content — flags gaps only, exactly
 * like On-Page SEO Agent and Technical Audit Agent, and logs to
 * agent_results for the panel's Activity feed (no email; routine finding).
 */

const PAGE_CAP = 8;

function stripTags(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function analyzeEeat(html, pageUrl, siteDomain) {
  const findings = [];
  const text = stripTags(html);

  // Author byline — look for common byline markers or a rel="author"/schema Person mention.
  const bylineMatch = html.match(/(?:by|author)[\s:]*<[^>]*>\s*([A-Z][a-zA-Z.\-' ]{2,40})/i)
    || html.match(/"author"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]{2,60})"/i)
    || html.match(/class="[^"]*(?:author|byline)[^"]*"[^>]*>\s*([A-Z][a-zA-Z.\-' ]{2,40})/i);
  const authorName = bylineMatch ? bylineMatch[1].trim() : null;
  const hasNamedAuthor = !!authorName && !/^(admin|staff|team|editor)$/i.test(authorName);
  if (!hasNamedAuthor) findings.push('No named author byline found (or it reads generic like "Admin"/"Team") — Guidelines §3 flags unnamed/generic bylines as a weak Expertise signal.');

  // Author bio / credentials link near the byline
  const hasAuthorLink = /href="[^"]*\/(author|about|team)[^"]*"/i.test(html);
  if (hasNamedAuthor && !hasAuthorLink) findings.push('Author name is present but no link to an author bio / credentials page was found.');

  // Last updated/reviewed date
  const hasUpdatedDate = /(last updated|last reviewed|updated on|reviewed on)/i.test(text)
    || /"dateModified"\s*:\s*"/i.test(html);
  if (!hasUpdatedDate) findings.push('No visible "last updated/reviewed" date — important freshness/Trust signal, especially for YMYL topics.');

  // Outbound citation to an external authoritative source
  const outboundLinks = [...html.matchAll(/<a\b[^>]*href="(https?:\/\/[^"]+)"/gi)]
    .map((m) => m[1])
    .filter((u) => !u.includes(siteDomain));
  if (outboundLinks.length === 0) findings.push('No outbound citations to external sources found — Authoritativeness signals typically include links to primary/authoritative references.');

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const score = Math.max(0, 100 - findings.length * 20);

  return {
    url: pageUrl,
    score,
    hasNamedAuthor,
    authorName: authorName || null,
    hasAuthorLink,
    hasUpdatedDate,
    outboundCitationCount: outboundLinks.length,
    wordCount,
    findings,
  };
}

async function fetchPageHtml(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'SEO-Autopilot-EEATBot/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function checkSiteWideTrustSignals(site, navPages) {
  const findings = [];
  const hasAbout = navPages.some((p) => /\/about\b/i.test(p.url));
  const hasContact = navPages.some((p) => /\/contact\b/i.test(p.url));
  if (!hasAbout) findings.push('No "About" page found in site navigation — transparent ownership info is a core Trust signal.');
  if (!hasContact) findings.push('No "Contact" page found in site navigation.');
  return findings;
}

export async function runEeatAuditForSite(site) {
  const supabase = getSupabaseClient();
  const siteDomain = site.domain;
  const base = `https://${siteDomain}`.replace(/\/+$/, '');

  const navPages = await getInternalLinkCandidates(site);
  const siteWideFindings = await checkSiteWideTrustSignals(site, navPages);

  const urls = [...new Set([base, ...navPages.map((p) => p.url)])].slice(0, PAGE_CAP);
  if (urls.length === 0) return { skipped: true, reason: 'no live pages discoverable from the site nav API' };

  const pages = [];
  for (const url of urls) {
    try {
      const html = await fetchPageHtml(url);
      pages.push(analyzeEeat(html, url, siteDomain));
    } catch (err) {
      console.warn(`E-E-A-T audit skipped ${url}: ${err.message}`);
    }
  }
  if (pages.length === 0) return { skipped: true, reason: 'no pages could be fetched' };

  const avgScore = Math.round(pages.reduce((s, p) => s + p.score, 0) / pages.length);
  const totalIssues = pages.reduce((s, p) => s + p.findings.length, 0) + siteWideFindings.length;

  let summary = '';
  try {
    summary = await buildLlmSummary(site, pages, siteWideFindings);
  } catch (err) {
    console.warn(`E-E-A-T LLM summary failed for ${siteDomain} (non-fatal): ${err.message}`);
  }

  const result = { pagesAudited: pages.length, averageScore: avgScore, totalIssues, siteWideFindings, pages, summary };

  await supabase.from('agent_results').insert({ site_id: site.id, agent_name: 'eeat_agent', result });
  try {
    await supabase.from('event_log').insert({
      site_id: site.id, actor: 'eeat_agent', action: 'eeat_audit_completed',
      details: { pagesAudited: pages.length, averageScore: avgScore, totalIssues },
    });
  } catch (err) {
    console.warn(`event_log insert failed (non-fatal): ${err.message}`);
  }

  return { site: siteDomain, ...result };
}

async function buildLlmSummary(site, pages, siteWideFindings) {
  const agentConfig = await getAgentConfig('eeat_agent');
  const findingsBlock = pages.map((p) => {
    const path = p.url.replace(/^https?:\/\/[^/]+/, '') || '/';
    return `Page: ${path} (score ${p.score}/100)\n` + (p.findings.length ? p.findings.map((f) => `  - ${f}`).join('\n') : '  - No issues found.');
  }).join('\n\n');
  const siteWideBlock = siteWideFindings.length ? siteWideFindings.map((f) => `  - ${f}`).join('\n') : '  - None.';

  // Prompt written as if briefed by an SEO practitioner with real hands-on
  // E-E-A-T remediation experience: specific, prioritized, no generic filler,
  // and explicitly anchored to Google's actual framework (not an invented score).
  const prompt = `You are a senior SEO consultant with 8+ years of hands-on experience specifically remediating E-E-A-T issues for real client sites (including YMYL sites that have gone through Google reviews). You are briefing ${site.domain}'s owner on real findings from a live audit — every finding below came from mechanically parsing the site's actual HTML; do not invent anything beyond what's listed.

Remember while writing: E-E-A-T is not a literal ranking factor or a score Google computes — it's the framework human quality raters use, which correlates with ranking outcomes over time. Frame your advice that way, not as "your E-E-A-T score is X."
${getKnowledgeBlock('eeat')}
SITE-WIDE TRUST SIGNALS:
${siteWideBlock}

PER-PAGE FINDINGS:
${findingsBlock}

Write a prioritized, plain-English brief (max ~180 words) for a non-technical site owner: the 3-4 fixes that would most credibly improve how a human quality rater (and therefore the algorithms trained on their judgments) would perceive this site's Experience/Expertise/Authoritativeness/Trustworthiness. Be concrete — name the actual pages/gaps listed above, not generic advice like "add more expert content."`;

  try {
    return await generateText({ prompt, maxTokens: agentConfig.maxTokens || 700, temperature: 0.4, model: agentConfig.modelName || undefined, provider: agentConfig.modelProvider });
  } catch (err) {
    console.warn(`${agentConfig.modelProvider} model unavailable, falling back to Gemini lite:`, err.message);
    return generateText({ prompt, maxTokens: 700, temperature: 0.4 });
  }
}
