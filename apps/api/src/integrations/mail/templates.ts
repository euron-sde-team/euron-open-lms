/**
 * Email templates shared by every domain: the layout, the button, and the account mails
 * (verify, reset, admin welcome, a generic notification). Domain mails live next to this
 * file (commerce-templates.ts, learning-templates.ts, ...) and reuse `layout` and
 * `button`. Each returns subject + text + HTML. Values interpolated into HTML are
 * escaped; links are built by the caller from APP_WEB_URL.
 *
 * `network` is the academy name (academyName() in services/settings.service.ts); it
 * falls back to PRODUCT_NAME.
 */
import type { MailMessage } from "./mailer";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

export function layout(network: string, title: string, bodyHtml: string): string {
  const product = escapeHtml(network);
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0">
<tr><td style="padding:24px 32px;border-bottom:1px solid #e2e8f0;font-weight:700;font-size:16px;color:#0E7C8C">${product}</td></tr>
<tr><td style="padding:28px 32px"><h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(title)}</h1>${bodyHtml}</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">You received this email because of activity on your ${product} account. Choose which emails you get under Account, Notifications.</td></tr>
</table></td></tr></table></body></html>`;
}

export function button(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="background:#0E7C8C;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block">${escapeHtml(label)}</a></p>`;
}

export function verifyEmail(network: string, to: string, name: string, link: string): MailMessage {
  const subject = `Confirm your email for ${network}`;
  return {
    to,
    subject,
    text: `Hi ${name},\n\nConfirm your email address to finish setting up your account:\n${link}\n\nThe link expires in 24 hours.`,
    html: layout(network, "Confirm your email", `<p>Hi ${escapeHtml(name)},</p><p>Confirm your email address to finish setting up your account.</p>${button(link, "Confirm email")}<p style="font-size:13px;color:#64748b">The link expires in 24 hours. If you did not sign up, ignore this email.</p>`),
  };
}

export function resetPassword(network: string, to: string, name: string, link: string): MailMessage {
  return {
    to,
    subject: `Reset your ${network} password`,
    text: `Hi ${name},\n\nReset your password here:\n${link}\n\nThe link expires in 1 hour. If you did not ask for this, ignore this email.`,
    html: layout(network, "Reset your password", `<p>Hi ${escapeHtml(name)},</p><p>Someone asked to reset the password on your account.</p>${button(link, "Choose a new password")}<p style="font-size:13px;color:#64748b">The link expires in 1 hour. If it was not you, ignore this email; your password is unchanged.</p>`),
  };
}

/** One notification, emailed (notify.email job). Receipts and refunds have their own templates. */
export function notificationEmail(network: string, to: string, name: string, title: string, body: string, href: string, cta: string): MailMessage {
  return {
    to,
    subject: title,
    text: `Hi ${name},

${body}

${href}`,
    html: layout(network, title, `<p>Hi ${escapeHtml(name)},</p><p>${escapeHtml(body)}</p>${button(href, cta)}`),
  };
}

export function adminWelcome(network: string, to: string, name: string, link: string): MailMessage {
  return {
    to,
    subject: `Set your ${network} administrator password`,
    text: `Hi ${name},\n\nAn administrator account was created for you. Choose your password here:\n${link}\n\nThe link expires in 1 hour.`,
    html: layout(network, "Set your administrator password", `<p>Hi ${escapeHtml(name)},</p><p>An administrator account was created for you.</p>${button(link, "Choose a password")}<p style="font-size:13px;color:#64748b">The link expires in 1 hour.</p>`),
  };
}
