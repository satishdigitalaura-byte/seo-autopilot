/**
 * Branded HTML email shell + simple chart helpers for SEO Autopilot
 * notifications. Uses table-based layout (not flexbox/grid) because Outlook
 * and several mobile mail clients don't support modern CSS layout — tables
 * are the one thing that renders consistently everywhere.
 *
 * Brand colors match thedigitalaura.com's actual site palette, so emails
 * feel like they came from the same brand, not a generic system alert.
 */
const COLORS = {
  dark: '#0A1628',
  blue: '#1A6FE8',
  orange: '#FF6B2B',
  green: '#22C55E',
  red: '#EF4444',
  gray: '#6B7280',
  bg: '#F8FAFF',
  border: '#E5E7EB',
};

const BADGE_COLORS = {
  info: COLORS.blue,
  good: COLORS.green,
  warning: COLORS.orange,
  alert: COLORS.red,
};

export function renderEmailShell({ badgeLabel, badgeTone = 'info', heading, bodyHtml, ctaLabel, ctaUrl }) {
  const badgeColor = BADGE_COLORS[badgeTone] || COLORS.blue;

  return `
<div style="background:${COLORS.bg};padding:32px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid ${COLORS.border};">

    <tr>
      <td style="background:${COLORS.dark};padding:20px 28px;">
        <span style="color:#FFFFFF;font-size:18px;font-weight:700;letter-spacing:-0.02em;">Digital Aura</span>
        <span style="color:${COLORS.gray};font-size:13px;margin-left:8px;">SEO Autopilot</span>
      </td>
    </tr>

    <tr>
      <td style="padding:0;">
        <div style="background:${badgeColor};padding:14px 28px;">
          <span style="color:#FFFFFF;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">${badgeLabel}</span>
        </div>
      </td>
    </tr>

    <tr>
      <td style="padding:28px;">
        <h1 style="margin:0 0 16px;color:${COLORS.dark};font-size:22px;font-weight:700;line-height:1.3;">${heading}</h1>
        <div style="color:#374151;font-size:14px;line-height:1.6;">
          ${bodyHtml}
        </div>
        ${ctaUrl ? `
        <div style="margin-top:24px;">
          <a href="${ctaUrl}" style="display:inline-block;background:${COLORS.orange};color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:700;padding:12px 24px;border-radius:8px;">${ctaLabel || 'View'}</a>
        </div>` : ''}
      </td>
    </tr>

    <tr>
      <td style="padding:16px 28px;background:${COLORS.bg};border-top:1px solid ${COLORS.border};">
        <span style="color:${COLORS.gray};font-size:12px;">Sent automatically by SEO Autopilot &mdash; nothing publishes without human approval.</span>
      </td>
    </tr>

  </table>
</div>`;
}

/**
 * Approve/Reject buttons for the draft-ready email — plain <a href> links to
 * the same Supabase Edge Function the Slack buttons use (table layout for
 * Outlook, real anchor tags so it works with images/JS both off).
 */
export function renderApprovalButtons({ approveHref, rejectHref }) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;">
      <tr>
        <td style="padding-right:12px;">
          <a href="${approveHref}" style="display:inline-block;background:${COLORS.green};color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:700;padding:12px 22px;border-radius:8px;">✅ Approve &amp; Publish as Draft</a>
        </td>
        <td>
          <a href="${rejectHref}" style="display:inline-block;background:${COLORS.red};color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:700;padding:12px 22px;border-radius:8px;">❌ Reject</a>
        </td>
      </tr>
    </table>
    <p style="margin-top:10px;font-size:11px;color:${COLORS.gray};">Clicking Approve publishes it to the site as a DRAFT only — you'll still do a final visual check before it goes live.</p>`;
}

/** Simple, email-safe horizontal bar comparison (before vs. after), no external chart image needed. */
export function renderBeforeAfterBars(rows, { beforeLabel = 'Before', afterLabel = 'Now' } = {}) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.before, r.after]));
  const bar = (value, color) => {
    const pct = Math.max(4, Math.round((value / max) * 100));
    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:2px 0;">
        <tr>
          <td width="${pct}%" style="background:${color};height:10px;border-radius:4px;line-height:10px;font-size:0;">&nbsp;</td>
          <td style="width:${100 - pct}%;"></td>
          <td style="white-space:nowrap;padding-left:8px;font-size:12px;color:${COLORS.gray};">${value}</td>
        </tr>
      </table>`;
  };

  return rows.map((r) => `
    <div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid ${COLORS.border};">
      <div style="font-size:13px;font-weight:600;color:${COLORS.dark};margin-bottom:6px;word-break:break-all;">${r.label}</div>
      <div style="font-size:11px;color:${COLORS.gray};margin-bottom:2px;">${beforeLabel}</div>
      ${bar(r.before, COLORS.gray)}
      <div style="font-size:11px;color:${COLORS.gray};margin:6px 0 2px;">${afterLabel}</div>
      ${bar(r.after, r.after < r.before ? COLORS.red : COLORS.green)}
    </div>`).join('');
}
