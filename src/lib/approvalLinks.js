/**
 * Shared Approve/Reject link builder — both Slack (Block Kit url-buttons) and
 * email (plain <a href> buttons) point at the same Supabase Edge Function.
 * Auth is the `secret` query param (checked against APPROVE_SECRET on the
 * function side), not a Supabase JWT, since both Slack buttons and email
 * links are just plain GET requests with no way to carry a session token.
 */
const FUNCTIONS_BASE = 'https://wrmgdcmyirnybybqlqll.supabase.co/functions/v1/approve-task';

export function approveUrl(taskId, action) {
  const secret = process.env.APPROVE_SECRET;
  return `${FUNCTIONS_BASE}?id=${taskId}&action=${action}&secret=${secret}`;
}
