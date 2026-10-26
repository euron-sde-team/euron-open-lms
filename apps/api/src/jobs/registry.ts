/**
 * Background jobs. A job is a named handler with a JSON payload. Services enqueue jobs
 * through `Effects.job(...)`, so nothing is enqueued for a transaction that rolled back.
 *
 * JOBS_MODE=queue  BullMQ on Redis; the worker process (worker.ts) runs the handlers.
 * JOBS_MODE=inline the handler runs in-process right after commit. Used by the
 *                  integration tests so assertions are deterministic.
 */
import { Queue, type JobsOptions } from "bullmq";
import { config } from "../core/config";
import { captureError, logger } from "../core/logger";
import { redisConnection } from "../integrations/redis";

export const QUEUES = ["media", "notify", "invoices", "certificates", "billing", "ai", "maintenance"] as const;
export type QueueName = (typeof QUEUES)[number];

export interface JobDefinitions {
  "media.process": { uploadId: string };
  /** Email pending notifications (one id, or every due one when omitted). */
  "notify.email": { notificationId?: string };
  /** The receipt for a paid order (always sent: not a preference). */
  "notify.receipt": { orderId: string };
  "notify.refund": { refundId: string };
  /** Render an invoice or credit note PDF to private storage. */
  "invoices.render": { invoiceId: string };
  /** Render a certificate PDF to private storage. */
  "certificates.render": { certificateId: string };
  /** Ask the gateway about PENDING orders past their expiry (a lost webhook), then expire them. */
  "billing.reconcile-pending": Record<string, never>;
  /** Move subscriptions whose period (and grace) ended to EXPIRED. */
  "billing.expire-subscriptions": Record<string, never>;
  /** Draft rubric scores and feedback for a submission (a human always confirms). */
  "ai.grade-suggestion": { submissionId: string };
  "maintenance.reconcile-counters": Record<string, never>;
  "maintenance.expire-uploads": Record<string, never>;
  "maintenance.lift-suspensions": Record<string, never>;
  /** Erase accounts whose deletion grace period is over. */
  "maintenance.purge-accounts": Record<string, never>;
}
export type JobName = keyof JobDefinitions;

type Handler<N extends JobName> = (data: JobDefinitions[N]) => Promise<void>;
const handlers = new Map<JobName, Handler<any>>();

export function registerJob<N extends JobName>(name: N, handler: Handler<N>): void {
  handlers.set(name, handler);
}

export function getHandler<N extends JobName>(name: N): Handler<N> | undefined {
  return handlers.get(name);
}

export function queueFor(name: JobName): QueueName {
  return name.split(".")[0] as QueueName;
}

const queues = new Map<QueueName, Queue>();
function queue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: redisConnection(),
      defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: 1000, removeOnFail: 5000 },
    });
    queues.set(name, q);
  }
  return q;
}

export async function enqueue<N extends JobName>(name: N, data: JobDefinitions[N], opts: JobsOptions = {}): Promise<void> {
  if (config.JOBS_MODE === "inline") {
    const handler = getHandler(name);
    if (!handler) {
      logger.warn({ job: name }, "inline job has no handler registered");
      return;
    }
    try {
      await handler(data);
    } catch (err) {
      captureError(err, { job: name });
    }
    return;
  }
  await queue(queueFor(name)).add(name, data, opts);
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
}
