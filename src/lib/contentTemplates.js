/**
 * Content Templates — per-blog-type structural guidance injected into the
 * Content Draft Agent's prompt. This only shapes HOW the article is organized
 * (H2 order/purpose), not visual design (that's the site's own CSS/frontend,
 * a separate concern from this repo).
 */
export const BLOG_TYPES = [
  { id: 'general', label: 'General / no fixed structure (default)' },
  { id: 'case_study', label: 'Case Study (result-led, before/after)' },
  { id: 'how_to', label: 'How-To (numbered steps)' },
  { id: 'comparison', label: 'Comparison (X vs Y / option A vs B)' },
  { id: 'listicle', label: 'Listicle (numbered list of items/tips)' },
];

const GUIDANCE = {
  general: '',
  case_study: `- STRUCTURE (case study): open the FIRST H2 with the situation/problem before the ORIGINAL ELEMENT's result happened (the real starting point — what was broken/missing). The SECOND H2 covers what was actually done (the specific approach/decisions). The THIRD H2 is the result itself, built around the ORIGINAL ELEMENT's real number/outcome (this is where "da-stat-callout" belongs). Remaining H2s can cover why it worked or what a reader can copy from it. Do NOT write this as a generic tips listicle — every section must trace back to this one real story.`,
  how_to: `- STRUCTURE (how-to): after a short intro (still following rule 12 — no filler opener), use numbered H2 or H3 steps ("Step 1: ...", "Step 2: ...") in the exact order a reader must actually perform them. Each step gets 2-4 sentences of concrete, actionable detail (not vague advice) — tie at least one step directly to the ORIGINAL ELEMENT as proof this actually works. End with a "Common mistakes" or "What to check afterward" H2 before the FAQ/CTA.`,
  comparison: `- STRUCTURE (comparison): identify the two (or more) things being compared directly in the H1/title. Use one H2 per option covering the same set of sub-points for each (so they're genuinely comparable), then a dedicated H2 titled something like "Which one should you choose" that gives a real, opinionated recommendation (not "it depends" wishy-washy). Use a genuine HTML <table> for the side-by-side comparison if the topic supports it (counts toward rule 27's engagement element).
    ONLY compare things Digital Aura's own service actually covers (on-page/technical/local SEO, content, GA4/GSC tracking) — never draft a comparison whose actual subject is backlink/link-building services or tactics (see rule 29); if the requested topic is fundamentally a backlink-service comparison, keep the piece focused on the on-page/technical angle of the topic instead.`,
  listicle: `- STRUCTURE (listicle): every item must be a numbered H2 or H3 ("1. ...", "2. ..."), each with genuine, specific, non-interchangeable detail — never a one-line filler item. Ground at least one list item explicitly in the ORIGINAL ELEMENT so the piece isn't generic industry advice (see rule 12/checklist). Google's own guidance treats generic "N tips" listicles as the weakest content shape for AI Overviews, so the intro and at least one item must make this list's unique angle explicit, not just aggregate common knowledge.`,
};

/** Returns a prompt-ready guidance string (empty string for 'general'/unknown types). */
export function getTemplateGuidance(blogType) {
  return GUIDANCE[blogType] || '';
}

export function isValidBlogType(blogType) {
  return BLOG_TYPES.some((t) => t.id === blogType);
}
