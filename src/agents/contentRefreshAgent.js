import { getSupabaseClient } from '../lib/supabaseClient.js';
import { getPublishedPosts } from '../lib/siteLinkInventory.js';
import { withSiteSecret } from '../lib/siteCredentials.js';

/**
 * Content Refresh Agent — the chain-starter from Master Architecture §2.
 * Processes `investigate_drop` tasks the GSC/GA4 Watcher already queues
 * (real traffic-drop data, not a blind schedule — every refresh has a
 * concrete, data-backed reason, which is also what keeps this outside
 * "scaled content abuse" territory per Guidelines §6).
 *
 * It does NOT write content itself — it triages: is this page (a) a real
 * published post we can identify, (b) actually stale (not updated in the
 * period the drop covers), and if so hands off to the EXISTING
 * content_draft_agent pipeline with a draft_new task. The originalElement
 * required by that pipeline's hard gate (Guidelines §6) is the real traffic
 * data itself — a genuine, firsthand fact about this exact site, not
 * invented.
 */

const STALE_DAYS = 120; // ~4 months — if it hasn't been touched since, that's a real refresh candidate

function matchPostByUrl(url, posts, siteDomain) {
  let path;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url;
  }
  const slugFromPath = path.replace(/^\/(blog\/)?/, '').replace(/\/+$/, '');
  return posts.find((p) => p.slug === slugFromPath) || null;
}

export async function processContentRefreshTask(task) {
  const supabase = getSupabaseClient();
  const p = task.payload || {};

  const { data: site } = await supabase.from('sites').select('*').eq('id', task.site_id).single();
  if (!site) {
    await supabase.from('agent_tasks').update({ status: 'failed', error_message: 'Site not found.', completed_at: new Date().toISOString() }).eq('id', task.id);
    return { decision: 'failed_no_site' };
  }

  // Secret first: /posts/list is behind the shared secret, so fetching the
  // post list before loading it silently returned nothing at all.
  const posts = await getPublishedPosts(await withSiteSecret(site));
  const post = matchPostByUrl(p.url, posts, site.domain);

  if (!post) {
    // Not every drop is a blog post (could be a service page) — this agent
    // only handles blog refreshes; anything else is logged and closed, not
    // retried forever.
    await supabase.from('agent_tasks').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      error_message: 'No matching published blog post found for this URL — likely a non-blog page, skipping (out of this agent\'s scope).',
    }).eq('id', task.id);
    return { decision: 'skipped_not_a_blog_post' };
  }

  const updatedAt = post.updatedAt ? new Date(post.updatedAt) : null;
  const daysSinceUpdate = updatedAt ? Math.round((Date.now() - updatedAt.getTime()) / 86400000) : null;
  const isStale = daysSinceUpdate === null || daysSinceUpdate >= STALE_DAYS;

  if (!isStale) {
    await supabase.from('agent_tasks').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      error_message: `Traffic dropped but this post was updated ${daysSinceUpdate} days ago — staleness isn't the likely cause, skipping auto-refresh (a human should investigate: could be a ranking/algorithm/SERP-feature change instead).`,
    }).eq('id', task.id);
    return { decision: 'skipped_not_stale' };
  }

  const clicksLost = (p.clicksBefore || 0) - (p.clicksAfter || 0);
  const originalElement =
    `This exact page ("${post.title}") on ${site.domain} lost ${clicksLost} Search Console clicks ` +
    `(${p.clicksBefore || 0} → ${p.clicksAfter || 0}, a ${Math.abs(Math.round(p.changePct || 0))}% drop) ` +
    `over the period ${p.dateRanges?.previous?.startDate || '?'} to ${p.dateRanges?.current?.endDate || '?'}, ` +
    `and hasn't been updated in ${daysSinceUpdate} days — a real, firsthand performance fact about this site, not an invented stat.`;

  await supabase.from('agent_tasks').insert({
    site_id: task.site_id,
    source_agent: 'content_refresh_agent',
    target_agent: 'content_draft_agent',
    task_type: 'draft_new',
    priority: task.priority || 5,
    payload: {
      topic: post.title,
      originalElement,
      triggerReason: 'content_refresh_stale_traffic_drop',
      blogType: 'general',
      refreshOfSlug: post.slug,
    },
    status: 'pending',
  });

  await supabase.from('agent_tasks').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', task.id);

  await supabase.from('agent_results').insert({
    site_id: task.site_id,
    agent_name: 'content_refresh_agent',
    result: { url: p.url, slug: post.slug, title: post.title, daysSinceUpdate, clicksLost, decision: 'queued_refresh_draft' },
  });

  return { decision: 'queued_refresh_draft', slug: post.slug, daysSinceUpdate };
}
