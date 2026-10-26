/**
 * Side effects that must only happen if the transaction commits: job enqueues, emails,
 * cache invalidation. Collect them during the transaction, flush after.
 *
 *   return withTransaction(async (trx, fx) => {
 *     const order = await orderRepo.markPaid(..., trx);
 *     fx.job("invoices.render", { orderId: order.id });
 *     fx.job("notify.receipt", { orderId: order.id });
 *     return order;
 *   });
 *
 * A failing effect is logged and never fails the request: the write already happened.
 */
import type { Transaction } from "kysely";
import { db } from "../db/kysely";
import type { DB } from "../db/types";
import { enqueue, type JobDefinitions, type JobName } from "../jobs/registry";
import { captureError } from "./logger";

export class Effects {
  private readonly pending: Array<() => unknown> = [];

  job<N extends JobName>(name: N, data: JobDefinitions[N]): this {
    this.pending.push(() => enqueue(name, data));
    return this;
  }

  /** Any other after-commit work (cache invalidation, a follow-up query). */
  after(fn: () => unknown): this {
    this.pending.push(fn);
    return this;
  }

  async flush(): Promise<void> {
    const work = this.pending.splice(0);
    for (const fn of work) {
      try {
        await fn();
      } catch (err) {
        captureError(err, { where: "effects.flush" });
      }
    }
  }
}

/** Run `fn` in a transaction and flush its effects only after a successful commit. */
export async function withTransaction<T>(fn: (trx: Transaction<DB>, fx: Effects) => Promise<T>): Promise<T> {
  const fx = new Effects();
  const result = await db.transaction().execute((trx) => fn(trx, fx));
  await fx.flush();
  return result;
}

/** Same contract without a transaction, for single-statement writes. */
export async function withEffects<T>(fn: (fx: Effects) => Promise<T>): Promise<T> {
  const fx = new Effects();
  const result = await fn(fx);
  await fx.flush();
  return result;
}
