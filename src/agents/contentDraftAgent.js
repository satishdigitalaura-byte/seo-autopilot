import { getSupabaseClient } from '../lib/supabaseClient.js';
import { generateText } from '../lib/llmClient.js';

/**
 * Content Draft Agent — writes a blog draft with Gemini, then hands it to the
 * Policy Guardrail Agent (which checks it and forwards to human_review_queue).
 *
 * Built per SEO_GUIDELINES_REFERENCE.md:
 *  - §5: no mythbusted GEO tactics (no forced first-40-words answer, no fact-density).
 *  - §3: no filler; E-E-A-T signals; write from firsthand experience.
 *  - §6: every AI draft must carry a genuine ORIGINAL ELEMENT. If the task doesn't
 *        supply one, we do NOT invent it — we bounce back and ask for it.
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

  const prompt = `You are an expert SEO content writer for Digital Aura, a digital marketing agency.
Write a blog post that follows Google's ACTUAL guidance — not mythbusted "AEO/GEO" tactics.

HARD RULES:
- Non-commodity angle: say something a reader cannot get from ten generic posts on this topic. Build the WHOLE piece around the ORIGINAL ELEMENT below.
- No filler: do NOT open with "In today's digital landscape..." or any generic padding. The first sentence must be substantive.
- E-E-A-T: write from firsthand agency experience and reference the original data point concretely.
- Natural keyword use only — no keyword stuffing.
- Clear headings and short paragraphs for human readers. Do NOT force a rigid "answer in the first 40 words" format or artificial fact-density.

TOPIC / TARGET KEYWORD: ${topic}
ORIGINAL ELEMENT (weave this in as the backbone of the article): ${p.originalElement}
${p.triggerReason ? `WHY WE ARE WRITING THIS: ${p.triggerReason}` : ''}
${p.originalContent ? `EXISTING CONTENT TO REFRESH (genuinely improve it, do not just reword):\n${String(p.originalContent).slice(0, 4000)}` : ''}

Return ONLY a JSON object, no other text:
{
  "title": "compelling, specific, non-commodity title",
  "slug": "url-friendly-slug",
  "metaTitle": "<= 60 characters",
  "metaDescription": "<= 155 characters, written well (Bing displays it literally)",
  "keywords": "comma, separated, keywords",
  "excerpt": "1-2 sentence summary",
  "contentHtml": "<h1>...</h1><p>...</p> the full article as clean semantic HTML"
}`;

  const raw = await generateText({ prompt, maxTokens: 4000, temperature: 0.6 });

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

  await supabase.from('agent_results').insert({
    task_id: task.id,
    site_id: task.site_id,
    agent_name: 'content_draft_agent',
    result: { draft: { ...draft, contentHtml: undefined }, contentLength: (draft.contentHtml || '').length },
  });

  // Hand off to the Policy Guardrail. It carries BOTH the fields the guardrail reads
  // (content, targetKeyword, originalElement, triggerReason) AND the fields the publish
  // connector will need later (slug, title, meta*, etc.).
  await supabase.from('agent_tasks').insert({
    site_id: task.site_id,
    source_agent: 'content_draft_agent',
    target_agent: 'policy_guardrail_agent',
    task_type: 'draft_refresh',
    status: 'pending',
    payload: {
      taskType: 'draft_refresh',
      content: draft.contentHtml,
      targetKeyword: topic,
      originalElement: p.originalElement,
      triggerReason: p.triggerReason || 'content_draft_agent',
      authorName: p.authorName,
      slug: draft.slug,
      title: draft.title,
      metaTitle: draft.metaTitle,
      metaDescription: draft.metaDescription,
      keywords: draft.keywords,
      excerpt: draft.excerpt,
    },
  });

  await supabase.from('agent_tasks').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
  }).eq('id', task.id);

  return { decision: 'drafted', title: draft.title, slug: draft.slug };
}
