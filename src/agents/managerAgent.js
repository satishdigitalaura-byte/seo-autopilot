import { getSupabaseClient } from '../lib/supabaseClient.js';
import { pauseAutomation } from '../lib/systemStatus.js';
import { sendNotificationEmail } from '../lib/emailClient.js';
import { renderEmailShell } from '../lib/emailTemplate.js';
import { sendPushNotification } from '../lib/pushClient.js';

/**
 * The Manager Agent — a team lead for the other agents, not a content agent
 * itself. It never writes or reviews content, never calls an LLM, and
 * doesn't invent anything: every check here is a deterministic read of real
 * data (agent_results timestamps, agent_tasks outcomes, GitHub Actions run
 * history). If something looks broken, it does two things immediately:
 *   1. Sets system_status.automation_paused = true (the actual kill switch
 *      every runner checks before processing a single task).
 *   2. Emails the admin with exactly what tripped and why.
 * It never auto-resumes — a human has to look and clear it from the panel,
 * same "human stays in control" principle as the approval gate.
 */
const AGENT_SCHEDULES_MIN = {
  content_draft_agent: 15,
  policy_guardrail_agent: 10,
  gsc_ga4_watcher_agent: 24 * 60,
  seo_audit_agent: 7 * 24 * 60,
};
const STALE_GRACE_MULTIPLIER = 3; // e.g. content_draft_agent flagged only if silent for 45+ min, not right at 15
const ERROR_SPIKE_MIN_SAMPLE = 5;
const ERROR_SPIKE_RATE = 0.5; // >50% of recent tasks failing

// NOT "no result produced recently" — that fires even when an agent is
// perfectly healthy but simply had no work to do (e.g. no new topic was
// added, so content_draft_agent has nothing to draft). The only real signal
// of a stuck/broken agent is a task that was actually handed to it and sat
// there unprocessed well past a normal run cycle — that means the runner
// picked it up (or should have) and never finished, which is a genuine fault.
async function checkStaleness(supabase) {
  const problems = [];
  for (const [agent, intervalMin] of Object.entries(AGENT_SCHEDULES_MIN)) {
    const staleBefore = new Date(Date.now() - intervalMin * STALE_GRACE_MULTIPLIER * 60000).toISOString();
    const { data: stuckTasks } = await supabase
      .from('agent_tasks')
      .select('id, created_at, status')
      .eq('target_agent', agent)
      .in('status', ['pending', 'in_progress'])
      .lt('created_at', staleBefore)
      .limit(1);
    if (stuckTasks && stuckTasks.length > 0) {
      const minsAgo = Math.round((Date.now() - new Date(stuckTasks[0].created_at).getTime()) / 60000);
      problems.push({
        type: 'stale',
        agent,
        detail: `${agent} has a task stuck as "${stuckTasks[0].status}" for ${minsAgo} minutes (expected to be handled within roughly ${intervalMin} min). It looks like it stopped running mid-work, not that there's simply nothing to do.`,
      });
    }
  }
  return problems;
}

// Consecutive-failure check, not a rate over a fixed window or count: a rate
// check can't tell "an old batch of failures that's already fixed" apart
// from "actually broken right now" — both look like a burst. Consecutive
// failures in the most recent tasks (chronological order, no successes mixed
// in) is a much sharper signal: it only fires while the agent is genuinely
// stuck, and self-clears the moment one task succeeds again.
const CONSECUTIVE_FAILURE_THRESHOLD = 5;

async function checkErrorSpikes(supabase) {
  const problems = [];
  for (const agent of Object.keys(AGENT_SCHEDULES_MIN)) {
    const { data: tasks } = await supabase
      .from('agent_tasks')
      .select('status')
      .eq('target_agent', agent)
      .order('created_at', { ascending: false })
      .limit(CONSECUTIVE_FAILURE_THRESHOLD);
    if (!tasks || tasks.length < CONSECUTIVE_FAILURE_THRESHOLD) continue;
    if (tasks.every((t) => t.status === 'failed')) {
      problems.push({
        type: 'error_spike',
        agent,
        detail: `The last ${CONSECUTIVE_FAILURE_THRESHOLD} tasks sent to ${agent} all failed, back to back — it looks stuck, not just having occasional bad luck.`,
      });
    }
  }
  return problems;
}

async function checkGithubActionsFailures() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY || 'satishdigitalaura-byte/seo-autopilot';
  if (!token) return [];
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=15`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const recentFailures = (data.workflow_runs || []).filter(
      (r) => r.conclusion === 'failure' && (r.event === 'schedule' || r.event === 'workflow_dispatch'),
    );
    if (recentFailures.length >= 2) {
      const names = [...new Set(recentFailures.map((r) => r.name))].join(', ');
      return [{
        type: 'workflow_failures',
        agent: 'github_actions',
        detail: `${recentFailures.length} recent automated workflow runs failed (${names}). Check the Actions tab for the error.`,
      }];
    }
  } catch {
    // If GitHub's API itself is unreachable, that's not evidence our own
    // pipeline is broken — don't pause over it.
  }
  return [];
}

async function sendAlertEmail(problems) {
  const bodyHtml = `
    <p>The Manager Agent found a problem and has <strong>paused all automation</strong> until a human reviews it — nothing will run (no drafts, no approvals, no audits) until you resume it from the panel.</p>
    <ul style="padding-left:18px;">
      ${problems.map((p) => `<li style="margin-bottom:8px;"><strong>${p.agent}</strong> — ${p.detail}</li>`).join('')}
    </ul>
    <p style="margin-top:16px;color:#6B7280;">Review the Activity log and Agents section in the panel, fix what's wrong, then use "Resume automation" once you're confident it's safe.</p>
  `;
  try {
    await sendNotificationEmail({
      subject: `[URGENT] SEO Autopilot paused itself — ${problems.length} problem(s) found`,
      html: renderEmailShell({
        badgeLabel: 'Automation Paused',
        badgeTone: 'alert',
        heading: 'Something needs your attention',
        bodyHtml,
      }),
    });
  } catch (err) {
    console.warn('Manager Agent alert email failed (non-fatal):', err.message);
  }
}

export async function runManagerCheck() {
  const supabase = getSupabaseClient();

  const { data: status } = await supabase.from('system_status').select('automation_paused').eq('id', 1).single();
  if (status?.automation_paused) {
    return { decision: 'already_paused' };
  }

  const problems = [
    ...(await checkStaleness(supabase)),
    ...(await checkErrorSpikes(supabase)),
    ...(await checkGithubActionsFailures()),
  ];

  if (problems.length > 0) {
    const reason = problems.map((p) => `[${p.type}] ${p.agent}: ${p.detail}`).join(' | ');
    await pauseAutomation(reason, 'manager_agent');
    await sendAlertEmail(problems);
    await sendPushNotification({
      title: 'SEO Autopilot paused itself',
      body: `${problems.length} problem(s) found — ${problems[0]?.detail || ''}`,
    });
    await supabase.from('agent_results').insert({ agent_name: 'manager_agent', result: { decision: 'paused', problems } });
    await supabase.from('event_log').insert({ actor: 'manager_agent', action: 'paused_automation', details: { problems } });
    return { decision: 'paused', problems };
  }

  await supabase.from('agent_results').insert({ agent_name: 'manager_agent', result: { decision: 'healthy' } });
  return { decision: 'healthy' };
}
