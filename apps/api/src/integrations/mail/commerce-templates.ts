/** Receipts and refund confirmations. Always sent (not an email preference): they are records of money moving. */
import { formatMinor } from "../../domain/pricing";
import type { MailMessage } from "./mailer";
import { button, escapeHtml, layout } from "./templates";

export interface ReceiptLine {
  title: string;
  totalMinor: number;
}

const amount = (n: number, currency: string) => `${formatMinor(n, currency)} ${currency}`;

export function receiptEmail(network: string, to: string, name: string, r: { orderNumber: string; currency: string; lines: ReceiptLine[]; discountMinor: number; taxMinor: number; taxLabel: string | null; totalMinor: number; renewal: boolean; link: string }): MailMessage {
  const title = r.renewal ? "Your subscription renewed" : "Thanks for your purchase";
  const rows = r.lines.map((l) => `<tr><td style="padding:4px 0">${escapeHtml(l.title)}</td><td align="right">${escapeHtml(amount(l.totalMinor, r.currency))}</td></tr>`).join("");
  const extra = [r.discountMinor ? `<tr><td style="padding:4px 0;color:#64748b">Discount</td><td align="right" style="color:#64748b">-${escapeHtml(amount(r.discountMinor, r.currency))}</td></tr>` : "", r.taxMinor && r.taxLabel ? `<tr><td style="padding:4px 0;color:#64748b">${escapeHtml(r.taxLabel)}</td><td align="right" style="color:#64748b">${escapeHtml(amount(r.taxMinor, r.currency))}</td></tr>` : ""].join("");
  return {
    to,
    subject: `${network} receipt ${r.orderNumber}`,
    text: `Hi ${name},\n\n${title}. Order ${r.orderNumber}\n\n${r.lines.map((l) => `${l.title}: ${amount(l.totalMinor, r.currency)}`).join("\n")}\nTotal: ${amount(r.totalMinor, r.currency)}\n\nYour invoice: ${r.link}`,
    html: layout(network, title, `<p>Hi ${escapeHtml(name)},</p><p>Order <b>${escapeHtml(r.orderNumber)}</b></p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">${rows}${extra}<tr><td style="padding:8px 0;font-weight:700;border-top:1px solid #e2e8f0">Total</td><td align="right" style="font-weight:700;border-top:1px solid #e2e8f0">${escapeHtml(amount(r.totalMinor, r.currency))}</td></tr></table>${button(r.link, "View order and invoice")}`),
  };
}

export function refundEmail(network: string, to: string, name: string, r: { orderNumber: string; amountMinor: number; currency: string; full: boolean; link: string }): MailMessage {
  const title = r.full ? "Your order was refunded" : "Part of your order was refunded";
  const body = `We refunded ${amount(r.amountMinor, r.currency)} for order ${r.orderNumber}. It usually reaches your account within 5 to 10 business days, depending on your bank.`;
  return {
    to,
    subject: `${network}: refund for ${r.orderNumber}`,
    text: `Hi ${name},\n\n${body}\n\n${r.link}`,
    html: layout(network, title, `<p>Hi ${escapeHtml(name)},</p><p>${escapeHtml(body)}</p>${button(r.link, "View order")}`),
  };
}
