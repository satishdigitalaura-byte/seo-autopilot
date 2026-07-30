// Shared approve/reject logic used by panel-api (logged-in panel users, JWT
// auth) — the admin panel is the only approval channel now.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// A publish only ever writes to the site's database — the site's crawler-
// facing HTML is a separate prerendered snapshot (digital-aura-project's
// scripts/prerender.mjs) baked at deploy time. Without this, a newly
// approved page is live for real users immediately but invisible/wrong for
// Googlebot and social-share previews until the *next* unrelated code
// deploy happens to run — this is exactly what went wrong silently on
// 2026-07-28 (see prerender.mjs's DEFAULT_TITLE check). Re-triggering the
// site's "Deploy to Live" workflow right after a successful publish makes
// every new/edited page get prerendered within minutes instead of waiting
// on an unrelated deploy. Soft-fails (silently skipped) if the
// WEBSITE_GITHUB_TOKEN function secret isn't configured — publishing itself
// must never be blocked by this.
async function triggerWebsitePrerender() {
  // Falls back to the same GITHUB_TOKEN already used to trigger seo-autopilot
  // workflows (panel-api's triggerWorkflow) — that PAT belongs to a GitHub
  // account that already has push/PR access to the website repo (it opens
  // PRs there today), so it very likely already has the actions:write scope
  // this needs too, with no new secret required.
  const token = Deno.env.get('WEBSITE_GITHUB_TOKEN') || Deno.env.get('GITHUB_TOKEN');
  const repo = Deno.env.get('WEBSITE_GITHUB_REPO') || 'swayamdigitalaura-gif/digitalaura-website';
  if (!token) return false;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/deploy.yml/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main', inputs: { target: 'main-site' } }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function resolveDraftTask(
  supabase: ReturnType<typeof createClient>,
  taskId: string,
  action: 'approve' | 'reject',
  approvedBy: string,
) {
  const { data: task, error } = await supabase.from('agent_tasks').select('*').eq('id', taskId).single();
  if (error || !task) {
    return { ok: false, message: 'Task not found — it may have already been processed.' };
  }
  if (task.status !== 'awaiting_approval') {
    return { ok: false, message: `Already handled earlier (status: ${task.status}). No action taken.` };
  }

  if (action === 'reject') {
    await supabase.from('agent_tasks').update({
      status: 'rejected',
      approved_by: `${approvedBy} (rejected)`,
      completed_at: new Date().toISOString(),
    }).eq('id', taskId);
    return { ok: true, message: 'Rejected. This draft will not be published.' };
  }

  await supabase.from('agent_tasks').update({
    status: 'approved',
    approved_by_human: true,
    approved_by: approvedBy,
    approved_at: new Date().toISOString(),
  }).eq('id', taskId);

  const { data: site } = await supabase.from('sites').select('*').eq('id', task.site_id).single();
  const { data: cred } = await supabase
    .from('site_credentials')
    .select('credential_value')
    .eq('site_id', task.site_id)
    .eq('credential_key', 'seo_agent_shared_secret')
    .single();

  let publishNote = '';
  try {
    const res = await fetch(`${site.api_base_url}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Seo-Agent-Secret': cred?.credential_value || '' },
      body: JSON.stringify({
        approvedByHuman: true,
        cmsStatus: 'published',
        slug: task.payload.slug,
        title: task.payload.title,
        content: task.payload.content,
        excerpt: task.payload.excerpt,
        metaTitle: task.payload.metaTitle,
        metaDescription: task.payload.metaDescription,
        keywords: task.payload.keywords,
      }),
    });
    const json = await res.json();
    if (res.ok) {
      const prerenderTriggered = await triggerWebsitePrerender();
      publishNote = prerenderTriggered
        ? `Published live on ${site.domain}. Rebuilding the site now so this page is fully crawlable for Google — live in a few minutes.`
        : `Published live on ${site.domain}. Note: could not auto-trigger the site rebuild (WEBSITE_GITHUB_TOKEN not configured) — this page will only be fully crawlable after the next site deploy.`;
    } else {
      publishNote = `Approved, but the site publish call failed: ${json.error || res.status}. Contact the developer.`;
    }
  } catch (e) {
    publishNote = `Approved, but could not reach the site to save the draft: ${(e as Error).message}`;
  }

  await supabase.from('agent_tasks').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
  }).eq('id', taskId);

  return { ok: true, message: `Approved! ${publishNote}` };
}
