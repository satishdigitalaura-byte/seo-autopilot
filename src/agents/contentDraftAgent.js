import { getSupabaseClient } from '../lib/supabaseClient.js';
import { generateText } from '../lib/llmClient.js';
import { researchKeywords } from '../lib/keywordResearch.js';
import { getInternalLinkCandidates } from '../lib/siteLinkInventory.js';

/**
 * Content Draft Agent — writes a blog/page draft with Gemini, then hands it to
 * the Policy Guardrail Agent (which checks it and forwards to human_review_queue).
 *
 * Built per SEO_GUIDELINES_REFERENCE.md (every numbered rule below maps to a
 * section in that doc — re-read it before changing this prompt):
 *
 *  - §1 Search Essentials — content must be genuinely people-first, not written
 *    "for the algorithm."
 *  - §3 E-E-A-T — firsthand experience, named author, no filler padding.
 *  - §4 YMYL — if the site is flagged is_ymyl, a credentialed author is
 *    mandatory and gets forwarded to the guardrail's hard gate.
 *  - §5 GEO/AIO — deliberately does NOT force a rigid "answer in first 40
 *    words" format or artificial fact-density. Google's own June 2026 guidance
 *    says that's a myth for Google Search. What actually matters for AI
 *    Overview visibility: unique POV, non-commodity value, human-readable
 *    structure — that's what this prompt asks for instead.
 *  - §6 AI content / scaled abuse — every draft must carry a genuine ORIGINAL
 *    ELEMENT (client data point, case study figure, firsthand fact). If the
 *    task doesn't supply one, we do NOT invent it — we bounce back and ask.
 *  - Keyword research (Master Architecture §8's $0 substitute) — grounded in
 *    the site's OWN real Search Console query data, not invented volumes.
 *  - Internal linking — only ever links to pages that genuinely exist right
 *    now (fetched live from the site's own nav), never a guessed URL.
 *  - Never auto-publishes: the output only ever becomes a guardrail task.
 */
export async function processContentDraftTask(task) {
  const supabase = getSupabaseClient();
  const p = task.payload || {};
  const topic = p.targetKeyword || p.topic;

  // §6 hard gate — no original element, no draft.
  if (!p.originalElement || !String(p.originalElement).trim()) {
    await supabase.from('agent_tasks').update({
      status: 'failed',
      error_message: 'No originalElement (client data point / case-study figure / firsthand fact) supplied — required before drafting (Guidelines §6).',
      completed_at: new Date().toISOString(),
    }).eq('id', task.id);

    await supabase.from('agent_tasks').insert({
      site_id: task.site_id,
      source_agent: 'content_draft_agent',
      target_agent: task.source_agent,
      task_type: 'need_original_element',
      payload: { originalTaskId: task.id, topic },
      status: 'pending',
    });
    return { decision: 'blocked_no_original_element' };
  }

  const { data: site } = await supabase.from('sites').select('*').eq('id', task.site_id).single();

  // §4 — YMYL sites need a credentialed author before this can even leave
  // draft status; the guardrail enforces the hard gate, but we fail fast and
  // clearly here rather than generating a draft that can never be approved.
  if (site?.is_ymyl && !(p.authorName && p.authorCredentials)) {
    await supabase.from('agent_tasks').update({
      status: 'failed',
      error_message: 'Site is YMYL — a named author AND stated credentials are required before drafting (Guidelines §4).',
      completed_at: new Date().toISOString(),
    }).eq('id', task.id);
    return { decision: 'blocked_ymyl_no_author' };
  }

  const [keywordResearch, internalLinkCandidates] = await Promise.all([
    researchKeywords(site, topic),
    getInternalLinkCandidates(site),
  ]);

  const linkList = internalLinkCandidates.length
    ? internalLinkCandidates.map((l) => `- "${l.anchorText}" -> ${l.url}`).join('\n')
    : '(no internal pages available — skip internal linking for this draft)';

  const ctaLink = internalLinkCandidates.find((l) => /contact|get in touch|growth plan/i.test(l.anchorText))
    || internalLinkCandidates[0];

  const prompt = `You are an expert SEO content writer and conversion copywriter for ${site?.name || 'the client'}, writing content that must genuinely help a human reader first — not content written primarily to please a search algorithm. Follow Google's ACTUAL published guidance, not mythbusted "AEO/GEO" tactics.

═══ KEYWORD RESEARCH (already done — use this, don't invent your own) ═══
Primary keyword: ${keywordResearch.primaryKeyword}
Secondary keywords: ${(keywordResearch.secondaryKeywords || []).join(', ') || 'none'}
Search intent: ${keywordResearch.searchIntent} | Funnel stage: ${keywordResearch.funnelStage}
Research note: ${keywordResearch.reasoning}
${keywordResearch.realQueriesUsed?.length ? `Real queries already bringing visitors near this topic:\n${keywordResearch.realQueriesUsed.slice(0, 8).map((q) => `- "${q.query}"`).join('\n')}` : ''}

═══ HARD RULES (non-negotiable) ═══
1. USER-FIRST: write for a human trying to solve a real problem. If a sentence exists only to please a search engine (keyword-stuffed, generic), cut it.
2. NON-COMMODITY / UNIQUE POV: build the entire piece around the ORIGINAL ELEMENT below — this must be the backbone, not a quote bolted onto generic advice. Google's own example of the difference: "7 Tips for First-Time Homebuyers" = low-value commodity content; "Why We Waived the Inspection & Saved Money" = high-value non-commodity content. Aim for the second kind.
3. NO FILLER: never open with "In today's digital landscape..." or similar padding. The first sentence must be substantive.
4. E-E-A-T: write from firsthand agency experience, reference the original data point concretely, keep the tone confident and specific (not generic corporate voice).
5. NATURAL KEYWORDS ONLY: use the primary/secondary keywords above where they read naturally. No stuffing, no unnatural repetition.
6. STRUCTURE FOR HUMANS: clear H2/H3 headings, short paragraphs, scannable — but do NOT force a rigid "direct answer in the first 40 words" format or artificial fact-density. Google's own June 2026 guidance explicitly calls that a myth; let the structure serve the reader, not a formula.
7. BOFU / LEAD-FOCUSED CLOSE: this content exists to generate leads for a digital marketing agency. End with a clear, specific call-to-action tied to a real next step (not generic "contact us today!"). ${ctaLink ? `Link the CTA to: ${ctaLink.url} (anchor text like "${ctaLink.anchorText}" or a natural variation).` : 'No contact page available — write a strong CTA without a link.'}
8. INTERNAL LINKS: naturally weave in 1-3 links from this real list ONLY (never invent a URL):
${linkList}
9. SEMANTIC HTML: use <h1> once, <h2>/<h3> for sections, <p>, <ul>/<li> where useful, real <a href="..."> for the internal links and CTA.

TOPIC: ${topic}
ORIGINAL ELEMENT (the backbone of the article): ${p.originalElement}
${p.triggerReason ? `WHY WE ARE WRITING THIS: ${p.triggerReason}` : ''}
${p.originalContent ? `EXISTING CONTENT TO REFRESH (genuinely improve it, do not just reword):\n${String(p.originalContent).slice(0, 4000)}` : ''}
${site?.is_ymyl ? `\nTHIS IS A YMYL SITE — be extra precise and cautious with any factual/health/financial claims.` : ''}

Return ONLY a JSON object, no other text:
{
  "title": "compelling, specific, non-commodity title",
  "slug": "url-friendly-slug",
  "metaTitle": "<= 60 characters",
  "metaDescription": "<= 155 characters, written well (Bing displays it literally, doesn't rewrite it like Google sometimes does)",
  "keywords": "comma, separated, keywords (use the researched ones above)",
  "excerpt": "1-2 sentence summary",
  "schemaType": "BlogPosting or Article",
  "contentHtml": "<h1>...</h1><p>...</p> the full article as clean semantic HTML, including the internal links and CTA per the rules above"
}`;

  const raw = await generateText({ prompt, maxTokens: 4500, temperature: 0.6 });

  let draft;
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    draft = JSON.parse(m ? m[0] : raw);
  } catch {
    await supabase.from('agent_tasks').update({
      status: 'failed',
      error_message: 'Model did not return valid JSON',
      completed_at: new Date().toISOString(),
    }).eq('id', task.id);
    return { decision: 'failed_parse', raw: raw.slice(0, 400) };
  }

  const schemaJsonLd = {
    '@context': 'https://schema.org',
    '@type': draft.schemaType || 'BlogPosting',
    headline: draft.title,
    description: draft.metaDescription,
    datePublished: new Date().toISOString(),
    author: { '@type': 'Organization', name: site?.name || 'Digital Aura' },
  };

  await supabase.from('agent_results').insert({
    task_id: task.id,
    site_id: task.site_id,
    agent_name: 'content_draft_agent',
    result: {
      draft: { ...draft, contentHtml: undefined },
      contentLength: (draft.contentHtml || '').length,
      keywordResearch,
      internalLinkCandidatesOffered: internalLinkCandidates.length,
    },
  });

  // Hand off to the Policy Guardrail. It carries BOTH the fields the guardrail reads
  // (content, targetKeyword, originalElement, triggerReason, authorName/Credentials)
  // AND the fields the publish connector will need later (slug, title, meta*, schema).
  await supabase.from('agent_tasks').insert({
    site_id: task.site_id,
    source_agent: 'content_draft_agent',
    target_agent: 'policy_guardrail_agent',
    task_type: 'draft_refresh',
    status: 'pending',
    payload: {
      taskType: 'draft_refresh',
      content: draft.contentHtml,
      targetKeyword: keywordResearch.primaryKeyword || topic,
      originalElement: p.originalElement,
      triggerReason: p.triggerReason || 'content_draft_agent',
      authorName: p.authorName,
      authorCredentials: p.authorCredentials,
      slug: draft.slug,
      title: draft.title,
      metaTitle: draft.metaTitle,
      metaDescription: draft.metaDescription,
      keywords: draft.keywords,
      excerpt: draft.excerpt,
      schemaJsonLd,
    },
  });

  await supabase.from('agent_tasks').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
  }).eq('id', task.id);

  return { decision: 'drafted', title: draft.title, slug: draft.slug };
}
