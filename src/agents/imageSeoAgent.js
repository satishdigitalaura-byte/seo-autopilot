import { getSupabaseClient } from '../lib/supabaseClient.js';
import { getPublishedPosts } from '../lib/siteLinkInventory.js';
import { withSiteSecret } from '../lib/siteCredentials.js';

/**
 * Image SEO Agent — ADVISORY-ONLY, same posture as On-Page SEO Agent: it
 * never edits live content or re-encodes images (no image-processing infra
 * in this $0 stack), it flags real, mechanically-checked problems so a
 * human can fix them or feed them back into a future draft revision.
 *
 * Per real published post content:
 *   - Missing/empty alt text
 *   - No explicit width/height (a real Core Web Vitals CLS cause)
 *   - No loading="lazy" on below-the-fold-likely images
 *   - Oversized file (fetched via HEAD; flags anything over 200KB, since a
 *     single unoptimized hero image is a common real-world CWV culprit)
 */

const IMAGE_CAP_PER_POST = 12; // bound HEAD-request runtime
const SIZE_WARN_BYTES = 200 * 1024;

function extractImages(html) {
  return [...(html || '').matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
}

function analyzeImgTag(tag) {
  const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1] || null;
  const alt = tag.match(/\balt=["']([^"']*)["']/i)?.[1];
  const hasAlt = alt !== undefined && alt.trim().length > 0;
  const hasDims = /\bwidth=["']?\d/i.test(tag) && /\bheight=["']?\d/i.test(tag);
  const hasLazy = /loading=["']lazy["']/i.test(tag);
  return { src, hasAlt, hasDims, hasLazy };
}

async function checkImageSize(src) {
  if (!src || !/^https?:\/\//i.test(src)) return null;
  try {
    const res = await fetch(src, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    const len = res.headers.get('content-length');
    return len ? Number(len) : null;
  } catch {
    return null;
  }
}

export async function runImageSeoForSite(site) {
  const supabase = getSupabaseClient();
  // Secret first: /posts/list is behind the shared secret, so fetching the
  // post list before loading it silently returned nothing at all.
  const posts = await getPublishedPosts(await withSiteSecret(site));
  if (posts.length === 0) {
    // Logged, not just returned — see internalLinkingAgent.js: a scheduled
    // agent that stays silent is indistinguishable from a dead one.
    const skipped = { skipped: true, reason: 'no published posts found' };
    await supabase.from('agent_results').insert({ site_id: site.id, agent_name: 'image_seo_agent', result: skipped });
    return skipped;
  }

  const perPost = [];
  for (const post of posts) {
    const tags = extractImages(post.content || '').slice(0, IMAGE_CAP_PER_POST);
    if (tags.length === 0) continue;

    const findings = [];
    let missingAlt = 0, missingDims = 0, missingLazy = 0, oversized = 0;

    for (const tag of tags) {
      const info = analyzeImgTag(tag);
      if (!info.hasAlt) missingAlt++;
      if (!info.hasDims) missingDims++;
      if (!info.hasLazy) missingLazy++;
      const size = await checkImageSize(info.src);
      if (size && size > SIZE_WARN_BYTES) {
        oversized++;
        findings.push(`Image ${Math.round(size / 1024)}KB (over the ${SIZE_WARN_BYTES / 1024}KB guideline): ${info.src}`);
      }
    }

    if (missingAlt) findings.push(`${missingAlt} of ${tags.length} image(s) missing alt text.`);
    if (missingDims) findings.push(`${missingDims} of ${tags.length} image(s) missing explicit width/height (CLS risk).`);
    if (missingLazy) findings.push(`${missingLazy} of ${tags.length} image(s) missing loading="lazy".`);

    if (findings.length) {
      perPost.push({ slug: post.slug, title: post.title, imageCount: tags.length, missingAlt, missingDims, missingLazy, oversized, findings });
    }
  }

  const result = { postsScanned: posts.length, postsWithIssues: perPost.length, perPost };
  await supabase.from('agent_results').insert({ site_id: site.id, agent_name: 'image_seo_agent', result });
  try {
    await supabase.from('event_log').insert({
      site_id: site.id, actor: 'image_seo_agent', action: 'image_seo_audit_completed',
      details: { postsScanned: posts.length, postsWithIssues: perPost.length },
    });
  } catch (err) {
    console.warn(`event_log insert failed (non-fatal): ${err.message}`);
  }

  return { site: site.domain, ...result };
}
