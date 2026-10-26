import { formatPrice } from '@shop/shared';
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

// ---------- Orders ----------

type OrderForEmail = {
  number: string;
  total: number;
  items: Array<{ productName: string; options: Record<string, string>; quantity: number; lineTotal: number }>;
};

const itemRows = (order: OrderForEmail): string =>
  order.items
    .map((i) => {
      const options = Object.values(i.options).join(' / ');
      return `<tr><td style="padding:6px 0">${escape(i.productName)}${options ? ` <span style="color:#5b5b6b">(${escape(options)})</span>` : ''} × ${i.quantity}</td><td style="text-align:right">${formatPrice(i.lineTotal)}</td></tr>`;
    })
    .join('');

const itemLines = (order: OrderForEmail): string =>
  order.items.map((i) => `- ${i.productName} × ${i.quantity}: ${formatPrice(i.lineTotal)}`).join('\n');

export const orderConfirmedMessage = (to: string, name: string, order: OrderForEmail, link: string): EmailMessage => ({
  to,
  subject: `Order ${order.number} confirmed`,
  html: layout(
    `Thank you, ${name}!`,
    `<p>We've received your payment for order <strong>${escape(order.number)}</strong> and we're getting it ready.</p>
     <table style="width:100%;border-collapse:collapse;font-size:14px">${itemRows(order)}
       <tr><td style="padding-top:12px;font-weight:600">Total paid</td><td style="padding-top:12px;text-align:right;font-weight:600">${formatPrice(order.total)}</td></tr>
     </table>${button(link, 'View your order')}`,
  ),
  text: `Thank you, ${name}!\n\nWe've received your payment for order ${order.number}.\n\n${itemLines(order)}\nTotal paid: ${formatPrice(order.total)}\n\nView your order: ${link}\n`,
});

export const orderShippedMessage = (to: string, name: string, order: OrderForEmail, link: string): EmailMessage => ({
  to,
  subject: `Order ${order.number} is on its way`,
  html: layout(`Good news, ${name}!`, `<p>Order <strong>${escape(order.number)}</strong> has shipped.</p>${button(link, 'Track your order')}`),
  text: `Good news, ${name}!\n\nOrder ${order.number} has shipped.\nTrack it: ${link}\n`,
});

export const orderRefundedMessage = (to: string, name: string, order: OrderForEmail, amount: number, reason: string): EmailMessage => ({
  to,
  subject: `Refund for order ${order.number}`,
  html: layout(
    `Hi ${name},`,
    `<p>We've refunded <strong>${formatPrice(amount)}</strong> for order <strong>${escape(order.number)}</strong>. ${escape(reason)}</p>
     <p>Refunds usually reach your account in 5–7 working days.</p>`,
  ),
  text: `Hi ${name},\n\nWe've refunded ${formatPrice(amount)} for order ${order.number}. ${reason}\nRefunds usually reach your account in 5-7 working days.\n`,
});
