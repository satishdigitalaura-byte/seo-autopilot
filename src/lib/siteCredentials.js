import { getSupabaseClient } from './supabaseClient.js';

/**
 * Loads a site's seo_agent_shared_secret from site_credentials and returns a
 * shallow copy of the site row with `.credentials.seo_agent_shared_secret`
 * set, in the shape expressSiteConnector.js expects. Centralizing this here
 * so every agent that calls the site's connector (internal links, schema,
 * sitemap) fetches the secret the same way instead of re-querying inline.
 */
export async function withSiteSecret(site) {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('site_credentials')
    .select('credential_value')
    .eq('site_id', site.id)
    .eq('credential_key', 'seo_agent_shared_secret')
    .single();
  return { ...site, credentials: { seo_agent_shared_secret: data?.credential_value || null } };
}
