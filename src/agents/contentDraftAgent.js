import { getSupabaseClient } from '../lib/supabaseClient.js';
import { generateText } from '../lib/llmClient.js';
import { researchKeywords } from '../lib/keywordResearch.js';
import { getInternalLinkCandidates } from '../lib/siteLinkInventory.js';
import { getAgentConfig } from '../lib/agentSettings.js';
import { generateAndInsertImages } from '../lib/imageInserter.js';
import { getTemplateGuidance, isValidBlogType } from '../lib/contentTemplates.js';

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
  const agentConfig = await getAgentConfig('content_draft_agent');

  // §6 hard gate — no original element, no draft. This can never be filled in
  // automatically (it has to be a real fact/data point a human supplies), so
  // we notify a human directly and stop — we do NOT create a follow-up agent
  // task here. Bouncing this back into the agent pipeline (as earlier code
  // did) created an infinite content_draft_agent <-> policy_guardrail_agent
  // ping-pong loop, since neither agent can ever supply the missing fact.
  if (!p.originalElement || !String(p.originalElement).trim()) {
    // Not a critical failure — surfaced in the panel's Activity feed via this
    // task's status/error_message, not email (routine input-needed cases
    // don't need to interrupt an inbox; see the panel's notification gating).
    await supabase.from('agent_tasks').update({
      status: 'failed',
      error_message: 'No originalElement (client data point / case-study figure / firsthand fact) supplied — required before drafting (Guidelines §6).',
      completed_at: new Date().toISOString(),
    }).eq('id', task.id);

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
  const blogType = isValidBlogType(p.blogType) ? p.blogType : 'general';
  const templateGuidance = getTemplateGuidance(blogType);
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
15. IMAGES: do NOT put <img> tags or fake image URLs directly in the HTML — a separate real image-generation pipeline reads the "imagePlacements" array (see JSON schema) and creates + inserts the actual images after you return this JSON. For EACH placement, give it enough to generate something genuinely specific to THIS section, not a generic stock-photo blob:
    - "visualDescription": a concrete, specific visual scene tied to what that exact section actually says (the real subject/setting/action/data from the ORIGINAL ELEMENT or that section's content — e.g. "a small bakery storefront with a Google Business Profile hours sign visible in the window, morning light" rather than "a bakery"). This is what the image will actually be generated from, so vague/generic descriptions produce vague/generic images. HARD RULE: always describe a real physical scene — a person, place, object, or action — NEVER a dashboard, gauge/speedometer/meter, chart, graph, analytics screen, phone/laptop UI mockup, or any kind of infographic. The image model cannot render readable text, numbers, or UI elements — it turns them into garbled gibberish — so any scene implying a screen full of data or a "performance meter" look will come out broken. If the section is about metrics/results, depict the real-world outcome instead (e.g. a busy shop, a happy customer, a business owner reviewing a printed report) never the data/UI itself.
    - "altText": short, accessibility/SEO alt text (may include the keyword naturally, but must still literally describe what's in the image).
    - "caption": a short (under 15 words) human-readable caption that will be shown under the image on the page — should add real context/detail from that section, not just restate the heading.
    - "suggestedFileName": SEO-friendly filename.
    Never ask for literal text/words/numbers/logos to appear rendered inside the image itself — diffusion models render text badly; put any specific number or label in the caption instead.
16. INTERNAL LINKS: naturally weave in 3-8 links if enough real candidates exist (use as many of the real list below as make sense — never fewer than what naturally fits, never invent a URL):
${linkList}
17. EXTERNAL LINKS: NEVER link out to any domain other than ${site?.domain || 'this site'}. No links to Google, competitors, sources, "further reading," or any other outside website — every single <a href> in the content must point only to an internal page from the list above (or omit the link entirely if no internal page fits naturally). If you'd normally cite an outside authority, mention it by name in plain text without a link instead.
18. FAQ SECTION: include 3-6 genuinely useful questions and concise answers relevant to this exact topic (return in the "faqs" field, and also render them as a visible FAQ section in the HTML near the end, before the CTA).
19. SCHEMA: handled outside this prompt (BlogPosting + FAQPage + Author + Organization) — just make sure your "faqs" and "authorBio" fields are filled in accurately since they feed the schema. NEVER print raw JSON-LD, "@context", "@type", or any schema code block as visible text inside "contentHtml" — even as an "example" — it renders as broken, ugly raw code on the live page. If the topic is about schema/structured data, describe it in plain prose only, never show the actual code.
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
30. VISUAL DESIGN HOOKS — MANDATORY WRAPPER CLASSES: right now the site renders your HTML with no visual treatment at all (looks like a plain copy-pasted document), so use these exact wrapper elements/classes wherever they genuinely fit — the site's CSS targets these classes to render them as styled boxes:
    - Wrap the single biggest stat/result from the ORIGINAL ELEMENT (e.g. "15,000 additional sessions") in <div class="da-stat-callout">...</div> — one per article, placed early, ideally right after the intro.
    - Wrap a 2-4 bullet "key takeaway" summary in <div class="da-key-takeaway"><strong>Key takeaway:</strong><ul>...</ul></div> — place after the first or second H2.
    - Wrap any direct claim/result quote in <blockquote class="da-pullquote">...</blockquote> instead of a plain <p>.
    - Wrap the final CTA paragraph in <div class="da-cta-box">...</div> instead of a bare <p>.
    - Never use inline style="" or <font> — only these class names, so the site's own CSS controls the actual look.
${templateGuidance ? `31. CONTENT TYPE STRUCTURE (${blogType.replace('_', ' ')}) — mandatory H2/H3 organization for this piece, on top of every rule above:\n${templateGuidance}` : ''}

TOPIC: ${topic}
ORIGINAL ELEMENT (the backbone of the article): ${p.originalElement}
${p.triggerReason ? `WHY WE ARE WRITING THIS: ${p.triggerReason}` : ''}
${p.originalContent ? `EXISTING CONTENT TO REFRESH (genuinely improve it, do not just reword):\n${String(p.originalContent).slice(0, 4000)}` : ''}
${site?.is_ymyl ? `\nTHIS IS A YMYL SITE — be extra precise and cautious with any factual/health/financial claims.` : ''}
${p.reasons?.qualitative?.reasoning || p.reasons?.hardFailures?.length ? `
═══ THIS IS A REVISION — THE PREVIOUS DRAFT WAS REJECTED, DO NOT REPEAT THE SAME MISTAKE ═══
${p.reasons?.qualitative?.reasoning ? `Rejection reason: "${p.reasons.qualitative.reasoning}"
Fix this specifically, not just cosmetically:
- If rejected for lacking a unique POV/being generic "checklist" content: do NOT write a generic listicle at all — build the entire article around the ORIGINAL ELEMENT as the story/angle (a specific result, decision, or mistake), the way Google's own example contrasts "7 Tips for X" against "Why We Waived the Inspection & Saved Money." Every H2 should extend that specific angle, not restate generic industry advice.
- If rejected for missing E-E-A-T signals: make the firsthand voice ("in our experience," "our client," a specific timeframe/result) unmistakable throughout, not just in one sentence.
- If rejected for filler/padding intro: the first sentence must be the ORIGINAL ELEMENT's specific fact or result — reread checklist rule 12 above and follow it exactly.` : ''}
${p.reasons?.hardFailures?.includes('content_length') ? `Rejection reason: the previous draft was TOO SHORT (${p.reasons.ruleChecks?.find((c) => c.id === 'content_length')?.detail || `under ${wordMin} words`}). This is a hard minimum, not a suggestion. Do not pad with filler to hit the count — instead cover EVERY H2 subtopic in genuinely more depth: more concrete detail tied to the ORIGINAL ELEMENT, a worked example, specific numbers, or an extra relevant subtopic as its own H2. Write the full ${wordMin}+ words this time — a draft that falls short again will be rejected again.` : ''}
This is attempt-after-rejection — repeating the same draft will be rejected again, so change the actual substance and structure/length, not just the wording.` : ''}

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
  "imagePlacements": [{ "afterHeading": "the H2/H3 text this image should follow", "suggestedFileName": "seo-friendly-file-name.webp", "visualDescription": "concrete, specific visual scene from that section's real content (see rule 15) — this is the actual image-generation prompt", "altText": "descriptive alt text with keyword where natural", "caption": "short caption shown under the image, under 15 words" }],
  "contentHtml": "<h1>...</h1><p>...</p> the full article as clean semantic HTML per every checklist rule above, including the internal links, external links (if any), FAQ section, and CTA — do NOT include <img> tags (see rule 15)"
}`;

  // Token budget must comfortably fit the full HTML article (up to 2800 words ≈ 3800 tokens)
  // plus JSON overhead (title/meta/faqs/imagePlacements) — 4500 was silently truncating
  // competitive/pillar topics well short of the required word minimum. Live testing showed
  // the default "lite" model under-delivers on word count even for the smaller 1000-1600
  // target (consistently 600-800 words across repeated runs), not just 1800+ pillar topics —
  // so every draft now uses the full gemini-flash-latest model; still free tier, still near-$0.
  const maxTokens = agentConfig.maxTokens || (isCompetitiveTopic ? 16000 : 9000);
  async function generateDraft() {
    let text;
    try {
      text = await generateText({
        prompt,
        maxTokens,
        temperature: 0.6,
        model: agentConfig.modelName || 'gemini-flash-latest',
        provider: agentConfig.modelProvider,
      });
    } catch (err) {
      // The configured model/provider occasionally errors under high demand —
      // fall back to the free Gemini lite model rather than blocking the
      // whole pipeline on a transient outage.
      console.warn(`${agentConfig.modelProvider} model unavailable, falling back to Gemini lite:`, err.message);
      text = await generateText({ prompt, maxTokens, temperature: 0.6 });
    }
    const m = text.match(/\{[\s\S]*\}/);
    return { text, parsed: JSON.parse(m ? m[0] : text) };
  }

  // A malformed/truncated JSON response is a real but occasional model
  // hiccup, not evidence the topic itself is bad — one silent retry before
  // giving up avoids failing a perfectly good topic over a one-off glitch.
  let raw, draft;
  try {
    ({ text: raw, parsed: draft } = await generateDraft());
  } catch (firstErr) {
    console.warn('Draft JSON parse failed, retrying once:', firstErr.message);
    try {
      ({ text: raw, parsed: draft } = await generateDraft());
    } catch (secondErr) {
      // Not a critical failure — visible in the panel's Activity feed via
      // this task's status/error_message instead of email (routine model
      // hiccup, not something that needs to interrupt an inbox).
      await supabase.from('agent_tasks').update({
        status: 'failed',
        error_message: 'Model did not return valid JSON, even after one retry',
        completed_at: new Date().toISOString(),
      }).eq('id', task.id);
      return { decision: 'failed_parse', raw: (raw || '').slice(0, 400) };
    }
  }

  // Fix the recurring cause of guardrail design_safe_markup rejections at the
  // source instead of relying on the prompt alone (prompt-only instructions
  // are unreliable — same lesson as every other hard-gate in this file): the
  // model occasionally emits literal Markdown bold or inline style="" even
  // though the prompt forbids both. Auto-correct both here so a good draft
  // doesn't need a full extra draft->guardrail->revise round trip for a
  // cosmetic formatting slip.
  if (draft.contentHtml) {
    draft.contentHtml = draft.contentHtml
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\s*style\s*=\s*"[^"]*"/gi, '')
      .replace(/\s*style\s*=\s*'[^']*'/gi, '');
  }

  // Generate real images for the placements the model suggested (free tier,
  // Cloudflare Workers AI) and embed them directly in the HTML, right after
  // their matching heading. Never blocks the draft — a failed/missing image
  // just leaves that section without one rather than failing the whole task.
  let imagesGenerated = 0;
  if (draft.contentHtml && Array.isArray(draft.imagePlacements) && draft.imagePlacements.length) {
    try {
      const imgResult = await generateAndInsertImages({
        contentHtml: draft.contentHtml,
        imagePlacements: draft.imagePlacements,
        topic,
        siteName: site?.name,
      });
      draft.contentHtml = imgResult.html;
      imagesGenerated = imgResult.generatedCount;
    } catch (err) {
      console.warn('Image generation step failed entirely (non-fatal, draft continues without images):', err.message);
    }
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
      blogType,
      contentLength: (draft.contentHtml || '').length,
      keywordResearch,
      internalLinkCandidatesOffered: internalLinkCandidates.length,
      imagePlacements: draft.imagePlacements || [],
      imagesGenerated,
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
      blogType,
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
      revisionCount: (p.revisionCount || 0) + (p.reasons ? 1 : 0),
    },
  });

  await supabase.from('agent_tasks').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
  }).eq('id', task.id);

  return { decision: 'drafted', title: draft.title, slug: draft.slug };
}
