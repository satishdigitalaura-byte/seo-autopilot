import nodemailer from 'nodemailer';

/**
 * Free email notifications via Gmail SMTP (500 emails/day free limit — far
 * more than this system needs). Requires a Gmail "App Password" (not the
 * normal account password) set as GMAIL_USER / GMAIL_APP_PASSWORD.
 *
 * Used for two things right now:
 *  1. "A new draft is ready for your review" — sent when the Policy Guardrail
 *     Agent approves a draft into human_review_queue.
 *  2. "GSC/GA4 Watcher summary" — sent after every watcher run, so the SEO
 *     team gets a status even on days nothing is wrong (Guidelines §8 spirit:
 *     visibility matters as much as alerting).
 */
let transporter;

function getTransporter() {
  if (transporter) return transporter;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD missing — set them in .env or as GitHub Actions secrets.');
  }
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
  return transporter;
}

function getRecipients() {
  const raw = process.env.NOTIFY_EMAILS || '';
  return raw.split(',').map((e) => e.trim()).filter(Boolean);
}

export async function sendNotificationEmail({ subject, html }) {
  const recipients = getRecipients();
  if (recipients.length === 0) {
    console.warn('NOTIFY_EMAILS not set — skipping email notification.');
    return { skipped: true };
  }
  const t = getTransporter();
  await t.sendMail({
    from: `"SEO Autopilot" <${process.env.GMAIL_USER}>`,
    to: recipients.join(', '),
    subject,
    html,
  });
  return { sent: true, recipients };
}
