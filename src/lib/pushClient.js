import webpush from 'web-push';
import { getSupabaseClient } from './supabaseClient.js';

/**
 * Desktop push notifications — mirrors what still emails today (critical
 * alerts only: automation auto-paused, real traffic drops). Reaches the
 * admin's desktop even with the panel closed, via a browser-registered
 * service worker (docs/sw.js) and subscription saved through panel-api's
 * save_push_subscription action.
 */
let configured = false;
function ensureConfigured() {
  if (configured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

/** Never throws — a push failure must not block the agent that's alerting. */
export async function sendPushNotification({ title, body, url }) {
  if (!ensureConfigured()) {
    console.warn('Push notification skipped — VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not configured.');
    return;
  }
  const supabase = getSupabaseClient();
  const { data: subs } = await supabase.from('push_subscriptions').select('id, endpoint, keys');
  if (!subs || !subs.length) return;

  const payload = JSON.stringify({ title, body, url: url || '/' });
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
    } catch (err) {
      // 404/410 = the browser/user unsubscribed or the subscription expired —
      // clean it up so future sends don't keep failing on a dead endpoint.
      if (err.statusCode === 404 || err.statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
      } else {
        console.warn('Push send failed (non-fatal):', err.message);
      }
    }
  }));
}
