/**
 * Invoices, credit notes and their gap-free numbers. A number comes from
 * invoice_sequences in the SAME transaction that inserts the invoice: the series row is
 * locked by the upsert until commit, so numbers are strictly sequential, and a
 * transaction that rolls back takes its number with it (no gaps, no duplicates).
 */
import { sql, type Selectable } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { Invoices } from "../db/types";
import { atKey, olderThan, type TimeKey } from "./keyset";

export type InvoiceRow = Selectable<Invoices>;

/** "INV-2026" / "CN-2026" plus a 6-digit counter: "INV-2026-000042". */
export function formatInvoiceNumber(series: string, n: number): string {
  return `${series}-${String(n).padStart(6, "0")}`;
}

export class InvoiceRepository {
  /**
   * The next number in a series. Insert-or-bump in one statement; the row lock it takes
   * serialises concurrent issuers until their transactions end.
   */
  async nextNumber(series: string, trx: Executor): Promise<string> {
    const r = await sql<{ n: number }>`
      INSERT INTO invoice_sequences (series, next) VALUES (${series}, 2)
      ON CONFLICT (series) DO UPDATE SET next = invoice_sequences.next + 1
      RETURNING next - 1 AS n`.execute(trx);
    return formatInvoiceNumber(series, Number(r.rows[0]?.n));
  }

  async insert(row: Omit<InvoiceRow, "pdf_key" | "issued_at">, trx: Executor): Promise<void> {
    await trx
      .insertInto("invoices")
      .values({ ...row, seller: JSON.stringify(row.seller), buyer: JSON.stringify(row.buyer), lines: JSON.stringify(row.lines), tax: JSON.stringify(row.tax) })
      .execute();
  }

  byId(id: string, exec: Executor = db): Promise<InvoiceRow | undefined> {
    return exec.selectFrom("invoices").selectAll().where("id", "=", id).executeTakeFirst();
  }

  /** The (one) invoice of each order, for order DTOs. */
  async forOrders(orderIds: readonly string[], exec: Executor = db): Promise<Map<string, { id: string; number: string; ready: boolean }>> {
    if (!orderIds.length) return new Map();
    const rows = await exec.selectFrom("invoices").select(["id", "number", "order_id", "pdf_key"]).where("kind", "=", "INVOICE").where("order_id", "in", [...new Set(orderIds)]).execute();
    return new Map(rows.map((r) => [r.order_id as string, { id: r.id, number: r.number, ready: !!r.pdf_key }]));
  }

  allForOrder(orderId: string, exec: Executor = db) {
    return exec.selectFrom("invoices").select(["id", "number", "kind"]).where("order_id", "=", orderId).orderBy("issued_at").orderBy("id").execute();
  }

  listForUser(userId: string, cursor: TimeKey | null, limit: number, exec: Executor = db) {
    return exec
      .selectFrom("invoices as i")
      .leftJoin("orders as o", "o.id", "i.order_id")
      .select(["i.id", "i.number", "i.kind", "i.currency", "i.total_minor", "i.issued_at", "i.pdf_key", "o.number as order_number", atKey("i.issued_at")])
      .where("i.user_id", "=", userId)
      .where(olderThan("i.issued_at", "i.id", cursor))
      .orderBy("i.issued_at", "desc")
      .orderBy("i.id", "desc")
      .limit(limit + 1)
      .execute();
  }

  async setPdfKey(id: string, key: string, exec: Executor = db): Promise<void> {
    await exec.updateTable("invoices").set({ pdf_key: key }).where("id", "=", id).where("pdf_key", "is", null).execute();
  }
}

export const invoiceRepo = new InvoiceRepository();
