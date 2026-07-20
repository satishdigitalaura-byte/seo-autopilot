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

// Every panel account has a role in its own app_metadata (set only via the
// admin API, so a user can never grant themselves a role). 'admin' can
// approve/reject/create topics/manage users; 'viewer' can only read.
async function getCaller(req: Request) {
  const authHeader = req.headers.get('Authorization') || '';
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data } = await userClient.auth.getUser();
  const user = data?.user;
  const role = (user?.app_metadata?.role as string) || 'viewer';
  return { user, role, isAdmin: role === 'admin' };
}

// Fire GitHub Actions workflows on-demand instead of waiting for their cron,
// so a topic created from the panel gets drafted immediately. Soft-fails
// (silently skipped) if GITHUB_TOKEN isn't configured as a function secret —
// the task still gets picked up by the normal 15-min cron either way.
async function triggerWorkflow(workflowFile: string) {
  const token = Deno.env.get('GITHUB_TOKEN');
  const repo = Deno.env.get('GITHUB_REPO') || 'satishdigitalaura-byte/seo-autopilot';
  if (!token) return false;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main' }),
    });
    return res.ok;
  } catch {
    return false;
  }
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
    const [{ data: pending }, { data: recent }, { data: sites }, { data: results }, { data: sysStatus }, { data: agentSettingsRows }] = await Promise.all([
      supabase.from('agent_tasks').select('*, sites(domain)').eq('task_type', 'approve_draft').eq('status', 'awaiting_approval').order('created_at', { ascending: false }),
      supabase.from('agent_tasks').select('id, task_type, source_agent, target_agent, status, created_at, completed_at, error_message, sites(domain)').order('created_at', { ascending: false }).limit(30),
      supabase.from('sites').select('id, domain, name').order('domain'),
      supabase.from('agent_results').select('agent_name, created_at, result').order('created_at', { ascending: false }).limit(200),
      supabase.from('system_status').select('*').eq('id', 1).single(),
      supabase.from('agent_settings').select('agent_name, enabled'),
    ]);

    // Known agents this system runs, with static metadata (schedule/description
    // don't live in the DB) merged with the most recent real activity timestamp
    // per agent, so the panel shows whether each one is actually alive.
    const AGENTS = [
      { id: 'content_draft_agent', name: 'Content Draft Agent', description: 'Writes SEO-optimized blog drafts from real client results, following the full on-page checklist.', schedule: 'Every 15 minutes' },
      { id: 'keyword_planner', name: 'Keyword Planner', description: 'Pulls real Google Ads search-volume + Search Console query data before every draft — never invented numbers.', schedule: 'Runs inside Content Draft Agent' },
      { id: 'policy_guardrail_agent', name: 'Policy Guardrail Agent', description: 'Reviews every draft before it reaches a human — rejects spam/policy violations, sends Slack + email for approval.', schedule: 'Every 10 minutes' },
      { id: 'seo_audit_agent', name: 'SEO Audit Agent', description: 'Weekly deep audit: striking-distance keywords, low-CTR pages, query movement, content gaps.', schedule: 'Weekly (Monday)' },
      { id: 'gsc_ga4_watcher_agent', name: 'GSC/GA4 Watcher', description: 'Watches for real traffic drops per page and flags them for investigation.', schedule: 'Daily' },
      { id: 'content_refresh_agent', name: 'Content Refresh Agent', description: 'Refreshes underperforming content flagged by the Watcher.', schedule: 'Not built yet' },
      { id: 'topic_discovery_agent', name: 'Topic Discovery Agent', description: 'Finds what to write next: striking-distance queries, content gaps, and trending queries from real Search Console + Keyword Planner data, ranked with strategic reasoning. Emails a ready-to-use shortlist — a human still supplies the real fact each draft needs and creates the topic.', schedule: 'Daily', toggleable: true },
      { id: 'manager_agent', name: 'Manager Agent', description: 'Watches every other agent for stale runs or error spikes — auto-pauses all automation and emails you if something looks broken.', schedule: 'Every 10 minutes' },
    ];
    const agentSettingsMap: Record<string, boolean> = {};
    for (const row of agentSettingsRows || []) agentSettingsMap[row.agent_name] = row.enabled;
    const lastRunByAgent: Record<string, string> = {};
    for (const r of results || []) {
      if (!lastRunByAgent[r.agent_name]) lastRunByAgent[r.agent_name] = r.created_at;
      // keyword_planner isn't a separate DB agent — it runs inside every
      // content_draft_agent result that actually used real ads/GSC data.
      if (r.agent_name === 'content_draft_agent' && !lastRunByAgent['keyword_planner']) {
        const kw = (r.result as any)?.keywordResearch;
        if (kw && ((kw.adsKeywordIdeasUsed?.length ?? 0) > 0 || (kw.realQueriesUsed?.length ?? 0) > 0)) {
          lastRunByAgent['keyword_planner'] = r.created_at;
        }
      }
    }
    const agents = AGENTS.map((a) => ({
      ...a,
      lastRun: lastRunByAgent[a.id] || null,
      // Default true when no row exists yet (agent never explicitly toggled) —
      // must never read as "off" just because it's never been touched.
      enabled: a.toggleable ? (agentSettingsMap[a.id] !== false) : true,
    }));

    const { role: callerRole } = await getCaller(req);

    return json({ pending: pending || [], recent: recent || [], sites: sites || [], agents, callerRole, systemStatus: sysStatus || null });
  }

  if (action === 'pause_automation') {
    const { isAdmin, user: caller } = await getCaller(req);
    if (!isAdmin) return json({ error: 'Only admins can pause automation.' }, 403);

    const { error } = await supabase.from('system_status').update({
      automation_paused: true,
      pause_reason: `Manually paused by admin (${caller?.email || 'Panel'}) — all agents stopped until resumed.`,
      paused_at: new Date().toISOString(),
      paused_by: caller?.email || 'Panel',
    }).eq('id', 1);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (action === 'resume_automation') {
    const { isAdmin, user: caller } = await getCaller(req);
    if (!isAdmin) return json({ error: 'Only admins can resume automation.' }, 403);

    const { error } = await supabase.from('system_status').update({
      automation_paused: false,
      pause_reason: null,
      resumed_at: new Date().toISOString(),
      resumed_by: caller?.email || 'Panel',
    }).eq('id', 1);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (action === 'approve' || action === 'reject') {
    const { role, isAdmin } = await getCaller(req);
    if (!isAdmin) return json({ error: 'View-only accounts cannot approve or reject drafts.' }, 403);

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
    const { isAdmin } = await getCaller(req);
    if (!isAdmin) return json({ error: 'View-only accounts cannot create new topics.' }, 403);

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

    // Try to run it right now instead of waiting for the next cron tick.
    // content-draft.yml now chains straight into the guardrail review itself
    // once the draft is done, so there's no longer a fixed-delay guess here
    // that can race against a slow draft.
    const dispatched = await triggerWorkflow('content-draft.yml');

    return json({ ok: true, task: data[0], immediate: dispatched });
  }

  if (action === 'toggle_agent') {
    const { isAdmin, user: caller } = await getCaller(req);
    if (!isAdmin) return json({ error: 'Only admins can turn agents on or off.' }, 403);

    const { agentName, enabled } = body as { agentName?: string; enabled?: boolean };
    // Whitelist which agents can be toggled from here — this must never become
    // a generic switch for agents that don't check agent_settings (content
    // draft / policy guardrail / manager are controlled by the global
    // automation_paused kill-switch only, on purpose).
    const TOGGLEABLE_AGENTS = ['topic_discovery_agent'];
    if (!agentName || !TOGGLEABLE_AGENTS.includes(agentName)) {
      return json({ error: 'This agent cannot be toggled individually.' }, 400);
    }
    const { error } = await supabase.from('agent_settings').upsert({
      agent_name: agentName,
      enabled: !!enabled,
      updated_at: new Date().toISOString(),
      updated_by: caller?.email || 'Panel',
    });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, agentName, enabled: !!enabled });
  }

  // ---- User management (admin only) ----
  if (action === 'list_users') {
    const { data, error } = await supabase.auth.admin.listUsers();
    if (error) return json({ error: error.message }, 500);
    const users = data.users.map((u) => ({
      id: u.id,
      email: u.email,
      role: (u.app_metadata as any)?.role || 'viewer',
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
    }));
    return json({ users });
  }

  if (action === 'create_user') {
    const { isAdmin } = await getCaller(req);
    if (!isAdmin) return json({ error: 'Only admins can add users.' }, 403);

    const { email, password, role } = body as { email?: string; password?: string; role?: string };
    if (!email || !password || password.length < 8) {
      return json({ error: 'A valid email and a password (8+ characters) are required.' }, 400);
    }
    const finalRole = role === 'admin' ? 'admin' : 'viewer';
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role: finalRole },
    });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, user: { id: data.user.id, email: data.user.email, role: finalRole } });
  }

  if (action === 'update_user_role') {
    const { isAdmin, user: caller } = await getCaller(req);
    if (!isAdmin) return json({ error: 'Only admins can change roles.' }, 403);

    const { userId, role } = body as { userId?: string; role?: string };
    if (!userId || (role !== 'admin' && role !== 'viewer')) return json({ error: 'userId and a valid role are required.' }, 400);
    if (userId === caller?.id && role !== 'admin') {
      return json({ error: "You can't remove your own admin access." }, 400);
    }
    const { error } = await supabase.auth.admin.updateUserById(userId, { app_metadata: { role } });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (action === 'delete_user') {
    const { isAdmin, user: caller } = await getCaller(req);
    if (!isAdmin) return json({ error: 'Only admins can remove users.' }, 403);

    const { userId } = body as { userId?: string };
    if (!userId) return json({ error: 'userId required' }, 400);
    if (userId === caller?.id) return json({ error: "You can't remove your own account." }, 400);
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: 'Unknown action' }, 400);
});
