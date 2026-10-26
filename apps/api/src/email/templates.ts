import type { EmailMessage } from './email.service.js';

// The emails, as plain functions: data in, subject + HTML + plain text out.
// Every email has a plain-text version too: some people (and spam filters) prefer it.

// Text from users (their name) goes into HTML: escape it, so a name like "<script>" is shown,
// not run
const escape = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const layout = (title: string, body: string): string => `<!doctype html>
<html><body style="margin:0;background:#f7f7fa;font-family:system-ui,sans-serif;color:#16161d">
  <div style="max-width:520px;margin:32px auto;background:#fff;border-radius:16px;padding:32px">
    <h1 style="font-size:20px;margin:0 0 16px">${escape(title)}</h1>
    ${body}
    <p style="color:#5b5b6b;font-size:13px;margin-top:32px">If you didn't expect this email, you can ignore it.</p>
  </div>
</body></html>`;

const button = (href: string, label: string): string =>
  `<p><a href="${escape(href)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">${escape(label)}</a></p>
   <p style="color:#5b5b6b;font-size:13px">Or copy this link: ${escape(href)}</p>`;

export const verifyEmailMessage = (to: string, name: string, link: string): EmailMessage => ({
  to,
  subject: 'Confirm your email address',
  html: layout(`Welcome, ${name}!`, `<p>Please confirm this is your email address. The link works for 24 hours.</p>${button(link, 'Confirm my email')}`),
  text: `Welcome, ${name}!\n\nPlease confirm your email address (the link works for 24 hours):\n${link}\n`,
});

export const resetPasswordMessage = (to: string, name: string, link: string): EmailMessage => ({
  to,
  subject: 'Reset your password',
  html: layout(`Hi ${name},`, `<p>Someone (hopefully you) asked to reset your password. The link works for 1 hour, once.</p>${button(link, 'Choose a new password')}`),
  text: `Hi ${name},\n\nSomeone (hopefully you) asked to reset your password. This link works for 1 hour, once:\n${link}\n`,
});

export const passwordChangedMessage = (to: string, name: string): EmailMessage => ({
  to,
  subject: 'Your password was changed',
  html: layout(`Hi ${name},`, '<p>Your password was just changed, and every device was logged out. If this wasn\'t you, reset your password now and contact us.</p>'),
  text: `Hi ${name},\n\nYour password was just changed, and every device was logged out. If this wasn't you, reset your password now and contact us.\n`,
});
