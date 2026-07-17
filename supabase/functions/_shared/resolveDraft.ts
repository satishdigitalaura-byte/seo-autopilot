// Shared approve/reject logic used by both approve-task (Slack/email link
// clicks, secret-param auth) and panel-api (logged-in panel users, JWT auth)
// so the actual publish behavior never diverges between the two entry points.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
        cmsStatus: 'draft',
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
    publishNote = res.ok
      ? `Saved to ${site.domain} as a draft. Log in to the site admin panel for a final check before publishing live.`
      : `Approved, but the site publish call failed: ${json.error || res.status}. Contact the developer.`;
  } catch (e) {
    publishNote = `Approved, but could not reach the site to save the draft: ${(e as Error).message}`;
  }

  await supabase.from('agent_tasks').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
  }).eq('id', taskId);

  return { ok: true, message: `Approved! ${publishNote}` };
}
