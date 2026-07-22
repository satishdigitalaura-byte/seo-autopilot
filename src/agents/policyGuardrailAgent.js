import { getSupabaseClient } from '../lib/supabaseClient.js';
import { runRuleChecks } from '../rules/guidelinesRuleset.js';
import { generateText } from '../lib/llmClient.js';
import { sendNotificationEmail } from '../lib/emailClient.js';
import { renderEmailShell, renderApprovalButtons } from '../lib/emailTemplate.js';
import { sendSlackApproval } from '../lib/slackClient.js';
import { approveUrl } from '../lib/approvalLinks.js';
import { getAgentConfig } from '../lib/agentSettings.js';

async function runQualitativeCheck(payload, agentConfig) {
  const prompt = `You are a content policy checker for an SEO agency, applying Google's own published guidance (not invented AI-SEO tactics).

Evaluate this content against three tests only:
1. Genuine unique POV / non-commodity angle — would this page tell a reader something they can't get from ten other pages on the same topic? (Google's own example of the difference: "7 Tips for First-Time Homebuyers" = commodity/low-value; "Why We Waived the Inspection & Saved Money: A Look Inside the Sewer Line" = non-commodity/high-value.)
2. E-E-A-T signals present — is there a named author, citations/sources, or a freshness signal (a date, an updated fact)?
3. No filler — does it open with generic padding (e.g. "In today's digital landscape...") before the substantive content? Google's Quality Rater Guidelines now explicitly penalize this.

Content to evaluate:
---
${String(payload.content || '').slice(0, 6000)}
---

Reply with ONLY a JSON object, no other text: {"uniquePov": boolean, "eeatSignalsPresent": boolean, "noFiller": boolean, "reasoning": "one sentence"}`;

  const text = (await generateText({
    prompt,
    maxTokens: agentConfig.maxTokens || 300,
    model: agentConfig.modelName || undefined,
    provider: agentConfig.modelProvider,
  })) || '{}';
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    return { uniquePov: null, eeatSignalsPresent: null, reasoning: 'Could not parse model response', raw: text };
  }
}

/**
 * Processes one agent_tasks row targeted at 'policy_guardrail_agent'.
 * Never auto-publishes anything — only rejects (hard gate) or forwards to
 * human_review_queue. Human approval remains mandatory for all content per
 * the master architecture doc §4.
 */
export async function processGuardrailTask(task) {
  const supabase = getSupabaseClient();

  // Defensive guard: this agent only knows how to review an actual draft
  // (payload.content). Any other task type that ends up targeted here (e.g.
  // a stray 'need_original_element' task) has nothing to review — running
  // rule checks against it always hard-fails and used to trigger a
  // 'revise_rejected_draft' bounce back to content_draft_agent, which had
  // nothing to revise either. That created an infinite ping-pong loop
  // between the two agents. Fail it once, terminally, instead.
  if (!task.payload?.content) {
    await supabase.from('agent_tasks').update({
      status: 'failed',
      error_message: `Not a reviewable draft (task_type: ${task.task_type}) — no content in payload.`,
      completed_at: new Date().toISOString(),
    }).eq('id', task.id);
    return { decision: 'skipped_not_a_draft' };
  }

  const { data: site } = await supabase.from('sites').select('*').eq('id', task.site_id).single();
  const agentConfig = await getAgentConfig('policy_guardrail_agent');

  const { checks, hardFailures, escalations, forcesHumanReview } = runRuleChecks(task.payload, site);

  let qualitative = null;
  if (hardFailures.length === 0 && task.payload.content) {
    qualitative = await runQualitativeCheck(task.payload, agentConfig);
  }

  // The qualitative check is a subjective AI opinion, not a mechanical rule —
  // it can keep judging successive rewrites of the same topic as "still too
  // generic" indefinitely, bouncing the draft back and forth forever with no
  // human ever seeing it. After a few genuine revision attempts (tracked via
  // payload.revisionCount, set by content_draft_agent), let a human make the
  // final call instead of looping the bot pair endlessly — the hard rule
  // checks (the actual policy gates) still have to pass either way.
  const revisionCount = task.payload.revisionCount || 0;
  const qualitativeRejects = qualitative?.uniquePov === false && revisionCount < 3;
  // content_length is the one hard check that's a model-effort problem, not a
  // policy/safety problem (unlike hidden_text, sneaky_redirect, etc, which
  // must always block). If it's STILL short after several genuine attempts,
  // surface it to a human rather than looping forever between the two agents.
  const onlyContentLengthFails = hardFailures.length > 0 && hardFailures.every((c) => c.id === 'content_length');
  const hardRejects = hardFailures.length > 0 && !(onlyContentLengthFails && revisionCount >= 3);
  const rejected = hardRejects || qualitativeRejects;
  const resultSummary = {
    ruleChecks: checks,
    hardFailures: hardFailures.map((c) => c.id),
    escalations: escalations.map((c) => c.id),
    forcesHumanReview,
    qualitative,
    decision: rejected ? 'rejected' : 'passed_to_human_review',
    forcedToHumanAfterRevisions: !rejected && (qualitative?.uniquePov === false || onlyContentLengthFails),
  };

  await supabase.from('agent_results').insert({
    task_id: task.id,
    site_id: task.site_id,
    agent_name: 'policy_guardrail_agent',
    result: resultSummary,
  });

  await supabase.from('event_log').insert({
    site_id: task.site_id,
    actor: 'policy_guardrail_agent',
    action: rejected ? 'rejected_content' : 'approved_for_human_review',
    details: { task_id: task.id, hardFailures: resultSummary.hardFailures },
  });

  if (rejected) {
    await supabase.from('agent_tasks').update({
      status: 'rejected',
      error_message: [...resultSummary.hardFailures, qualitative?.reasoning].filter(Boolean).join('; '),
      completed_at: new Date().toISOString(),
    }).eq('id', task.id);

    // Bounce it back to whoever drafted it so they can revise — carrying
    // forward the same fields content_draft_agent needs to actually redraft
    // (topic/originalElement/etc), not just the rejection reasons. Without
    // these, the revise task arrived empty and failed the §6 gate again,
    // which was the other half of the ping-pong loop.
    await supabase.from('agent_tasks').insert({
      site_id: task.site_id,
      source_agent: 'policy_guardrail_agent',
      target_agent: task.source_agent,
      task_type: 'revise_rejected_draft',
      payload: {
        originalTaskId: task.id,
        reasons: resultSummary,
        topic: task.payload.targetKeyword || task.payload.topic,
        targetKeyword: task.payload.targetKeyword,
        blogType: task.payload.blogType,
        originalElement: task.payload.originalElement,
        triggerReason: task.payload.triggerReason,
        authorName: task.payload.authorName,
        authorCredentials: task.payload.authorCredentials,
        revisionCount,
      },
      status: 'pending',
    });
    return resultSummary;
  }

  await supabase.from('agent_tasks').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
  }).eq('id', task.id);

  const { data: reviewTaskRows } = await supabase.from('agent_tasks').insert({
    site_id: task.site_id,
    source_agent: 'policy_guardrail_agent',
    target_agent: 'human_review_queue',
    task_type: 'approve_draft',
    payload: { ...task.payload, guardrailResult: resultSummary },
    status: 'awaiting_approval',
  }).select();
  const reviewTask = reviewTaskRows?.[0];

  try {
    const bodyHtml = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
        <tr><td style="padding:4px 0;color:#6B7280;width:120px;">Site</td><td style="padding:4px 0;font-weight:600;">${site?.domain || 'unknown'}</td></tr>
        <tr><td style="padding:4px 0;color:#6B7280;">Slug</td><td style="padding:4px 0;">${task.payload.slug || '(no slug)'}</td></tr>
        <tr><td style="padding:4px 0;color:#6B7280;">Keyword</td><td style="padding:4px 0;">${task.payload.targetKeyword || ''}</td></tr>
        <tr><td style="padding:4px 0;color:#6B7280;vertical-align:top;">Why written</td><td style="padding:4px 0;">${task.payload.triggerReason || ''}</td></tr>
      </table>
      <p style="margin-top:16px;padding:12px 16px;background:#F8FAFF;border-radius:8px;color:#374151;">${task.payload.excerpt || ''}</p>
      ${resultSummary.forcedToHumanAfterRevisions ? `<p style="margin-top:16px;padding:12px 16px;background:#FFF7ED;border-radius:8px;color:#9A3412;"><strong>Note:</strong> this draft was rejected ${revisionCount} time(s) — ${onlyContentLengthFails ? 'it kept coming in shorter than the required word count' : 'the AI quality-checker judged it too generic'} — and still isn't fully satisfied. It's being sent to you directly instead of looping forever. Please read it a bit more carefully than usual before approving.</p>` : ''}
      <p style="margin-top:16px;font-size:13px;color:#6B7280;">This is not live yet &mdash; nothing publishes until a human approves it.</p>
      ${reviewTask ? renderApprovalButtons({ approveHref: approveUrl(reviewTask.id, 'approve'), rejectHref: approveUrl(reviewTask.id, 'reject') }) : ''}
    `;

    await sendNotificationEmail({
      subject: `[Review needed] ${task.payload.title || task.payload.targetKeyword || 'New draft'} — ${site?.domain || ''}`,
      html: renderEmailShell({
        badgeLabel: 'Review Needed',
        badgeTone: 'info',
        heading: task.payload.title || '(no title)',
        bodyHtml,
      }),
    });
  } catch (err) {
    console.warn('Email notification failed (non-fatal):', err.message);
  }

  try {
    if (reviewTask) {
      await sendSlackApproval({ ...reviewTask, siteDomain: site?.domain });
    }
  } catch (err) {
    console.warn('Slack notification failed (non-fatal):', err.message);
  }

  return resultSummary;
}
