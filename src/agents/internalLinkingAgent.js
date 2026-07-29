import { getSupabaseClient } from '../lib/supabaseClient.js';
import { getPublishedPosts } from '../lib/siteLinkInventory.js';
import { withSiteSecret } from '../lib/siteCredentials.js';
import { applyInternalLinks } from '../lib/siteConnectors/expressSiteConnector.js';

/**
 * Internal Linking Agent — per Master Architecture §3: "pure technical work,
 * safe to fully automate (no policy risk)". Unlike the content/schema
 * agents, this one is allowed to write directly to the live site without a
 * human approval step, because it never changes what a page SAYS — it only
 * adds an <a> around text that's already there, pointing to another real,
 * already-published page on the same site.
 *
 * Method (deliberately simple/explainable, not ML):
 *   1. Pull every real published post from the site's own /posts/list.
 *   2. For each post, find OTHER posts whose title shares a significant
 *      word (topical overlap) — case-insensitive, stopwords stripped.
 *   3. For each candidate, only propose a link if that candidate's title
 *      (or a close phrase of it) literally appears as plain text in the
 *      post's content and ISN'T already a link — this is what makes it a
 *      genuine, natural anchor, not an inserted non-sequitur.
 *   4. Calls the site's own /internal-links/apply, which — per that route's
 *      existing implementation — only replaces the FIRST bare occurrence of
 *      the anchor text and skips anything already linked. Never invents
 *      anchor text; never links to a URL that doesn't exist right now.
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'your', 'how', 'why',
  'what', 'is', 'are', 'you', 'that', 'this', 'can', 'best', 'guide', 'vs',
  // Generic modifiers and filler nouns. These pass a naive length test but
  // carry no topic on their own — linking the bare word "small" or "better"
  // tells Google nothing and reads as a broken link to a human.
  'small', 'large', 'big', 'good', 'better', 'great', 'more', 'less', 'most', 'very', 'much',
  'new', 'old', 'top', 'real', 'full', 'easy', 'simple', 'quick', 'fast', 'slow', 'high', 'low',
  'need', 'needs', 'want', 'wants', 'make', 'makes', 'made', 'get', 'gets', 'use', 'uses',
  'using', 'from', 'into', 'about', 'when', 'where', 'which', 'their', 'there', 'here', 'been',
  'have', 'has', 'had', 'will', 'would', 'should', 'could', 'them', 'they', 'were', 'was',
  'step', 'steps', 'tips', 'ways', 'things', 'stuff', 'like', 'just', 'also', 'than', 'then',
]);
const MAX_LINKS_PER_POST = 3;
// An anchor must be a real phrase, not one word. A single generic word gives
// Google no topical signal and looks accidental to a reader — and a bad link
// on a live page is worse than no link at all, so anything that can't produce
// a genuine phrase is skipped rather than downgraded.
const MIN_ANCHOR_WORDS = 2;

function significantWords(title) {
  return (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

/**
 * The longest run of consecutive words from `title` that appears verbatim in
 * `content` and carries at least MIN_ANCHOR_WORDS significant words. Working
 * from the longest candidate down means the most descriptive available anchor
 * wins, e.g. "google ads targeting" rather than "google".
 */
function longestPhraseInContent(title, content) {
  const words = (title || '').split(/\s+/).filter(Boolean);
  for (let len = Math.min(words.length, 8); len >= MIN_ANCHOR_WORDS; len--) {
    for (let start = 0; start + len <= words.length; start++) {
      const phrase = words.slice(start, start + len).join(' ');
      if (significantWords(phrase).length < MIN_ANCHOR_WORDS) continue;
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\b${escaped}\\b`, 'i').test(content)) return phrase;
    }
  }
  return null;
}

/** Exported so the anchor-quality rules can be checked without writing to a
 *  live site — the "small" anchor that shipped before was only caught after it
 *  was already public. */
export function findCandidateLinks(post, allPosts, baseUrl) {
  const postWords = new Set(significantWords(post.title));
  const contentLower = (post.content || '').toLowerCase();

  const candidates = [];
  for (const other of allPosts) {
    if (other.slug === post.slug) continue;
    const otherWords = significantWords(other.title);
    const overlap = otherWords.filter((w) => postWords.has(w));
    if (overlap.length === 0) continue;

    const alreadyLinked = contentLower.includes(`href="${baseUrl}/blog/${other.slug}"`);
    if (alreadyLinked) continue;

    // Anchor text must genuinely appear as plain text. Best case the whole
    // title is quoted; otherwise the longest real phrase from it that the
    // content actually contains. If neither exists, this pair simply doesn't
    // get a link — the old code fell back to a single shared word here, which
    // is how the bare word "small" ended up as a live anchor.
    const escapedTitle = other.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const anchorText = new RegExp(`\\b(${escapedTitle})\\b`, 'i').test(post.content || '')
      ? other.title
      : longestPhraseInContent(other.title, post.content || '');

    if (anchorText) {
      candidates.push({
        anchorText,
        targetUrl: `${baseUrl}/blog/${other.slug}`,
        // Prefer the more descriptive anchor when several candidates tie on
        // topical overlap.
        overlapScore: overlap.length * 10 + anchorText.split(/\s+/).length,
      });
    }
  }

  return candidates
    .sort((a, b) => b.overlapScore - a.overlapScore)
    .slice(0, MAX_LINKS_PER_POST)
    .map(({ anchorText, targetUrl }) => ({ anchorText, targetUrl }));
}

export async function runInternalLinkingForSite(site) {
  const supabase = getSupabaseClient();
  const baseUrl = `https://${site.domain}`.replace(/\/+$/, '');

  // Secret first: /posts/list is behind the shared secret, so fetching the
  // post list before loading it silently returned nothing at all.
  const siteWithSecret = await withSiteSecret(site);

  const posts = await getPublishedPosts(siteWithSecret);
  if (posts.length < 2) {
    // Logged, not just returned: the Manager Agent's heartbeat check treats
    // silence from a scheduled agent as "its workflow stopped firing", so a
    // deliberate skip has to leave a trace or it reads as a fault.
    const skipped = { skipped: true, postsFound: posts.length, reason: 'fewer than 2 published posts — nothing to cross-link yet' };
    await supabase.from('agent_results').insert({ site_id: site.id, agent_name: 'internal_linking_agent', result: skipped });
    return skipped;
  }

  const perPostResults = [];

  for (const post of posts) {
    const links = findCandidateLinks(post, posts, baseUrl);
    if (links.length === 0) continue;
    try {
      const res = await applyInternalLinks(siteWithSecret, { slug: post.slug, links });
      perPostResults.push({ slug: post.slug, linksProposed: links.length, linksAdded: res.linksAdded ?? links.length });
    } catch (err) {
      console.warn(`Internal linking failed for ${site.domain}/${post.slug} (non-fatal): ${err.message}`);
      perPostResults.push({ slug: post.slug, linksProposed: links.length, error: err.message });
    }
  }

  const totalAdded = perPostResults.reduce((s, r) => s + (r.linksAdded || 0), 0);
  const result = { postsScanned: posts.length, postsUpdated: perPostResults.filter((r) => (r.linksAdded || 0) > 0).length, totalLinksAdded: totalAdded, perPostResults };

  await supabase.from('agent_results').insert({ site_id: site.id, agent_name: 'internal_linking_agent', result });
  try {
    await supabase.from('event_log').insert({
      site_id: site.id, actor: 'internal_linking_agent', action: 'internal_links_applied',
      details: { postsScanned: posts.length, totalLinksAdded: totalAdded },
    });
  } catch (err) {
    console.warn(`event_log insert failed (non-fatal): ${err.message}`);
  }

  return { site: site.domain, ...result };
}
