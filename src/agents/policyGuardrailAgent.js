import { getSupabaseClient } from '../lib/supabaseClient.js';
import { runRuleChecks } from '../rules/guidelinesRuleset.js';
import { generateText } from '../lib/llmClient.js';
import { sendNotificationEmail } from '../lib/emailClient.js';
import { renderEmailShell, renderApprovalButtons } from '../lib/emailTemplate.js';
import { sendSlackApproval } from '../lib/slackClient.js';
import { approveUrl } from '../lib/approvalLinks.js';

async function runQualitativeCheck(payload) {
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

  const text = (await generateText({ prompt, maxTokens: 300 })) || '{}';
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

  const { data: site } = await supabase.from('sites').select('*').eq('id', task.site_id).single();

  const { checks, hardFailures, escalations, forcesHumanReview } = runRuleChecks(task.payload, site);

  let qualitative = null;
  if (hardFailures.length === 0 && task.payload.content) {
    qualitative = await runQualitativeCheck(task.payload);
  }

  const rejected = hardFailures.length > 0 || qualitative?.uniquePov === false;
  const resultSummary = {
    ruleChecks: checks,
    hardFailures: hardFailures.map((c) => c.id),
    escalations: escalations.map((c) => c.id),
    forcesHumanReview,
    qualitative,
    decision: rejected ? 'rejected' : 'passed_to_human_review',
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

    // Bounce it back to whoever drafted it so they can revise, instead of silently dying.
    await supabase.from('agent_tasks').insert({
      site_id: task.site_id,
      source_agent: 'policy_guardrail_agent',
      target_agent: task.source_agent,
      task_type: 'revise_rejected_draft',
      payload: { originalTaskId: task.id, reasons: resultSummary },
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
