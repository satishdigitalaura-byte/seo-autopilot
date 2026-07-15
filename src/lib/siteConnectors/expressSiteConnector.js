/**
 * Generic caller for sites running the drop-in Express connector
 * (see integrations/<site>/seoAgentRouter.js). Reusable across every
 * client site that installs the same router, not just thedigitalaura.com.
 */

async function call(site, path, body) {
  const secret = site.credentials?.seo_agent_shared_secret;
  if (!site.api_base_url) throw new Error(`Site ${site.domain} has no api_base_url set yet.`);
  if (!secret) throw new Error(`Site ${site.domain} has no seo_agent_shared_secret credential set yet.`);

  const res = await fetch(`${site.api_base_url}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Seo-Agent-Secret': secret,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${path} -> ${res.status}: ${data.error || res.statusText}`);
  }
  return data;
}

export function checkHealth(site) {
  return fetch(`${site.api_base_url}/health`).then((r) => r.json());
}

/** task.payload must include approvedByHuman: true — enforced again server-side. */
export function publish(site, task) {
  return call(site, '/publish', { ...task.payload, approvedByHuman: task.approved_by_human === true });
}

export function updateSchema(site, payload) {
  return call(site, '/schema/update', payload);
}

export function regenerateSitemap(site) {
  return call(site, '/sitemap/regenerate', {});
}

export function applyInternalLinks(site, payload) {
  return call(site, '/internal-links/apply', payload);
}
