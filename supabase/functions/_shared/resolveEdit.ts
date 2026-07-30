// Applies a human-approved edit to content that is already live. Mirrors
// resolveDraft.ts (same status transitions and audit trail) but targets an
// existing page/post instead of publishing a new one.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// See resolveDraft.ts's triggerWebsitePrerender for why this exists: the
// site's crawler-facing HTML is a prerendered snapshot baked at deploy time,
// separate from the live DB data. An approved edit is live for real users
// immediately but stale for Googlebot until the next deploy — re-triggering
// the deploy workflow here closes that gap the same way a new publish does.
async function triggerWebsitePrerender() {
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

type Change = { field: string; label: string; before: string; after: string };

// Maps our internal field names onto the site connector's request body. Only
// fields listed here can ever be written — an unknown field in a payload is
// ignored rather than forwarded blindly.
const BLOG_FIELD_MAP: Record<string, string> = {
  meta_title: 'metaTitle',
  meta_desc: 'metaDescription',
  canonical: 'canonical',
  content: 'content',
  title: 'title',
  excerpt: 'excerpt',
  keywords: 'keywords',
};

const PAGE_FIELD_MAP: Record<string, string> = {
  meta_title: 'metaTitle',
  meta_desc: 'metaDescription',
  canonical: 'canonical',
  keywords: 'keywords',
  og_image: 'ogImage',
};

export async function resolveEditTask(
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
    return { ok: true, message: 'Rejected. The live page is unchanged.' };
  }

  await supabase.from('agent_tasks').update({
    status: 'approved',
    approved_by_human: true,
    approved_by: approvedBy,
    approved_at: new Date().toISOString(),
  }).eq('id', taskId);

  const { targetType, slug, changes } = task.payload as {
    targetType: 'blog' | 'page'; slug: string; changes: Change[];
  };

  const { data: site } = await supabase.from('sites').select('*').eq('id', task.site_id).single();
  const { data: cred } = await supabase
    .from('site_credentials')
    .select('credential_value')
    .eq('site_id', task.site_id)
    .eq('credential_key', 'seo_agent_shared_secret')
    .single();

  const headers = {
    'Content-Type': 'application/json',
    'X-Seo-Agent-Secret': cred?.credential_value || '',
  };

  const fieldMap = targetType === 'blog' ? BLOG_FIELD_MAP : PAGE_FIELD_MAP;
  const body: Record<string, unknown> = { approvedByHuman: true, slug };
  const applied: string[] = [];
  const unsupported: string[] = [];

  for (const c of changes || []) {
    const apiField = fieldMap[c.field];
    if (!apiField) { unsupported.push(c.field); continue; }
    body[apiField] = c.after;
    applied.push(c.field);
  }

  let note = '';
  try {
    if (applied.length === 0) {
      note = `No supported fields in this proposal${unsupported.length ? ` (unsupported: ${unsupported.join(', ')})` : ''} — nothing was changed.`;
    } else {
      if (targetType === 'blog') {
        // /publish upserts by slug and prunes undefined, so sending only the
        // changed fields updates them without nulling anything else. title is
        // required by that route, so carry the existing one through.
        body.title = body.title ?? task.payload.targetLabel;
        body.cmsStatus = 'published';
      }
      const path = targetType === 'blog' ? '/publish' : '/page/seo';
      const res = await fetch(`${site.api_base_url}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        const prerenderTriggered = await triggerWebsitePrerender();
        note = `Updated ${applied.join(', ')} on ${site.domain}/${slug}. Live for visitors now — ${
          prerenderTriggered
            ? 'rebuilding the site now so this is fully crawlable for Google too, live in a few minutes.'
            : 'could not auto-trigger the site rebuild, so the prerendered HTML crawlers see refreshes only on the next site deploy.'
        }`;
      } else {
        note = `Approved, but the site update failed: ${json.error || res.status}. Contact the developer.`;
      }
      if (res.ok && unsupported.length) note += ` (Skipped unsupported field(s): ${unsupported.join(', ')}.)`;
    }
  } catch (e) {
    note = `Approved, but could not reach the site to apply the edit: ${(e as Error).message}`;
  }

  await supabase.from('agent_tasks').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
  }).eq('id', taskId);

  return { ok: true, message: `Approved! ${note}` };
}
