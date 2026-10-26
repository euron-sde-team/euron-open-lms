/**
 * Plans, and price-book writes for plans and bundles. A price row is never edited in
 * place: a changed amount deactivates the old row and inserts a new one, so orders keep
 * pointing at the price they were sold at and a cached gateway price (gateway_refs) is
 * never reused for a different amount.
 */
import type { SellableType } from "@open-lms/types";
import type { Selectable } from "kysely";
import { newId } from "../core/ids";
import { db, type Executor } from "../db/kysely";
import type { Plans } from "../db/types";
import type { PriceRow } from "./price.repository";

export type PlanRow = Selectable<Plans>;

export interface WantedPrice {
  currency: string;
  interval: "MONTH" | "YEAR" | null;
  amountMinor: number;
  compareAtMinor: number | null;
}

const PRICE_COLUMNS = ["id", "sellable_type", "sellable_id", "currency", "amount_minor", "compare_at_minor", "interval", "gateway_refs"] as const;

export class PlanRepository {
  list(exec: Executor = db): Promise<PlanRow[]> {
    return exec.selectFrom("plans").selectAll().orderBy("position").orderBy("created_at").execute();
  }

  byId(id: string, exec: Executor = db): Promise<PlanRow | undefined> {
    return exec.selectFrom("plans").selectAll().where("id", "=", id).executeTakeFirst();
  }

  /** Make the active price set exactly `wanted`; returns the active rows after. */
  async replacePrices(type: SellableType, sellableId: string, wanted: WantedPrice[], trx: Executor): Promise<PriceRow[]> {
    const current = (await trx.selectFrom("prices").select([...PRICE_COLUMNS]).where("sellable_type", "=", type).where("sellable_id", "=", sellableId).where("active", "=", true).forUpdate().execute()) as PriceRow[];
    const keyOf = (c: string, i: string | null) => `${c}|${i ?? ""}`;
    const want = new Map(wanted.map((w) => [keyOf(w.currency, w.interval), w]));
    const now = new Date();
    for (const row of current) {
      const w = want.get(keyOf(row.currency, row.interval));
      if (w && w.amountMinor === row.amount_minor && (w.compareAtMinor ?? null) === row.compare_at_minor) {
        want.delete(keyOf(row.currency, row.interval));
        continue;
      }
      await trx.updateTable("prices").set({ active: false, updated_at: now }).where("id", "=", row.id).execute();
    }
    for (const w of want.values()) {
      await trx.insertInto("prices").values({ id: newId(), sellable_type: type, sellable_id: sellableId, currency: w.currency, amount_minor: w.amountMinor, compare_at_minor: w.compareAtMinor, interval: w.interval }).execute();
    }
    return (await trx.selectFrom("prices").select([...PRICE_COLUMNS]).where("sellable_type", "=", type).where("sellable_id", "=", sellableId).where("active", "=", true).orderBy("currency").orderBy("interval").execute()) as PriceRow[];
  }
}

export const planRepo = new PlanRepository();
