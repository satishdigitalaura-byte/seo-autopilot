/**
 * Real internal-link candidates for a site, pulled live from its own public
 * nav API — never a hardcoded/guessed list. Keeps internal linking accurate
 * even if the site's page structure changes later, and works for any site
 * this system manages, not just thedigitalaura.com.
 */
export async function getInternalLinkCandidates(site) {
  if (!site.domain) return [];
  const base = `https://${site.domain}`.replace(/\/+$/, '');

  try {
    const res = await fetch(`${base}/api/nav`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const json = await res.json();
    const items = json.data || json || [];
    return items
      .filter((i) => i.is_visible !== false && i.href)
      .map((i) => ({ anchorText: i.label, url: `${base}${i.href.startsWith('/') ? i.href : `/${i.href}`}` }))
      .filter((i) => i.url !== `${base}/`); // skip linking the homepage, rarely useful mid-article
  } catch (err) {
    console.warn(`Could not fetch nav for ${site.domain}: ${err.message}`);
    return [];
  }
}

/**
 * Normalizes a post row from either source into the one shape every agent
 * consumes, so callers never have to care which endpoint answered.
 */
function normalizePost(p) {
  return {
    slug: p.slug,
    title: p.title,
    content: p.content || '',
    excerpt: p.excerpt || null,
    createdAt: p.createdAt || p.created_at || p.publishedAt || null,
    updatedAt: p.updatedAt || p.updated_at || null,
  };
}

/**
 * Real published blog posts — used by Internal Linking, Schema, Image SEO and
 * Content Refresh so they only ever act on what's genuinely live, never a
 * guessed post list.
 *
 * Two sources, tried in order:
 *   1. The site's own connector, GET /posts/list. This route is behind the
 *      shared secret, so the header is REQUIRED — calling it bare returns 401
 *      and silently yielded [] here, which is why those four agents had never
 *      once done any work.
 *   2. The site's public blog API (/api/blogs). Sites that haven't redeployed
 *      the newer connector still 404 on /posts/list, and this keeps the agents
 *      working on real live data instead of no-op'ing until a dev gets to it.
 *
 * Still returns [] rather than throwing if genuinely nothing is reachable, so
 * a site that's simply down degrades to "no work this run" instead of failing
 * the whole agent.
 */
export async function getPublishedPosts(site) {
  const secret = site.credentials?.seo_agent_shared_secret;

  if (site.api_base_url) {
    try {
      const res = await fetch(`${site.api_base_url}/posts/list`, {
        headers: secret ? { 'X-Seo-Agent-Secret': secret } : {},
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const json = await res.json();
        const posts = json.posts || json.data || [];
        if (posts.length > 0) return posts.map(normalizePost);
      } else if (res.status === 401) {
        console.warn(`/posts/list rejected the shared secret for ${site.domain} — falling back to the public blog API.`);
      }
    } catch (err) {
      console.warn(`/posts/list unreachable for ${site.domain} (${err.message}) — falling back to the public blog API.`);
    }
  }

  if (!site.domain) return [];
  try {
    const base = `https://${site.domain}`.replace(/\/+$/, '');
    const res = await fetch(`${base}/api/blogs`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.data || json.posts || [])
      .filter((p) => p.slug && (p.status === undefined || p.status === 'published'))
      .map(normalizePost);
  } catch (err) {
    console.warn(`Could not fetch published posts for ${site.domain}: ${err.message}`);
    return [];
  }
}
