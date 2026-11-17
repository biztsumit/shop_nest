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

// Cash on delivery: confirmed when placed; the amount is paid to the courier
export const codOrderConfirmedMessage = (to: string, name: string, order: OrderForEmail, link: string): EmailMessage => ({
  to,
  subject: `Order ${order.number} confirmed (cash on delivery)`,
  html: layout(
    `Thank you, ${name}!`,
    `<p>Order <strong>${escape(order.number)}</strong> is confirmed and we're getting it ready. Please keep the amount below ready for the courier.</p>
     <table style="width:100%;border-collapse:collapse;font-size:14px">${itemRows(order)}
       <tr><td style="padding-top:12px;font-weight:600">To pay on delivery</td><td style="padding-top:12px;text-align:right;font-weight:600">${formatPrice(order.total)}</td></tr>
     </table>${button(link, 'View your order')}`,
  ),
  text: `Thank you, ${name}!\n\nOrder ${order.number} is confirmed and we're getting it ready. Please keep the amount below ready for the courier.\n\n${itemLines(order)}\nTo pay on delivery: ${formatPrice(order.total)}\n\nView your order: ${link}\n`,
});

export const orderShippedMessage = (to: string, name: string, order: OrderForEmail, link: string): EmailMessage => ({
  to,
  subject: `Order ${order.number} is on its way`,
  html: layout(`Good news, ${name}!`, `<p>Order <strong>${escape(order.number)}</strong> has shipped.</p>${button(link, 'Track your order')}`),
  text: `Good news, ${name}!\n\nOrder ${order.number} has shipped.\nTrack it: ${link}\n`,
});

export const orderDeliveredMessage = (to: string, name: string, order: OrderForEmail, link: string): EmailMessage => ({
  to,
  subject: `Order ${order.number} was delivered`,
  html: layout(`Hi ${name},`, `<p>Order <strong>${escape(order.number)}</strong> has been delivered. We hope you love it! You can review what you bought from your order page.</p>${button(link, 'View your order')}`),
  text: `Hi ${name},\n\nOrder ${order.number} has been delivered. We hope you love it! You can review what you bought from your order page:\n${link}\n`,
});

// Unpaid orders only (a paid order is refunded instead, which sends its own email)
export const orderCancelledMessage = (to: string, name: string, order: OrderForEmail, link: string): EmailMessage => ({
  to,
  subject: `Order ${order.number} was cancelled`,
  html: layout(`Hi ${name},`, `<p>Order <strong>${escape(order.number)}</strong> was cancelled. It was never paid, so no money was taken.</p>${button(link, 'Keep shopping')}`),
  text: `Hi ${name},\n\nOrder ${order.number} was cancelled. It was never paid, so no money was taken.\nKeep shopping: ${link}\n`,
});

// A cash-on-delivery parcel that came back to the shop (refused, or couldn't be delivered)
export const orderReturnedMessage = (to: string, name: string, order: OrderForEmail, link: string): EmailMessage => ({
  to,
  subject: `Order ${order.number} came back to us`,
  html: layout(
    `Hi ${name},`,
    `<p>The courier brought order <strong>${escape(order.number)}</strong> back to us, so we've closed it. It was cash on delivery and never paid, so you owe nothing.</p>
     <p>If that wasn't what you meant to happen, you're welcome to order again.</p>${button(link, 'Keep shopping')}`,
  ),
  text: `Hi ${name},\n\nThe courier brought order ${order.number} back to us, so we've closed it. It was cash on delivery and never paid, so you owe nothing.\nIf that wasn't what you meant to happen, you're welcome to order again: ${link}\n`,
});

// `reference`: set for a cash-on-delivery order, which the shop paid back itself (UPI, bank
// transfer). null = an online refund, on its way back through Razorpay.
export const orderRefundedMessage = (to: string, name: string, order: OrderForEmail, amount: number, reason: string, reference: string | null = null): EmailMessage => {
  const how = reference
    ? `We've sent it to you directly (reference: ${reference}).`
    : 'Refunds usually reach your account in 5–7 working days.';
  return {
    to,
    subject: `Refund for order ${order.number}`,
    html: layout(
      `Hi ${name},`,
      `<p>We've refunded <strong>${formatPrice(amount)}</strong> for order <strong>${escape(order.number)}</strong>. ${escape(reason)}</p>
       <p>${escape(how)}</p>`,
    ),
    text: `Hi ${name},\n\nWe've refunded ${formatPrice(amount)} for order ${order.number}. ${reason}\n${how.replace('–', '-')}\n`,
  };
};

// A back-in-stock alert. `item` is the product and its options: "Classic Tee (size M, black)"
export const backInStockMessage = (to: string, name: string, item: string, price: number, link: string): EmailMessage => ({
  to,
  subject: `Back in stock: ${item}`,
  html: layout(
    `Good news, ${name}!`,
    `<p><strong>${escape(item)}</strong> is back in stock, at ${formatPrice(price)}. Popular sizes can sell out again quickly.</p>${button(link, 'Get it now')}`,
  ),
  text: `Good news, ${name}!\n\n${item} is back in stock, at ${formatPrice(price)}. Popular sizes can sell out again quickly:\n${link}\n`,
});

// "You left something in your cart". A marketing-style email, so it always carries a one-click
// way to stop them (`unsubscribeLink` works without logging in).
export const cartReminderMessage = (
  to: string,
  name: string,
  lines: Array<{ name: string; quantity: number; lineTotal: number }>,
  subtotal: number,
  link: string,
  unsubscribeLink: string,
): EmailMessage => {
  const shown = lines.slice(0, 3);
  const more = lines.length - shown.length;
  const list = shown.map((l) => `${l.quantity} × ${l.name}: ${formatPrice(l.lineTotal)}`);
  if (more > 0) list.push(`and ${more} more`);
  return {
    to,
    subject: 'You left something in your cart',
    html: layout(
      `Still thinking it over, ${name}?`,
      `<p>Your cart is saved and waiting:</p>
       <ul>${list.map((item) => `<li>${escape(item)}</li>`).join('')}</ul>
       <p>Subtotal: <strong>${formatPrice(subtotal)}</strong>. Prices and stock can change, so don't wait too long.</p>
       ${button(link, 'Finish checking out')}
       <p style="color:#5b5b6b;font-size:13px">Don't want these reminders? <a href="${escape(unsubscribeLink)}">Turn them off</a>.</p>`,
    ),
    text: `Still thinking it over, ${name}?\n\nYour cart is saved and waiting:\n${list.map((item) => `- ${item}`).join('\n')}\n\nSubtotal: ${formatPrice(subtotal)}\nFinish checking out: ${link}\n\nDon't want these reminders? Turn them off: ${unsubscribeLink}\n`,
  };
};
