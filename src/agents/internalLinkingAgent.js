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

const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'your', 'how', 'why', 'what', 'is', 'are', 'you', 'that', 'this', 'can', 'best', 'guide', 'vs']);
const MAX_LINKS_PER_POST = 3;

function significantWords(title) {
  return (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

function findCandidateLinks(post, allPosts, baseUrl) {
  const postWords = new Set(significantWords(post.title));
  const contentLower = (post.content || '').toLowerCase();

  const candidates = [];
  for (const other of allPosts) {
    if (other.slug === post.slug) continue;
    const otherWords = significantWords(other.title);
    const overlap = otherWords.filter((w) => postWords.has(w));
    if (overlap.length === 0) continue;

    // Anchor text must genuinely appear as plain text and not already be linked.
    const escapedTitle = other.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const titleRe = new RegExp(`\\b(${escapedTitle})\\b`, 'i');
    const alreadyLinked = contentLower.includes(`href="${baseUrl}/blog/${other.slug}"`);
    if (!alreadyLinked && titleRe.test(post.content || '')) {
      candidates.push({ anchorText: other.title, targetUrl: `${baseUrl}/blog/${other.slug}`, overlapScore: overlap.length });
      continue;
    }

    // Fall back to a shared significant word/phrase that appears verbatim,
    // so a topically related post can still get linked even if the exact
    // title isn't quoted in the text.
    for (const word of overlap) {
      const wordRe = new RegExp(`\\b(${word})\\b`, 'i');
      if (!alreadyLinked && wordRe.test(post.content || '')) {
        candidates.push({ anchorText: word, targetUrl: `${baseUrl}/blog/${other.slug}`, overlapScore: overlap.length });
        break;
      }
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

  const posts = await getPublishedPosts(site);
  if (posts.length < 2) {
    return { skipped: true, reason: 'fewer than 2 published posts — nothing to cross-link yet' };
  }

  const siteWithSecret = await withSiteSecret(site);
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
