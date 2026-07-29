import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/**
 * Loads the SEO reference library in `references/` and turns it into prompt
 * material for the agents.
 *
 * Why this exists: those files hold ~50KB of genuinely good, specific SEO
 * guidance (exact title-tag rules, CWV thresholds, NAP rules, schema shapes,
 * GSC opportunity patterns) and NOT ONE LINE of it was ever read by any agent.
 * Every agent was re-deriving SEO judgement from whatever the model happened
 * to know, while the house rules sat unused on disk. This wires them in.
 *
 * Two deliberate constraints:
 *   1. Sections, not whole files. A 9KB file in every prompt is mostly
 *      irrelevant to any one agent and burns tokens on a near-$0 budget, so
 *      each agent asks for the specific sections it reasons about.
 *   2. Fail soft. A missing or unreadable file degrades to "no extra
 *      knowledge" rather than throwing — an agent must never stop working
 *      because a documentation file was moved.
 */

const REFERENCE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'references');
const cache = new Map();

function loadReference(name) {
  if (cache.has(name)) return cache.get(name);
  const path = join(REFERENCE_DIR, `${name}.md`);
  let text = '';
  try {
    if (existsSync(path)) text = readFileSync(path, 'utf8');
    else console.warn(`SEO reference "${name}.md" not found — agents will run without it.`);
  } catch (err) {
    console.warn(`Could not read SEO reference "${name}.md" (non-fatal): ${err.message}`);
  }
  cache.set(name, text);
  return text;
}

/**
 * Pulls whole `## ` sections out of a reference file by heading substring.
 * Matching is case-insensitive and partial so a caller can ask for "Title Tag"
 * without having to mirror the exact heading text.
 */
export function getSections(referenceName, headingMatches) {
  const text = loadReference(referenceName);
  if (!text) return '';

  const blocks = text.split(/\n(?=## )/g);
  const wanted = [];
  for (const block of blocks) {
    const heading = (block.match(/^## (.+)$/m) || [])[1];
    if (!heading) continue;
    const h = heading.toLowerCase();
    if (headingMatches.some((m) => h.includes(m.toLowerCase()))) wanted.push(block.trim());
  }
  return wanted.join('\n\n');
}

/** Hard cap so one long reference can never crowd out the real audit data a
 *  prompt is actually about. Trims on a line boundary to avoid cutting a rule
 *  in half and leaving the model a mangled instruction. */
function capped(text, maxChars) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, text.lastIndexOf('\n', maxChars))}\n…(reference truncated)`;
}

/**
 * The house SEO standard every agent shares. Derived from the team's own
 * SEO Skills brief so the autonomous agents hold the same line as a human
 * specialist would, rather than each inventing its own bar.
 */
export const SEO_EXPERT_PERSONA = `You are a Senior SEO Specialist with 15+ years of hands-on experience across on-page, technical, local and content SEO.

How you work:
- Data first. Every claim you make must trace to a number or finding that was actually given to you. If the data doesn't support a conclusion, say so plainly instead of filling the gap.
- Impact order. Lead with what moves rankings or revenue most, not what is easiest to describe.
- Plain language. The reader is a business owner, not an SEO. Explain any term you use ("meta description" → "the short text under your link in Google").
- Honest timelines. Real SEO change shows in 3-6 months. Never imply a fix works overnight.
- Strictly white-hat. Never suggest keyword stuffing, cloaking, doorway pages, link schemes, or anything else Google's spam policies prohibit — not even framed as a test.
- No padding. If there are three real issues, report three. Do not pad to a round number.`;

/**
 * Named knowledge packs, one per agent. Keeping the mapping here rather than
 * inline in each agent means the reference library can be reorganised in one
 * place instead of hunting through fifteen prompt strings.
 */
const PACKS = {
  content_draft: () => capped([
    getSections('content-seo', ['Content Quality Checklist', 'Content Optimization Workflow']),
    getSections('on-page-seo', ['Title Tag', 'Meta Description', 'Heading Structure', 'Internal Linking']),
    getSections('internal-linking', ['Anchor Text Rules']),
  ].filter(Boolean).join('\n\n'), 7000),

  policy_guardrail: () => capped(
    getSections('content-seo', ['Content SEO Philosophy', 'Content Quality Checklist']),
    3500,
  ),

  on_page: () => capped(
    getSections('on-page-seo', ['Title Tag', 'Meta Description', 'Heading Structure', 'Content Optimization', 'Image Optimization', 'Internal Linking']),
    6000,
  ),

  technical: () => capped([
    // javascript-seo leads deliberately: on a JS-rendered site every other
    // technical finding is downstream of whether the crawler can read the page
    // at all, and the reference library had no coverage of it whatsoever.
    getSections('javascript-seo', ['Four Failure Modes', 'Minimum Per-Route Requirements', 'Raw-HTML Test']),
    getSections('technical-seo', ['Sitemap', 'Robots.txt', 'Core Web Vitals', 'Canonicalization', 'Redirects', 'Indexing Audit']),
  ].filter(Boolean).join('\n\n'), 7000),

  internal_linking: () => capped(
    getSections('internal-linking', ['Anchor Text Rules', 'Volume & Placement', 'Topical Relevance', 'Safety Rules']),
    4500,
  ),

  eeat: () => capped([
    getSections('content-seo', ['Content SEO Philosophy', 'Content Quality Checklist']),
    getSections('on-page-seo', ['Content Optimization']),
  ].filter(Boolean).join('\n\n'), 4500),

  topic_discovery: () => capped([
    getSections('gsc-analysis', ['Opportunity Analysis Framework', 'The 5 Most Valuable GSC Reports', 'Interpreting Position Changes']),
    getSections('content-seo', ['Keyword Research Framework', 'Content Types']),
  ].filter(Boolean).join('\n\n'), 6000),

  local: () => capped(
    getSections('local-seo', ['NAP Consistency', 'Local Keyword Strategy', 'Location Pages', 'Structured Data']),
    5000,
  ),

  schema: () => capped(
    getSections('schema-templates', ['Article/BlogPosting', 'FAQPage', 'Organization', 'BreadcrumbList']),
    5000,
  ),
};

/**
 * The knowledge block to paste into an agent's prompt. Returns '' when the
 * reference files are unavailable, so callers can interpolate it
 * unconditionally without producing a dangling "REFERENCE:" header.
 */
export function getKnowledgeBlock(packName) {
  const pack = PACKS[packName];
  if (!pack) return '';
  const body = pack();
  if (!body.trim()) return '';
  return `
--- HOUSE SEO STANDARDS (apply these; they override generic SEO advice) ---
${body}
--- END HOUSE SEO STANDARDS ---
`;
}

/** Exposed for the health check / tests: which packs currently resolve to real
 *  content. A pack that silently returns '' means the wiring is broken. */
export function describeKnowledge() {
  return Object.keys(PACKS).map((name) => ({ pack: name, chars: PACKS[name]().length }));
}
