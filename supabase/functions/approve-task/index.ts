// Supabase Edge Function — handles Slack "Approve"/"Reject" button clicks.
// A Slack Block Kit `url`-type button just opens this URL in a browser (a
// plain GET request) — no Slack signature verification needed, since Slack
// isn't POSTing anything back to us. Protection instead comes from the
// `secret` query param, checked against APPROVE_SECRET (a function secret,
// never committed to git).
//
// On approve: marks the human_review_queue task approved, then calls the
// site's own /api/seo-agent/publish endpoint with cmsStatus:'draft' — so the
// post lands in the CMS as a draft, and a human still does one final visual
// check in the site's own admin panel before flipping it fully live. This
// keeps the "one Approve tap" promise from the master architecture doc while
// preserving a second, cheap safety check.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function htmlResponse(message: string) {
  return new Response(
    `<html><body style="font-family:sans-serif;padding:60px 20px;text-align:center;max-width:500px;margin:0 auto;">
       <h2 style="color:#0A1628;">${message}</h2>
     </body></html>`,
    { headers: { 'Content-Type': 'text/html' } },
  );
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const taskId = url.searchParams.get('id');
  const action = url.searchParams.get('action'); // 'approve' | 'reject'
  const secret = url.searchParams.get('secret');

  if (!secret || secret !== Deno.env.get('APPROVE_SECRET')) {
    return htmlResponse('Unauthorized.');
  }
  if (!taskId || !['approve', 'reject'].includes(action || '')) {
    return htmlResponse('Bad request — missing task id or action.');
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: task, error } = await supabase.from('agent_tasks').select('*').eq('id', taskId).single();
  if (error || !task) {
    return htmlResponse('Task not found — it may have already been processed.');
  }
  if (task.status !== 'awaiting_approval') {
    return htmlResponse(`Already handled earlier (status: ${task.status}). No action taken.`);
  }

  if (action === 'reject') {
    await supabase.from('agent_tasks').update({
      status: 'rejected',
      approved_by: 'Slack (rejected)',
      completed_at: new Date().toISOString(),
    }).eq('id', taskId);
    return htmlResponse('❌ Rejected. This draft will not be published.');
  }

  await supabase.from('agent_tasks').update({
    status: 'approved',
    approved_by_human: true,
    approved_by: 'Slack',
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
      ? `Saved to ${site.domain} as a draft. Log in to the admin panel for a final check before publishing live.`
      : `Approved, but the site publish call failed: ${json.error || res.status}. Contact the developer.`;
  } catch (e) {
    publishNote = `Approved, but could not reach the site to save the draft: ${(e as Error).message}`;
  }

  await supabase.from('agent_tasks').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
  }).eq('id', taskId);

  return htmlResponse(`✅ Approved! ${publishNote}`);
});
