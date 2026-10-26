/**
 * Invoices and credit notes: issued inside the transaction that makes them true (an
 * order turning PAID, a refund settling) with a gap-free number, then rendered to a PDF
 * by the invoices.render job after commit and stored privately at
 * invoices/<yyyy>/<number>.pdf. The PDF is only ever handed out as a short-lived signed
 * URL to the invoice's owner; anyone else gets 404, as if it did not exist.
 *
 * The seller block, the buyer block and the lines are frozen on the invoice row when it
 * is issued: editing the academy's legal details later never rewrites an old invoice.
 */
import type { LmsSettings } from "@open-lms/types";
import PDFDocument from "pdfkit";
import { requireArea, type Actor } from "../core/context";
import { conflict, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { db, type Executor } from "../db/kysely";
import { divRound, formatMinor } from "../domain/pricing";
import { storage } from "../integrations/storage";
import { invoiceRepo, type InvoiceRow } from "../repositories/invoice.repository";
import type { OrderItemRow, OrderRow } from "../repositories/order.repository";
import type { RefundRow } from "../repositories/refund.repository";
import { getSettings } from "./settings.service";

export interface InvoiceLine {
  title: string;
  unitMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export interface FrozenTax {
  mode: "EXCLUSIVE" | "INCLUSIVE";
  rateBps: number;
  label: string | null;
  country?: string | null;
}

/** The tax terms frozen on an order at checkout. */
export function orderTax(order: Pick<OrderRow, "tax">): FrozenTax {
  const t = (order.tax ?? {}) as Partial<FrozenTax>;
  return { mode: t.mode === "INCLUSIVE" ? "INCLUSIVE" : "EXCLUSIVE", rateBps: Number(t.rateBps ?? 0), label: t.label ?? null, country: t.country ?? null };
}

function seriesFor(kind: "INVOICE" | "CREDIT_NOTE", at: Date): string {
  return `${kind === "INVOICE" ? "INV" : "CN"}-${at.getUTCFullYear()}`;
}

function sellerOf(settings: LmsSettings) {
  return { legalName: settings.seller.legalName || settings.academyName, address: settings.seller.address, taxId: settings.seller.taxId, email: settings.seller.email };
}

async function buyerOf(order: OrderRow, exec: Executor) {
  const user = await exec.selectFrom("users").select(["email", "display_name"]).where("id", "=", order.user_id).executeTakeFirstOrThrow();
  const billing = (order.billing ?? {}) as Record<string, string | undefined>;
  return { name: billing.name || user.display_name, email: user.email, country: billing.country ?? null, region: billing.region ?? null, taxId: billing.taxId ?? null, addressLine: billing.addressLine ?? null, postalCode: billing.postalCode ?? null };
}

/** Issue the invoice of a paid order (once: invoices_order_key makes a second insert fail). */
export async function issueInvoice(order: OrderRow, items: OrderItemRow[], trx: Executor, opts: { subscriptionId?: string | null } = {}): Promise<{ id: string; number: string }> {
  const existing = await trx.selectFrom("invoices").select(["id", "number"]).where("order_id", "=", order.id).where("kind", "=", "INVOICE").executeTakeFirst();
  if (existing) return existing;
  const settings = await getSettings(trx);
  const now = new Date();
  const number = await invoiceRepo.nextNumber(seriesFor("INVOICE", now), trx);
  const id = newId();
  const lines: InvoiceLine[] = items.map((i) => ({ title: i.title, unitMinor: i.unit_minor, discountMinor: i.discount_minor, taxMinor: i.tax_minor, totalMinor: i.total_minor }));
  await invoiceRepo.insert(
    {
      id,
      number,
      kind: "INVOICE",
      order_id: order.id,
      refund_id: null,
      subscription_id: opts.subscriptionId ?? null,
      user_id: order.user_id,
      currency: order.currency,
      subtotal_minor: order.subtotal_minor,
      discount_minor: order.discount_minor,
      tax_minor: order.tax_minor,
      total_minor: order.total_minor,
      seller: sellerOf(settings),
      buyer: await buyerOf(order, trx),
      lines: lines as never,
      tax: orderTax(order) as never,
    },
    trx,
  );
  return { id, number };
}

/**
 * A credit note for a settled refund. Tax is reversed in proportion to the share of the
 * order being refunded, so a full refund reverses exactly the tax that was charged.
 */
export async function issueCreditNote(order: OrderRow, refund: RefundRow, trx: Executor): Promise<{ id: string; number: string }> {
  const existing = await trx.selectFrom("invoices").select(["id", "number"]).where("refund_id", "=", refund.id).executeTakeFirst();
  if (existing) return existing;
  const settings = await getSettings(trx);
  const now = new Date();
  const number = await invoiceRepo.nextNumber(seriesFor("CREDIT_NOTE", now), trx);
  const id = newId();
  const tax = orderTax(order);
  const taxShare = order.total_minor > 0 ? divRound(order.tax_minor * refund.amount_minor, order.total_minor) : 0;
  const subtotal = tax.mode === "EXCLUSIVE" ? refund.amount_minor - taxShare : refund.amount_minor;
  const original = await trx.selectFrom("invoices").select("number").where("order_id", "=", order.id).where("kind", "=", "INVOICE").executeTakeFirst();
  const lines: InvoiceLine[] = [{ title: `Refund for order ${order.number}${original ? ` (invoice ${original.number})` : ""}`, unitMinor: subtotal, discountMinor: 0, taxMinor: taxShare, totalMinor: refund.amount_minor }];
  await invoiceRepo.insert(
    {
      id,
      number,
      kind: "CREDIT_NOTE",
      order_id: order.id,
      refund_id: refund.id,
      subscription_id: null,
      user_id: order.user_id,
      currency: order.currency,
      subtotal_minor: subtotal,
      discount_minor: 0,
      tax_minor: taxShare,
      total_minor: refund.amount_minor,
      seller: sellerOf(settings),
      buyer: await buyerOf(order, trx),
      lines: lines as never,
      tax: tax as never,
    },
    trx,
  );
  return { id, number };
}

// ─── PDF ────────────────────────────────────────────────────────────────────

/** The object key an invoice's PDF is stored under. */
export function pdfKeyFor(inv: Pick<InvoiceRow, "number" | "issued_at">): string {
  return `invoices/${inv.issued_at.getUTCFullYear()}/${inv.number.replace(/[^A-Za-z0-9-]/g, "_")}.pdf`;
}

export function renderPdf(inv: InvoiceRow, orderNumber: string | null): Promise<Buffer> {
  const seller = inv.seller as { legalName: string; address: string; taxId: string | null; email: string | null };
  const buyer = inv.buyer as { name: string; email: string; country: string | null; region: string | null; taxId: string | null; addressLine: string | null; postalCode: string | null };
  const lines = inv.lines as unknown as InvoiceLine[];
  const tax = inv.tax as Partial<FrozenTax>;
  const money = (n: number) => `${formatMinor(n, inv.currency)} ${inv.currency}`;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: `${inv.kind === "INVOICE" ? "Invoice" : "Credit note"} ${inv.number}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.font("Helvetica-Bold").fontSize(20).text(inv.kind === "INVOICE" ? "Invoice" : "Credit note");
    doc.moveDown(0.3).font("Helvetica").fontSize(10).text(`Number: ${inv.number}`);
    doc.text(`Date: ${inv.issued_at.toISOString().slice(0, 10)}`);
    if (orderNumber) doc.text(`Order: ${orderNumber}`);
    doc.moveDown();
    const top = doc.y;
    doc.font("Helvetica-Bold").text("From", 50, top);
    doc.font("Helvetica").text([seller.legalName, seller.address, seller.taxId ? `Tax id: ${seller.taxId}` : "", seller.email ?? ""].filter(Boolean).join("\n"), 50, doc.y, { width: 230 });
    const leftEnd = doc.y;
    doc.font("Helvetica-Bold").text("Bill to", 320, top);
    doc.font("Helvetica").text([buyer.name, buyer.email, buyer.addressLine ?? "", [buyer.postalCode, buyer.region, buyer.country].filter(Boolean).join(", "), buyer.taxId ? `Tax id: ${buyer.taxId}` : ""].filter(Boolean).join("\n"), 320, doc.y, { width: 230 });
    doc.y = Math.max(leftEnd, doc.y) + 20;
    doc.x = 50;
    const row = (cells: string[], bold = false) => {
      const y = doc.y;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica");
      const widths = [230, 80, 80, 105];
      let x = 50;
      cells.forEach((c, i) => {
        doc.text(c, x, y, { width: widths[i], align: i === 0 ? "left" : "right" });
        x += widths[i] + 0;
      });
      doc.moveDown(0.5);
      doc.x = 50;
    };
    row(["Item", "Price", "Discount", "Amount"], true);
    for (const l of lines) row([l.title, money(l.unitMinor), l.discountMinor ? `-${money(l.discountMinor)}` : "", money(l.totalMinor)]);
    doc.moveDown();
    const rate = Number(tax.rateBps ?? 0);
    const taxLabel = rate ? `${tax.label ?? "Tax"} (${(rate / 100).toFixed(2).replace(/\.?0+$/, "")}%${tax.mode === "INCLUSIVE" ? ", included" : ""})` : null;
    row(["Subtotal", "", "", money(inv.subtotal_minor)]);
    if (inv.discount_minor) row(["Discount", "", "", `-${money(inv.discount_minor)}`]);
    if (taxLabel) row([taxLabel, "", "", money(inv.tax_minor)]);
    row(["Total", "", "", money(inv.total_minor)], true);
    if (inv.kind === "CREDIT_NOTE") doc.moveDown().font("Helvetica").fontSize(9).text("This credit note reduces the amount of the original invoice by the total above.");
    doc.end();
  });
}

/** invoices.render: draw and store the PDF once. Safe to run twice. */
export async function renderInvoice(invoiceId: string): Promise<void> {
  const inv = await invoiceRepo.byId(invoiceId);
  if (!inv || inv.pdf_key) return;
  const order = inv.order_id ? await db.selectFrom("orders").select("number").where("id", "=", inv.order_id).executeTakeFirst() : undefined;
  const pdf = await renderPdf(inv, order?.number ?? null);
  const key = pdfKeyFor(inv);
  await storage().put(key, pdf, "application/pdf");
  await invoiceRepo.setPdfKey(inv.id, key);
}

/** A signed download URL for the owner; everyone else is told it does not exist. */
export async function invoiceDownloadUrl(actor: Actor, invoiceId: string): Promise<string> {
  const inv = await invoiceRepo.byId(invoiceId);
  if (!inv || inv.user_id !== actor.id) throw notFound("Invoice not found");
  if (!inv.pdf_key) throw conflict("The invoice PDF is still being prepared", "INVOICE_RENDERING");
  return storage().signedGetUrl(inv.pdf_key, { downloadName: `${inv.number}.pdf` });
}

/** Staff with the orders area download any invoice or credit note (support answers billing questions). */
export async function adminInvoiceDownloadUrl(actor: Actor, invoiceId: string): Promise<string> {
  requireArea(actor, "orders");
  const inv = await invoiceRepo.byId(invoiceId);
  if (!inv) throw notFound("Invoice not found");
  if (!inv.pdf_key) throw conflict("The invoice PDF is still being prepared", "INVOICE_RENDERING");
  return storage().signedGetUrl(inv.pdf_key, { downloadName: `${inv.number}.pdf` });
}
