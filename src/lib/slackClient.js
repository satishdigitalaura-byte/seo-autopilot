/**
 * Slack notifications via a simple Incoming Webhook (no Slack app
 * OAuth/interactivity setup needed). The Approve/Reject "buttons" are
 * Block Kit `url`-type buttons — clicking one just opens a URL in the
 * browser (a plain GET request straight to our Supabase Edge Function),
 * so there's no need for Slack's interactivity payload/signature handling.
 */
const FUNCTIONS_BASE = 'https://wrmgdcmyirnybybqlqll.supabase.co/functions/v1/approve-task';

function approveUrl(taskId, action) {
  const secret = process.env.APPROVE_SECRET;
  return `${FUNCTIONS_BASE}?id=${taskId}&action=${action}&secret=${secret}`;
}

export async function sendSlackApproval(task) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('SLACK_WEBHOOK_URL not set — skipping Slack notification.');
    return { skipped: true };
  }

  const p = task.payload || {};
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `📝 New draft ready: ${p.title || p.targetKeyword || 'Untitled'}` } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Site:*\n${task.siteDomain || ''}` },
        { type: 'mrkdwn', text: `*Keyword:*\n${p.targetKeyword || ''}` },
      ],
    },
    { type: 'section', text: { type: 'mrkdwn', text: p.excerpt || '' } },
    {
      type: 'actions',
      elements: [
        { type: 'button', text: { type: 'plain_text', text: '✅ Approve & Publish as Draft' }, style: 'primary', url: approveUrl(task.id, 'approve') },
        { type: 'button', text: { type: 'plain_text', text: '❌ Reject' }, style: 'danger', url: approveUrl(task.id, 'reject') },
      ],
    },
  ];

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks }),
  });
  if (!res.ok) {
    console.warn('Slack notification failed:', res.status, await res.text());
    return { sent: false };
  }
  return { sent: true };
}
