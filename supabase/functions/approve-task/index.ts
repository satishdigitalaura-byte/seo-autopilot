// Supabase Edge Function — handles Slack "Approve"/"Reject" button clicks.
// A Slack Block Kit `url`-type button just opens this URL in a browser (a
// plain GET request) — no Slack signature verification needed, since Slack
// isn't POSTing anything back to us. Protection instead comes from the
// `secret` query param, checked against APPROVE_SECRET (a function secret,
// never committed to git).
//
// On approve: marks the human_review_queue task approved, then calls the
// site's own /api/seo-agent/publish endpoint with cmsStatus:'published' — so
// the post goes live immediately. One Approve tap is the entire publish step;
// there is no second manual publish inside the site's own admin panel.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveDraftTask } from '../_shared/resolveDraft.ts';

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

  const result = await resolveDraftTask(supabase, taskId, action as 'approve' | 'reject', 'Slack');
  return htmlResponse(`${result.ok ? '✅' : '⚠️'} ${result.message}`);
});
