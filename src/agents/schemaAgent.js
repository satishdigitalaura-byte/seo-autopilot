import { getSupabaseClient } from '../lib/supabaseClient.js';
import { getPublishedPosts } from '../lib/siteLinkInventory.js';
import { withSiteSecret } from '../lib/siteCredentials.js';
import { updateSchema } from '../lib/siteConnectors/expressSiteConnector.js';

/**
 * Schema Agent — like Internal Linking, this is "pure technical work, safe
 * to fully automate" (Master Architecture §3): it never invents facts, it
 * only structures facts already visible in the post's own published HTML
 * into JSON-LD. Every field in the schema is extracted from the real
 * content, never fabricated (e.g. it will not invent a rating or a price).
 *
 * Builds two schema types, only when the underlying content genuinely
 * supports them:
 *   - Article — always, from title/excerpt/dates already on the post.
 *   - FAQPage — only if the content actually contains question-style
 *     headings (ending in "?") each immediately followed by an answer
 *     paragraph. If there are no real Q&A pairs, no FAQPage schema is added
 *     — this agent will not manufacture fake FAQs just to get the schema.
 */

function extractFaqPairs(html) {
  const pairs = [];
  const headingRe = /<h[23][^>]*>([\s\S]*?)\?<\/h[23]>/gi;
  let match;
  while ((match = headingRe.exec(html)) !== null) {
    const question = match[1].replace(/<[^>]+>/g, '').trim() + '?';
    const afterHeading = html.slice(headingRe.lastIndex);
    const answerMatch = afterHeading.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (answerMatch) {
      const answer = answerMatch[1].replace(/<[^>]+>/g, '').trim();
      if (question.length > 8 && answer.length > 15) pairs.push({ question, answer });
    }
  }
  return pairs;
}

/**
 * Note on @context: it is set once at the top level, never repeated on the
 * members of an @graph. Repeating it there is redundant and some validators
 * flag it, so the builders below deliberately return context-free nodes and
 * runSchemaAgentForSite adds the single wrapper.
 */
function buildArticleSchema(post, site) {
  const baseUrl = `https://${site.domain}`.replace(/\/+$/, '');
  return {
    '@type': 'Article',
    headline: post.title,
    description: post.excerpt || undefined,
    datePublished: post.createdAt || undefined,
    dateModified: post.updatedAt || post.createdAt || undefined,
    mainEntityOfPage: `${baseUrl}/blog/${post.slug}`,
    // The real business name, not a slice of the hostname — the previous
    // domain.split('.')[0] published "thedigitalaura" as the publisher, which
    // is not what this organisation is actually called anywhere else.
    publisher: {
      '@type': 'Organization',
      name: site.name || site.domain.replace(/^www\./, ''),
      url: baseUrl,
    },
  };
}

function buildFaqSchema(pairs) {
  return {
    '@type': 'FAQPage',
    mainEntity: pairs.map((p) => ({
      '@type': 'Question',
      name: p.question,
      acceptedAnswer: { '@type': 'Answer', text: p.answer },
    })),
  };
}

export async function runSchemaAgentForSite(site) {
  const supabase = getSupabaseClient();
  // Secret first: /posts/list is behind the shared secret, so fetching the
  // post list before loading it silently returned nothing at all.
  const siteWithSecret = await withSiteSecret(site);

  const posts = await getPublishedPosts(siteWithSecret);
  if (posts.length === 0) {
    // Logged, not just returned — see internalLinkingAgent.js: a scheduled
    // agent that stays silent is indistinguishable from a dead one.
    const skipped = { skipped: true, reason: 'no published posts found' };
    await supabase.from('agent_results').insert({ site_id: site.id, agent_name: 'schema_agent', result: skipped });
    return skipped;
  }

  const results = [];

  for (const post of posts) {
    const article = buildArticleSchema(post, site);
    const faqPairs = extractFaqPairs(post.content || '');
    const schemaGraph = faqPairs.length >= 2
      ? { '@context': 'https://schema.org', '@graph': [article, buildFaqSchema(faqPairs)] }
      : { '@context': 'https://schema.org', ...article };

    try {
      await updateSchema(siteWithSecret, { slug: post.slug, jsonLd: schemaGraph });
      results.push({ slug: post.slug, faqPairsFound: faqPairs.length, applied: true });
    } catch (err) {
      console.warn(`Schema update failed for ${site.domain}/${post.slug} (non-fatal): ${err.message}`);
      results.push({ slug: post.slug, applied: false, error: err.message });
    }
  }

  const result = { postsProcessed: posts.length, postsUpdated: results.filter((r) => r.applied).length, results };
  await supabase.from('agent_results').insert({ site_id: site.id, agent_name: 'schema_agent', result });
  try {
    await supabase.from('event_log').insert({
      site_id: site.id, actor: 'schema_agent', action: 'schema_updated',
      details: { postsProcessed: posts.length, postsUpdated: result.postsUpdated },
    });
  } catch (err) {
    console.warn(`event_log insert failed (non-fatal): ${err.message}`);
  }

  return { site: site.domain, ...result };
}
