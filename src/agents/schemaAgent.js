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

function buildArticleSchema(post, site) {
  const baseUrl = `https://${site.domain}`.replace(/\/+$/, '');
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.excerpt || undefined,
    datePublished: post.createdAt || undefined,
    dateModified: post.updatedAt || post.createdAt || undefined,
    mainEntityOfPage: `${baseUrl}/blog/${post.slug}`,
    publisher: { '@type': 'Organization', name: site.domain.replace(/^www\./, '').split('.')[0] },
  };
}

function buildFaqSchema(pairs) {
  return {
    '@context': 'https://schema.org',
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
  const posts = await getPublishedPosts(site);
  if (posts.length === 0) return { skipped: true, reason: 'no published posts found' };

  const siteWithSecret = await withSiteSecret(site);
  const results = [];

  for (const post of posts) {
    const article = buildArticleSchema(post, site);
    const faqPairs = extractFaqPairs(post.content || '');
    const schemaGraph = faqPairs.length >= 2
      ? { '@context': 'https://schema.org', '@graph': [article, buildFaqSchema(faqPairs)] }
      : article;

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
