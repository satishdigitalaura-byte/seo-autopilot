import { getSupabaseClient } from '../lib/supabaseClient.js';
import { generateText } from '../lib/llmClient.js';
import { getAgentConfig } from '../lib/agentSettings.js';
import { getKnowledgeBlock, SEO_EXPERT_PERSONA } from '../lib/seoKnowledge.js';
import { fetchPageHtml, analyzeHtml } from './onPageSeoAgent.js';
import { getPublishedPosts } from '../lib/siteLinkInventory.js';
import { withSiteSecret } from '../lib/siteCredentials.js';
import { runRuleChecks } from '../rules/guidelinesRuleset.js';

/**
 * Content Edit Agent — turns advisory audit findings into concrete, reviewable
 * edit proposals for content that is ALREADY live.
 *
 * The audit agents deliberately never touch the site; they only report. That
 * left every finding needing a human to go and hand-fix it. This agent closes
 * that loop without giving up the safety gate: it proposes the exact new value
 * for each fixable finding and queues it as an `approve_edit` task. Nothing
 * reaches the live site until a human clicks Approve in the panel.
 *
 * Scope is deliberately narrow — only fields that genuinely live in the site's
 * database. A page's visible body text lives in the site's React source, so
 * findings about headings/word count on a PAGE stay advisory (there is no safe
 * DB-only fix for them). Blog posts store real HTML, so their body is in scope.
 */

const PROPOSAL_CAP = 6; // bound one run's output so a bad audit can't flood the queue

/**
 * Which guardrail rules gate an EDIT. The full ruleset is written for
 * commissioning a brand-new post, so several of its checks are meaningless
 * here and would reject every edit outright — `original_element_required`
 * demands a client-supplied fact that an edit has no reason to carry, and
 * `scaled_content_abuse`/`content_length` are about whether a new piece
 * should have been written at all. What genuinely matters for a rewrite is
 * whether the resulting HTML is abusive, so only those checks apply.
 */
const EDIT_SAFETY_CHECKS = ['hidden_text', 'keyword_stuffing', 'design_safe_markup', 'no_external_links', 'sneaky_redirect'];

function failsEditSafety(html, site) {
  const { checks } = runRuleChecks({ content: html }, site);
  return checks.filter((c) => EDIT_SAFETY_CHECKS.includes(c.id) && !c.passed && c.severity === 'reject');
}

// Only findings whose fix is a database field. Each returns the field to
// change, or null if this finding isn't fixable for that target type.
function classifyFinding(finding, targetType) {
  if (/^Title is (long|short)/i.test(finding) || /Missing <title>/i.test(finding)) {
    return { field: 'meta_title', label: 'Title tag' };
  }
  if (/meta description/i.test(finding)) {
    return { field: 'meta_desc', label: 'Meta description' };
  }
  if (/No canonical tag/i.test(finding)) {
    return { field: 'canonical', label: 'Canonical URL' };
  }
  // Body-content fixes are only possible where the body is actually in the DB.
  if (targetType === 'blog' && /Thin content|missing alt text|Heading hierarchy/i.test(finding)) {
    return { field: 'content', label: 'Body content' };
  }
  return null;
}

function isBlogUrl(url) {
  return /\/blog\//.test(url);
}

function slugFromUrl(url) {
  return url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/+|\/+$/g, '').split('/').pop() || '';
}

/**
 * Asks the model for ONE replacement value. Returns null rather than a
 * half-usable string if anything looks wrong — a proposal a human can't trust
 * is worse than no proposal.
 */
async function proposeValue({ field, label, finding, current, targetUrl, pageTitle, agentConfig }) {
  const rules = {
    meta_title: 'Write a single <title> tag value, 50-60 characters. No quotes, no surrounding markup.',
    meta_desc: 'Write a single meta description, 150-160 characters. No quotes, no surrounding markup.',
    canonical: 'Reply with only the canonical URL, including https:// and a trailing slash.',
    content: 'Return the corrected HTML body only. Preserve all existing meaning, facts, numbers, links and structure — fix ONLY the issue described. Never invent new claims or statistics. If the existing content already uses any "da-" prefixed CSS classes (e.g. da-stat-callout, da-comparison-table, da-callout-tip — the site\'s styled content blocks), preserve those classes exactly as-is; do not strip or rename them.',
  }[field];

  const prompt = `${SEO_EXPERT_PERSONA}

You are fixing one specific, already-diagnosed SEO issue on a live page. Do not redesign anything else.

PAGE: ${targetUrl}
PAGE TITLE: ${pageTitle || '(unknown)'}
ISSUE FOUND BY AUDIT: ${finding}
FIELD TO FIX: ${label}

CURRENT VALUE:
${current || '(empty)'}
${getKnowledgeBlock('on_page')}
${rules}

Reply with ONLY the replacement value — no explanation, no labels, no markdown fences.`;

  let text;
  try {
    text = await generateText({
      prompt,
      maxTokens: field === 'content' ? (agentConfig.maxTokens || 4000) : 300,
      temperature: 0.4,
      model: agentConfig.modelName || undefined,
      provider: agentConfig.modelProvider,
    });
  } catch (err) {
    console.warn(`${agentConfig.modelProvider} unavailable for ${field}, falling back to Gemini:`, err.message);
    try {
      text = await generateText({ prompt, maxTokens: field === 'content' ? 4000 : 300, temperature: 0.4 });
    } catch (fallbackErr) {
      console.warn(`Fallback model also failed for ${field}: ${fallbackErr.message}`);
      return null;
    }
  }

  let value = (text || '').trim().replace(/^```[a-z]*\n?|```$/g, '').trim();
  if (field !== 'content') value = value.replace(/^["']|["']$/g, '').trim();
  if (!value) return null;

  // Reject a "fix" that doesn't actually satisfy the thing it was asked to fix,
  // rather than queueing a proposal that would fail the very next audit.
  if (field === 'meta_title' && (value.length < 45 || value.length > 65)) return null;
  if (field === 'meta_desc' && (value.length < 140 || value.length > 170)) return null;
  if (field === 'canonical' && !/^https:\/\//.test(value)) return null;
  if (value === (current || '').trim()) return null;

  return value;
}

/** Latest audit rows, newest first — these are the same results the panel shows. */
async function getLatestAuditPages(supabase, siteId) {
  const { data } = await supabase
    .from('agent_results')
    .select('result, created_at')
    .eq('agent_name', 'on_page_seo_agent')
    .eq('site_id', siteId)
    .order('created_at', { ascending: false })
    .limit(1);
  return data?.[0]?.result?.pages || [];
}

/** Skip anything already sitting in the queue so repeat runs don't pile up duplicates. */
async function getAlreadyQueuedSlugs(supabase, siteId) {
  const { data } = await supabase
    .from('agent_tasks')
    .select('payload')
    .eq('site_id', siteId)
    .eq('task_type', 'approve_edit')
    .eq('status', 'awaiting_approval');
  return new Set((data || []).map((t) => t.payload?.slug).filter(Boolean));
}

export async function runContentEditForSite(site) {
  const supabase = getSupabaseClient();
  const agentConfig = await getAgentConfig('content_edit_agent');

  const auditPages = await getLatestAuditPages(supabase, site.id);
  if (auditPages.length === 0) {
    const skipped = { skipped: true, reason: 'no on-page audit results yet to work from' };
    await supabase.from('agent_results').insert({ site_id: site.id, agent_name: 'content_edit_agent', result: skipped });
    return skipped;
  }

  const alreadyQueued = await getAlreadyQueuedSlugs(supabase, site.id);

  // Blog bodies come from the site's own post list; page metadata comes from
  // the live HTML. Loaded once here rather than per-finding.
  const siteWithSecret = await withSiteSecret(site);
  const posts = await getPublishedPosts(siteWithSecret);
  const postBySlug = new Map(posts.map((p) => [p.slug, p]));

  const proposals = [];
  const skippedFindings = [];

  for (const page of auditPages) {
    if (proposals.length >= PROPOSAL_CAP) break;
    if (!page.findings?.length) continue;

    const targetType = isBlogUrl(page.url) ? 'blog' : 'page';
    const slug = slugFromUrl(page.url) || 'home';
    if (alreadyQueued.has(slug)) continue;

    // Re-read the page live rather than trusting the audit snapshot: the audit
    // may be days old and someone may have already fixed it by hand.
    let live;
    try {
      live = analyzeHtml(await fetchPageHtml(page.url), page.url, site.domain);
    } catch (err) {
      console.warn(`Could not re-check ${page.url}: ${err.message}`);
      continue;
    }

    const changes = [];
    for (const finding of live.findings) {
      const cls = classifyFinding(finding, targetType);
      if (!cls) { skippedFindings.push({ url: page.url, finding, reason: 'not fixable via a database field' }); continue; }
      if (changes.some((c) => c.field === cls.field)) continue;

      const current = {
        meta_title: live.title,
        meta_desc: live.metaDescription,
        canonical: `https://${site.domain}${new URL(page.url).pathname.replace(/\/?$/, '/')}`,
        content: postBySlug.get(slug)?.content,
      }[cls.field];

      // A blog body fix needs the real stored HTML; without it there is nothing
      // to safely rewrite, so skip rather than guess.
      if (cls.field === 'content' && !current) {
        skippedFindings.push({ url: page.url, finding, reason: 'post body not retrievable from the site' });
        continue;
      }

      const after = await proposeValue({
        field: cls.field, label: cls.label, finding, current,
        targetUrl: page.url, pageTitle: live.title, agentConfig,
      });
      if (!after) { skippedFindings.push({ url: page.url, finding, reason: 'model did not return a usable fix' }); continue; }

      // A rewritten body gets the same abuse checks a new draft would face.
      if (cls.field === 'content') {
        const failures = failsEditSafety(after, site);
        if (failures.length > 0) {
          skippedFindings.push({ url: page.url, finding, reason: `rewrite failed guardrail: ${failures.map((f) => f.id).join(', ')}` });
          continue;
        }
      }

      changes.push({ field: cls.field, label: cls.label, before: current || '', after, finding });
    }

    if (changes.length === 0) continue;

    proposals.push({
      targetType,
      slug,
      targetLabel: live.title || slug,
      targetUrl: page.url,
      reason: changes.map((c) => c.finding).join(' • '),
      sourceAgent: 'on_page_seo_agent',
      changes: changes.map(({ finding, ...rest }) => rest),
    });
  }

  for (const payload of proposals) {
    await supabase.from('agent_tasks').insert({
      site_id: site.id,
      source_agent: 'content_edit_agent',
      target_agent: 'human_review_queue',
      task_type: 'approve_edit',
      payload,
      status: 'awaiting_approval',
    });
  }

  const result = {
    proposalsCreated: proposals.length,
    pagesConsidered: auditPages.length,
    skippedFindings: skippedFindings.slice(0, 20),
    proposals: proposals.map((p) => ({ slug: p.slug, targetType: p.targetType, fields: p.changes.map((c) => c.field) })),
  };

  await supabase.from('agent_results').insert({ site_id: site.id, agent_name: 'content_edit_agent', result });
  try {
    await supabase.from('event_log').insert({
      site_id: site.id,
      actor: 'content_edit_agent',
      action: 'edit_proposals_created',
      details: { proposalsCreated: proposals.length },
    });
  } catch (err) {
    console.warn(`event_log insert failed (non-fatal): ${err.message}`);
  }

  return { site: site.domain, ...result };
}
