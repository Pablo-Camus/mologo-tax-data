// mailer.mjs — sends a short notification email via nodemailer, using the
// same SMTP convention as the app's composer/netlify/functions/_shared/mail.js
// (secure connection on 465). Degrades gracefully: if any SMTP secret is
// missing, or sending fails, it logs and returns without throwing — a
// missing/broken mailer must never fail the monitor job.

import nodemailer from 'nodemailer';

function readSmtpConfig(env = process.env) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, ADMIN_EMAIL } = env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD || !ADMIN_EMAIL) {
    return null;
  }
  return { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, ADMIN_EMAIL };
}

/**
 * Sends a plain-text notification to ADMIN_EMAIL. Never throws.
 * @param {{ subject: string, text: string }} message
 * @param {object} [env] - injectable for tests; defaults to process.env
 */
export async function sendNotification({ subject, text }, env = process.env) {
  const cfg = readSmtpConfig(env);
  if (!cfg) {
    console.log('[mailer] SMTP secrets not configured — skipping email. Would have sent:', subject);
    return { sent: false, reason: 'missing SMTP secrets' };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: cfg.SMTP_HOST,
      port: Number(cfg.SMTP_PORT),
      secure: Number(cfg.SMTP_PORT) === 465,
      auth: { user: cfg.SMTP_USER, pass: cfg.SMTP_PASSWORD },
    });
    await transporter.sendMail({
      from: cfg.SMTP_USER,
      to: cfg.ADMIN_EMAIL,
      subject,
      text,
    });
    console.log('[mailer] notification sent:', subject);
    return { sent: true };
  } catch (e) {
    console.error('[mailer] failed to send notification (continuing anyway):', e.message || e);
    return { sent: false, reason: e.message || String(e) };
  }
}
