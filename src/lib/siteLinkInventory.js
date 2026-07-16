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
