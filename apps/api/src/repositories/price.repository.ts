/**
 * The price book (`prices`): what a course, bundle or plan costs in each currency. Read
 * by the catalog (cards and course pages), checkout (the only amounts an order is ever
 * built from) and admin. Written only by the authoring and commerce admin services.
 */
import type { Money, SellableType } from "@open-lms/types";
import { db, type Executor } from "../db/kysely";

export interface PriceRow {
  id: string;
  sellable_type: SellableType;
  sellable_id: string;
  currency: string;
  amount_minor: number;
  compare_at_minor: number | null;
  interval: "MONTH" | "YEAR" | null;
  gateway_refs: unknown;
}

const COLUMNS = ["id", "sellable_type", "sellable_id", "currency", "amount_minor", "compare_at_minor", "interval", "gateway_refs"] as const;

export class PriceRepository {
  /** The active one-time price of one thing in one currency. */
  oneTime(type: Exclude<SellableType, "PLAN">, id: string, currency: string, exec: Executor = db): Promise<PriceRow | undefined> {
    return exec.selectFrom("prices").select([...COLUMNS]).where("sellable_type", "=", type).where("sellable_id", "=", id).where("currency", "=", currency).where("active", "=", true).where("interval", "is", null).executeTakeFirst() as Promise<PriceRow | undefined>;
  }

  /** Active one-time prices of many things in one currency, keyed by sellable id. */
  async oneTimeMany(type: Exclude<SellableType, "PLAN">, ids: readonly string[], currency: string, exec: Executor = db): Promise<Map<string, PriceRow>> {
    if (!ids.length) return new Map();
    const rows = (await exec.selectFrom("prices").select([...COLUMNS]).where("sellable_type", "=", type).where("sellable_id", "in", [...new Set(ids)]).where("currency", "=", currency).where("active", "=", true).where("interval", "is", null).execute()) as PriceRow[];
    return new Map(rows.map((r) => [r.sellable_id, r]));
  }

  /** Every active price of one thing (all currencies, all intervals). */
  allFor(type: SellableType, id: string, exec: Executor = db): Promise<PriceRow[]> {
    return exec.selectFrom("prices").select([...COLUMNS]).where("sellable_type", "=", type).where("sellable_id", "=", id).where("active", "=", true).orderBy("currency").execute() as Promise<PriceRow[]>;
  }

  /** Active recurring prices of a plan in one currency. */
  planPrices(planId: string, currency: string, exec: Executor = db): Promise<PriceRow[]> {
    return exec.selectFrom("prices").select([...COLUMNS]).where("sellable_type", "=", "PLAN").where("sellable_id", "=", planId).where("currency", "=", currency).where("active", "=", true).orderBy("interval").execute() as Promise<PriceRow[]>;
  }

  byId(id: string, exec: Executor = db): Promise<PriceRow | undefined> {
    return exec.selectFrom("prices").select([...COLUMNS]).where("id", "=", id).executeTakeFirst() as Promise<PriceRow | undefined>;
  }
}

export const priceRepo = new PriceRepository();

export function money(amountMinor: number, currency: string): Money {
  return { amountMinor, currency };
}
