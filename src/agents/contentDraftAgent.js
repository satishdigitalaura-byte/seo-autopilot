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

  const currentYear = new Date().getFullYear();
  const isCompetitiveTopic = /best|vs|comparison|guide|checklist|complete/i.test(topic);
  const wordMin = isCompetitiveTopic ? 1800 : 1000;
  const wordTarget = isCompetitiveTopic ? `${wordMin}-2800 (competitive/pillar topic)` : `${wordMin}-1600 (standard topic)`;

  const prompt = `You are an expert SEO content writer and conversion copywriter for ${site?.name || 'the client'}, writing content that must genuinely help a human reader first — not content written primarily to please a search algorithm. Follow Google's ACTUAL published guidance, not mythbusted "AEO/GEO" tactics. You also follow a strict on-page SEO checklist (below) on every single draft, because that checklist is what gets this content actually ranking, not just published.

═══ KEYWORD RESEARCH (already done — use this, don't invent your own) ═══
Primary keyword: ${keywordResearch.primaryKeyword}
Secondary keywords (use several naturally): ${(keywordResearch.secondaryKeywords || []).join(', ') || 'none'}
Long-tail keywords (weave 1-2 into subheadings or FAQ): ${(keywordResearch.longTailKeywords || []).join(', ') || 'none'}
NLP/semantic terms (sprinkle naturally where topically relevant — this is what tells Google/AI engines you actually understand the topic, not just the keyword): ${(keywordResearch.nlpSemanticKeywords || []).join(', ') || 'none'}
Search intent: ${keywordResearch.searchIntent} | Funnel stage: ${keywordResearch.funnelStage}
What the searcher actually wants: ${keywordResearch.whatUserActuallyWants || 'n/a'}
Research note: ${keywordResearch.reasoning}
${keywordResearch.realQueriesUsed?.length ? `Real queries already bringing visitors near this topic:\n${keywordResearch.realQueriesUsed.slice(0, 8).map((q) => `- "${q.query}"`).join('\n')}` : ''}

═══ ON-PAGE SEO CHECKLIST (every point is mandatory) ═══
1. SEARCH INTENT FIRST: everything in the article must serve "${keywordResearch.whatUserActuallyWants || 'what the searcher wants'}" — no tangents (e.g. don't dump company history into a comparison-intent article).
2. PRIMARY KEYWORD: exactly one, used naturally in the H1, first 100 words, at least one H2, and the conclusion.
3. SECONDARY KEYWORDS: work several of the list above into subheadings and body copy naturally — never force one into every paragraph.
4. LONG-TAIL KEYWORDS: use 1-2, ideally as an H2/H3 or FAQ question — they signal deeper topical coverage.
5. NLP/SEMANTIC TERMS: use the relevant ones naturally throughout so the piece reads like it was written by someone who actually knows the subject.
6. TITLE TAG (metaTitle): 50-60 characters, primary keyword as close to the front as natural.
7. META DESCRIPTION: 150-160 characters, compelling, includes the primary keyword, written as real sentence(s) a human would click on (not a keyword list).
8. URL SLUG: short, keyword-based, no filler words like "blog-post-final". Prefer close to the primary keyword.
9. H1: exactly one, close to the primary keyword.
10. H2 STRUCTURE: multiple clear H2 sections that each cover one distinct subtopic — no rambling single-H2 walls of text.
11. H3: only where an H2 section genuinely needs sub-points.
12. INTRODUCTION — ABSOLUTELY NO FILLER OPENER: the very first sentence must be a substantive, specific claim or fact — never generic throat-clearing. This gets content auto-rejected, so treat it as a hard stop, not a style preference. BANNED as an opening sentence (do not paraphrase these either — no sentence with this shape, about any topic):
   - "In [year]/today's [industry/digital] landscape, ..."
   - "In the ever-evolving world of ..."
   - "When it comes to [topic], ..."
   - "In today's fast-paced/digital world, ..."
   - Any sentence whose only job is to announce the topic generically before saying anything real.
   Instead, open with the ORIGINAL ELEMENT itself, a specific number/result, or a direct claim that could only be written by someone who actually did the work. Example of the difference: BAD — "In 2026, the landscape of SEO has shifted." GOOD — "We took a hotel client's booking page from page 5 to the #1 spot for 'jacuzzi suites near me' in 90 days — here's the exact on-page framework we used." The primary keyword must still appear naturally within the first ~100 words, and the intro must directly address search intent.
13. KEYWORD DENSITY: natural, not stuffed — roughly primary keyword 5-8x per 1000 words, secondary 2-4x each, long-tail 1-2x, NLP terms sprinkled as topically relevant. Never force a count at the cost of readability.
14. CONTENT LENGTH — HARD MINIMUM, NOT A SUGGESTION: this piece must be AT LEAST ${wordMin} words of real body copy (target range ${wordTarget}). Word count is checked programmatically after you write — a draft under ${wordMin} words gets bounced back for revision, so do not stop early or wrap up after a couple of short sections. Cover every H2 subtopic in real depth (concrete detail, examples, specifics tied to the ORIGINAL ELEMENT) rather than staying surface-level — depth is what naturally reaches this length, not padding.
15. IMAGES: do NOT invent, hallucinate, or fabricate image files/URLs — no real image pipeline exists yet. Instead, output an "imagePlacements" array (see JSON schema) naming where images SHOULD go and their ideal SEO filename + alt text, for a human to add later. Do not put fake <img> tags in the HTML.
16. INTERNAL LINKS: naturally weave in 3-8 links if enough real candidates exist (use as many of the real list below as make sense — never fewer than what naturally fits, never invent a URL):
${linkList}
17. EXTERNAL LINKS: NEVER link out to any domain other than ${site?.domain || 'this site'}. No links to Google, competitors, sources, "further reading," or any other outside website — every single <a href> in the content must point only to an internal page from the list above (or omit the link entirely if no internal page fits naturally). If you'd normally cite an outside authority, mention it by name in plain text without a link instead.
18. FAQ SECTION: include 3-6 genuinely useful questions and concise answers relevant to this exact topic (return in the "faqs" field, and also render them as a visible FAQ section in the HTML near the end, before the CTA).
19. SCHEMA: handled outside this prompt (BlogPosting + FAQPage + Author + Organization) — just make sure your "faqs" and "authorBio" fields are filled in accurately since they feed the schema.
20. AUTHOR SECTION: fill "authorBio" with a short (1-2 sentence) bio establishing relevant expertise${p.authorName ? ` for ${p.authorName}${p.authorCredentials ? ` (${p.authorCredentials})` : ''}` : ' for the agency as the author (no named individual was supplied for this draft)'}.
21. TABLE OF CONTENTS: if the article is long (roughly 1500+ words), set "needsTableOfContents": true and make sure H2s are descriptive enough to work as TOC entries.
22. READABILITY: short paragraphs (2-4 lines), bullet/numbered lists where they aid scanning, generous white space — no dense walls of text.
23. CTA: end with a clear, specific call-to-action tied to a real next step. ${ctaLink ? `Link it to: ${ctaLink.url} (anchor text like "${ctaLink.anchorText}" or a natural variation).` : 'No contact page available — write a strong CTA without a link.'}
24. E-E-A-T: write from firsthand agency experience — phrases like "in our experience," "our client," "after we optimized," grounded in the ORIGINAL ELEMENT below, never generic corporate voice.
25. FRESHNESS: where it reads naturally, signal currency (e.g. include "${currentYear}" in the title or an H2 if genuinely relevant to the topic — don't force it if awkward).
26. AI OVERVIEW / AI-ASSISTANT FRIENDLY (AIO/GEO): use direct, extractable answers where natural, comparison/definition-style clarity, and let at least one section be structured as a list or short table if the content genuinely suits it — but do NOT force a rigid "answer in the first 40 words" formula; let structure serve the reader.
27. ENGAGEMENT ELEMENTS: use a comparison table, numbered steps, or definition callout somewhere if the topic genuinely supports it (skip if it would feel forced).
28. TECHNICAL HYGIENE: only real internal links, only real/well-known external links, clean semantic HTML, no broken markup, no placeholder text left in.
29. NO BACKLINK/LINK-BUILDING CLAIMS: this agency does NOT offer backlink building / link building / off-page link acquisition as a service. Never mention "backlinks", "link building", or claim/imply that service anywhere in the title, keywords, FAQs, or body — not even as a generic SEO-tips mention. If it would naturally come up, skip it or replace it with an on-page/technical/local SEO point instead.

TOPIC: ${topic}
ORIGINAL ELEMENT (the backbone of the article): ${p.originalElement}
${p.triggerReason ? `WHY WE ARE WRITING THIS: ${p.triggerReason}` : ''}
${p.originalContent ? `EXISTING CONTENT TO REFRESH (genuinely improve it, do not just reword):\n${String(p.originalContent).slice(0, 4000)}` : ''}
${site?.is_ymyl ? `\nTHIS IS A YMYL SITE — be extra precise and cautious with any factual/health/financial claims.` : ''}

Return ONLY a JSON object, no other text:
{
  "title": "compelling, specific, non-commodity title, primary keyword near the front",
  "slug": "short-keyword-based-url-slug",
  "metaTitle": "50-60 characters, primary keyword near the front",
  "metaDescription": "150-160 characters, compelling real sentence(s), includes primary keyword",
  "keywords": "comma, separated, primary + secondary keywords",
  "longTailKeywordsUsed": ["the long-tail phrases you actually wove in"],
  "excerpt": "1-2 sentence summary",
  "schemaType": "BlogPosting or Article",
  "authorBio": "1-2 sentence author bio for E-E-A-T",
  "needsTableOfContents": true or false,
  "faqs": [{ "question": "...", "answer": "..." }],
  "imagePlacements": [{ "afterHeading": "the H2/H3 text this image should follow", "suggestedFileName": "seo-friendly-file-name.webp", "altText": "descriptive alt text with keyword where natural" }],
  "contentHtml": "<h1>...</h1><p>...</p> the full article as clean semantic HTML per every checklist rule above, including the internal links, external links (if any), FAQ section, and CTA — do NOT include <img> tags (see rule 15)"
}`;

  // Token budget must comfortably fit the full HTML article (up to 2800 words ≈ 3800 tokens)
  // plus JSON overhead (title/meta/faqs/imagePlacements) — 4500 was silently truncating
  // competitive/pillar topics well short of the required word minimum. The default "lite"
  // model also can't sustain 1800+ words regardless of token budget, so competitive/pillar
  // topics get bumped to the full gemini-2.5-flash model — everything else stays on the
  // free lite model to keep this near-$0.
  const maxTokens = isCompetitiveTopic ? 16000 : 6000;
  const model = isCompetitiveTopic ? 'gemini-flash-latest' : undefined;
  const raw = await generateText({ prompt, maxTokens, temperature: 0.6, model });

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

  const authorSchema = p.authorName
    ? { '@type': 'Person', name: p.authorName, ...(p.authorCredentials ? { jobTitle: p.authorCredentials } : {}), description: draft.authorBio }
    : { '@type': 'Organization', name: site?.name || 'Digital Aura', description: draft.authorBio };

  const schemaGraph = [
    {
      '@context': 'https://schema.org',
      '@type': draft.schemaType || 'BlogPosting',
      headline: draft.title,
      description: draft.metaDescription,
      datePublished: new Date().toISOString(),
      author: authorSchema,
      publisher: { '@type': 'Organization', name: site?.name || 'Digital Aura' },
    },
  ];

  if (Array.isArray(draft.faqs) && draft.faqs.length) {
    schemaGraph.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: draft.faqs.map((f) => ({
        '@type': 'Question',
        name: f.question,
        acceptedAnswer: { '@type': 'Answer', text: f.answer },
      })),
    });
  }

  if (draft.slug && site?.domain) {
    schemaGraph.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `https://${site.domain}/` },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: `https://${site.domain}/blog` },
        { '@type': 'ListItem', position: 3, name: draft.title, item: `https://${site.domain}/blog/${draft.slug}` },
      ],
    });
  }

  const schemaJsonLd = schemaGraph.length === 1 ? schemaGraph[0] : schemaGraph;

  await supabase.from('agent_results').insert({
    task_id: task.id,
    site_id: task.site_id,
    agent_name: 'content_draft_agent',
    result: {
      draft: { ...draft, contentHtml: undefined },
      contentLength: (draft.contentHtml || '').length,
      keywordResearch,
      internalLinkCandidatesOffered: internalLinkCandidates.length,
      imagePlacements: draft.imagePlacements || [],
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
      longTailKeywordsUsed: draft.longTailKeywordsUsed || [],
      excerpt: draft.excerpt,
      faqs: draft.faqs || [],
      authorBio: draft.authorBio,
      needsTableOfContents: !!draft.needsTableOfContents,
      imagePlacements: draft.imagePlacements || [],
      schemaJsonLd,
      wordMin,
    },
  });

  await supabase.from('agent_tasks').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
  }).eq('id', task.id);

  return { decision: 'drafted', title: draft.title, slug: draft.slug };
}
