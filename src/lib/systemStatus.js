import { getSupabaseClient } from './supabaseClient.js';

/**
 * The kill-switch every runner checks before touching a single task. When
 * the Manager Agent detects something broken (an agent stuck, or an error
 * rate spike), it sets automation_paused = true here — and every runner
 * (content draft, policy guardrail, and any future one) refuses to process
 * anything until a human reviews and resumes from the panel. This is a real
 * hard stop, not just an alert.
 */
export async function isAutomationPaused() {
  const supabase = getSupabaseClient();
  const { data } = await supabase.from('system_status').select('automation_paused, pause_reason').eq('id', 1).single();
  return { paused: !!data?.automation_paused, reason: data?.pause_reason || null };
}

export async function pauseAutomation(reason, pausedBy = 'manager_agent') {
  const supabase = getSupabaseClient();
  await supabase.from('system_status').update({
    automation_paused: true,
    pause_reason: reason,
    paused_at: new Date().toISOString(),
    paused_by: pausedBy,
  }).eq('id', 1);
}
