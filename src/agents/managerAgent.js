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
const HOUR = 60;
const DAY = 24 * HOUR;

/**
 * Every agent this system runs, and how it should be watched. Before this
 * covered all 15, only the five task-driven ones were monitored — the ten
 * newer agents could die silently and nobody would ever be told.
 *
 * Two kinds, because they fail in genuinely different ways:
 *
 *   'queue'    — driven by rows in agent_tasks. A fault looks like a task
 *                handed to the agent that sits unprocessed. Silence on its
 *                own means nothing (usually there's just no work to do), so
 *                these are never judged on "hasn't produced a result".
 *
 *   'schedule' — driven purely by cron; it runs whether or not there's work
 *                and always logs a result (including a deliberate "skipped"
 *                one). For these, silence past its own interval IS the fault
 *                signal — it means the workflow itself stopped firing.
 *
 * severity decides the response, so one broken weekly audit can't take the
 * whole content pipeline offline:
 *   'critical' — core publishing pipeline. Trips the kill switch.
 *   'warning'  — advisory/analysis agent. Reported and emailed, never pauses.
 */
// 2026-07-29: agents moved from "run constantly" to a real editorial cadence
// (see .github/workflows/*.yml). content_draft_agent and policy_guardrail_agent
// are no longer the primary trigger for their own work — the panel dispatches
// them instantly when a draft is created/needs review — so their cron is now
// only a 6h fallback net, and their intervalMin below reflects THAT, not the
// old 10-15min poll. Every intervalMin here must track the workflow's actual
// cron or this file starts crying wolf on a schedule that was deliberately
// slowed down.
const AGENT_MONITORS = {
  content_draft_agent:         { kind: 'queue',    intervalMin: 6 * HOUR, severity: 'critical' },
  policy_guardrail_agent:      { kind: 'queue',    intervalMin: 6 * HOUR, severity: 'critical' },
  content_refresh_agent:       { kind: 'queue',    intervalMin: 3 * DAY, severity: 'critical' },
  human_review_queue:          { kind: 'queue',    intervalMin: 10,      severity: 'warning'  },

  // cron says */2h but GitHub Actions does not honor scheduled workflows
  // precisely on this plan — real gaps were observed up to ~3.4x the nominal
  // interval even when healthy. intervalMin here is what a *missing*
  // workflow looks like, not the cron string itself.
  manager_agent:               { kind: 'schedule', intervalMin: 3 * HOUR, severity: 'warning'  },
  content_edit_agent:          { kind: 'schedule', intervalMin: 7 * DAY, severity: 'warning'  },
  analytics_snapshot_agent:    { kind: 'schedule', intervalMin: DAY,     severity: 'warning'  },
  gsc_ga4_watcher_agent:       { kind: 'schedule', intervalMin: 7 * DAY, severity: 'warning'  },
  topic_discovery_agent:       { kind: 'schedule', intervalMin: DAY,     severity: 'warning'  },
  schema_agent:                { kind: 'schedule', intervalMin: 7 * DAY, severity: 'warning'  },
  internal_linking_agent:      { kind: 'schedule', intervalMin: 7 * DAY, severity: 'warning' },
  seo_audit_agent:             { kind: 'schedule', intervalMin: 7 * DAY, severity: 'warning'  },
  on_page_seo_agent:           { kind: 'schedule', intervalMin: 7 * DAY, severity: 'warning'  },
  technical_audit_agent:       { kind: 'schedule', intervalMin: 7 * DAY, severity: 'warning'  },
  eeat_agent:                  { kind: 'schedule', intervalMin: 7 * DAY, severity: 'warning'  },
  image_seo_agent:             { kind: 'schedule', intervalMin: 7 * DAY, severity: 'warning'  },
  local_seo_agent:             { kind: 'schedule', intervalMin: 7 * DAY, severity: 'warning'  },
  competitor_monitoring_agent: { kind: 'schedule', intervalMin: 7 * DAY, severity: 'warning'  },
};

const queueAgents = () => Object.entries(AGENT_MONITORS).filter(([, m]) => m.kind === 'queue');
const scheduleAgents = () => Object.entries(AGENT_MONITORS).filter(([, m]) => m.kind === 'schedule');

const STALE_GRACE_MULTIPLIER = 3; // e.g. content_draft_agent flagged only if silent for 45+ min, not right at 15
// Scheduled agents get a wider margin than queue agents: a weekly job that
// runs a few hours late (GitHub Actions queueing, a slow run) is normal and
// must not raise an alarm. Only a genuinely missed cycle should.
const HEARTBEAT_GRACE_MULTIPLIER = 2.5;

// NOT "no result produced recently" — that fires even when an agent is
// perfectly healthy but simply had no work to do (e.g. no new topic was
// added, so content_draft_agent has nothing to draft). The only real signal
// of a stuck/broken agent is a task that was actually handed to it and sat
// there unprocessed well past a normal run cycle — that means the runner
// picked it up (or should have) and never finished, which is a genuine fault.
async function checkStaleness(supabase) {
  const problems = [];
  for (const [agent, { intervalMin, severity }] of queueAgents()) {
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
        severity,
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
  for (const [agent, { severity }] of queueAgents()) {
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
        severity,
        detail: `The last ${CONSECUTIVE_FAILURE_THRESHOLD} tasks sent to ${agent} all failed, back to back — it looks stuck, not just having occasional bad luck.`,
      });
    }
  }
  return problems;
}

/**
 * Heartbeat check for the cron-driven agents. These never receive tasks, so
 * the staleness check above can't see them at all — which is exactly how ten
 * agents managed to sit dead for days without a single alert.
 *
 * An agent is only flagged once it has missed its whole interval plus the
 * grace margin. An agent that has genuinely never run is deliberately NOT
 * flagged: that's a setup step nobody has done yet, not a fault, and paging
 * someone about it every 10 minutes forever would just train them to ignore
 * the Manager.
 */
async function checkHeartbeats(supabase) {
  const problems = [];
  for (const [agent, { intervalMin, severity }] of scheduleAgents()) {
    const { data } = await supabase
      .from('agent_results')
      .select('created_at')
      .eq('agent_name', agent)
      .order('created_at', { ascending: false })
      .limit(1);
    if (!data || data.length === 0) continue; // never configured/run — not a fault

    const minsSince = (Date.now() - new Date(data[0].created_at).getTime()) / 60000;
    const allowed = intervalMin * HEARTBEAT_GRACE_MULTIPLIER;
    if (minsSince > allowed) {
      const hoursSince = Math.round(minsSince / 60);
      problems.push({
        type: 'heartbeat_missed',
        agent,
        severity,
        detail: `${agent} is scheduled roughly every ${Math.round(intervalMin / 60)}h but hasn't logged anything for ${hoursSince}h. Its scheduled workflow has most likely stopped firing.`,
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

async function sendAlertEmail(problems, paused) {
  const lead = paused
    ? '<p>The Manager Agent found a problem and has <strong>paused all automation</strong> until a human reviews it — nothing will run (no drafts, no approvals, no audits) until you resume it from the panel.</p>'
    : '<p>The Manager Agent found a problem with one or more <strong>analysis agents</strong>. Automation is <strong>still running normally</strong> — drafting and approvals are unaffected — but these need a look.</p>';
  const bodyHtml = `
    ${lead}
    <ul style="padding-left:18px;">
      ${problems.map((p) => `<li style="margin-bottom:8px;"><strong>${p.agent}</strong> — ${p.detail}</li>`).join('')}
    </ul>
    <p style="margin-top:16px;color:#6B7280;">${paused
      ? 'Review the Activity log and Agents section in the panel, fix what\'s wrong, then use "Resume automation" once you\'re confident it\'s safe.'
      : 'Check the Agents section in the panel and the GitHub Actions tab for the failing schedule.'}</p>
  `;
  try {
    await sendNotificationEmail({
      subject: paused
        ? `[URGENT] SEO Autopilot paused itself — ${problems.length} problem(s) found`
        : `[Heads-up] ${problems.length} SEO Autopilot agent(s) need attention`,
      html: renderEmailShell({
        badgeLabel: paused ? 'Automation Paused' : 'Agent Warning',
        badgeTone: paused ? 'alert' : 'warning',
        heading: paused ? 'Something needs your attention' : 'Some agents have gone quiet',
        bodyHtml,
      }),
    });
  } catch (err) {
    console.warn('Manager Agent alert email failed (non-fatal):', err.message);
  }
}

const WARNING_EMAIL_COOLDOWN_HOURS = 24;

/**
 * True only if this exact set of warning agents hasn't already been emailed
 * about within the cooldown. A newly-broken agent joining the set re-notifies
 * immediately rather than being hidden behind an existing cooldown.
 */
async function shouldSendWarning(supabase, warnings) {
  const signature = warnings.map((p) => p.agent).sort().join(',');
  const since = new Date(Date.now() - WARNING_EMAIL_COOLDOWN_HOURS * 3600000).toISOString();
  const { data } = await supabase
    .from('agent_results')
    .select('result, created_at')
    .eq('agent_name', 'manager_agent')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(200);

  for (const row of data || []) {
    const r = row.result || {};
    if (r.decision !== 'warning' || !r.emailed) continue;
    const prev = (r.problems || []).map((p) => p.agent).sort().join(',');
    if (prev === signature) return false;
  }
  return true;
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
    ...(await checkHeartbeats(supabase)),
    ...(await checkGithubActionsFailures()),
  ];

  // Anything without an explicit severity (currently the GitHub Actions
  // check) counts as critical — defaulting an unknown fault to "critical"
  // fails safe, defaulting it to "warning" would quietly swallow it.
  const critical = problems.filter((p) => p.severity !== 'warning');
  const warnings = problems.filter((p) => p.severity === 'warning');

  if (critical.length > 0) {
    const reason = critical.map((p) => `[${p.type}] ${p.agent}: ${p.detail}`).join(' | ');
    await pauseAutomation(reason, 'manager_agent');
    await sendAlertEmail(problems, true);
    await sendPushNotification({
      title: 'SEO Autopilot paused itself',
      body: `${critical.length} problem(s) found — ${critical[0]?.detail || ''}`,
    });
    await supabase.from('agent_results').insert({ agent_name: 'manager_agent', result: { decision: 'paused', problems } });
    await supabase.from('event_log').insert({ actor: 'manager_agent', action: 'paused_automation', details: { problems } });
    return { decision: 'paused', problems };
  }

  if (warnings.length > 0) {
    // Deliberately does NOT pause: a weekly advisory audit going quiet is
    // worth knowing about, but stopping the whole content pipeline over it
    // would cause more damage than the fault itself.
    //
    // The email is throttled because this check runs every 10 minutes and the
    // underlying condition (an agent that's been silent for days) doesn't
    // clear on its own — without this it would send the same warning ~144
    // times a day and get filtered as noise, which defeats the whole point.
    const notify = await shouldSendWarning(supabase, warnings);
    if (notify) await sendAlertEmail(warnings, false);
    await supabase.from('agent_results').insert({
      agent_name: 'manager_agent',
      result: { decision: 'warning', emailed: notify, problems: warnings },
    });
    await supabase.from('event_log').insert({ actor: 'manager_agent', action: 'agent_warning', details: { problems: warnings } });
    return { decision: 'warning', emailed: notify, problems: warnings };
  }

  await supabase.from('agent_results').insert({ agent_name: 'manager_agent', result: { decision: 'healthy' } });
  return { decision: 'healthy' };
}
