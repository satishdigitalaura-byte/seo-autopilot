// Backend for the SEO Autopilot panel (docs/index.html). Deployed WITHOUT
// --no-verify-jwt, so Supabase itself rejects any request that doesn't carry
// a valid, logged-in user's session token — only pre-created panel accounts
// (Supabase Auth users created via the admin API, public sign-ups disabled)
// can ever reach this code. It always uses the service_role key internally,
// never exposes it to the browser.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveDraftTask } from '../_shared/resolveDraft.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const action = body.action as string;

  if (action === 'list') {
    const [{ data: pending }, { data: recent }, { data: sites }] = await Promise.all([
      supabase.from('agent_tasks').select('*, sites(domain)').eq('task_type', 'approve_draft').eq('status', 'awaiting_approval').order('created_at', { ascending: false }),
      supabase.from('agent_tasks').select('id, task_type, source_agent, target_agent, status, created_at, completed_at, error_message, sites(domain)').order('created_at', { ascending: false }).limit(30),
      supabase.from('sites').select('id, domain, name').order('domain'),
    ]);
    return json({ pending: pending || [], recent: recent || [], sites: sites || [] });
  }

  if (action === 'approve' || action === 'reject') {
    const taskId = body.taskId as string;
    if (!taskId) return json({ error: 'taskId required' }, 400);
    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const approvedBy = userData?.user?.email || 'Panel';
    const result = await resolveDraftTask(supabase, taskId, action, `Panel (${approvedBy})`);
    return json(result);
  }

  if (action === 'create_topic') {
    const { siteId, topic, originalElement, triggerReason } = body as {
      siteId?: string; topic?: string; originalElement?: string; triggerReason?: string;
    };
    if (!siteId || !topic || !originalElement) {
      return json({ error: 'siteId, topic, and originalElement are all required' }, 400);
    }
    const { data, error } = await supabase.from('agent_tasks').insert({
      site_id: siteId,
      source_agent: 'panel',
      target_agent: 'content_draft_agent',
      task_type: 'draft_new',
      status: 'pending',
      payload: { topic, originalElement, triggerReason: triggerReason || 'panel_manual_request' },
    }).select();
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, task: data[0] });
  }

  return json({ error: 'Unknown action' }, 400);
});
