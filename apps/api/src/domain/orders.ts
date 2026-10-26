/**
 * The order state machine. The repository turns each allowed move into a conditional
 * UPDATE (`... WHERE id = ? AND status = ANY(from)`), so two deliveries of the same
 * webhook, or the browser's return racing the webhook, can never both apply a move:
 * the loser updates zero rows and stops.
 *
 *   PENDING -> PAID | FAILED | EXPIRED | CANCELED
 *   FAILED  -> PAID              (Razorpay can capture after a failed first attempt)
 *   EXPIRED -> PAID              (a late webhook for money that really was taken)
 *   PAID    -> PARTIALLY_REFUNDED | REFUNDED
 *   PARTIALLY_REFUNDED -> PARTIALLY_REFUNDED | REFUNDED
 *
 * A late "payment failed" after PAID is ignored: money taken is never un-taken by a
 * failure event, only by a refund.
 */
import type { OrderStatus } from "@open-lms/types";

const MOVES: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ["PAID", "FAILED", "EXPIRED", "CANCELED"],
  FAILED: ["PAID"],
  EXPIRED: ["PAID"],
  CANCELED: [],
  PAID: ["PARTIALLY_REFUNDED", "REFUNDED"],
  PARTIALLY_REFUNDED: ["PARTIALLY_REFUNDED", "REFUNDED"],
  REFUNDED: [],
};

export function canMove(from: OrderStatus, to: OrderStatus): boolean {
  return MOVES[from].includes(to);
}

/** Every status that may move to `to`: the WHERE clause of the conditional update. */
export function sourcesOf(to: OrderStatus): OrderStatus[] {
  return (Object.keys(MOVES) as OrderStatus[]).filter((from) => MOVES[from].includes(to));
}

/** The status after refunding `amount` of an order that already had `refunded` back. */
export function statusAfterRefund(totalMinor: number, refundedMinor: number): OrderStatus {
  return refundedMinor >= totalMinor ? "REFUNDED" : "PARTIALLY_REFUNDED";
}

/**
 * Does what the gateway says it captured match what we priced? A webhook is trusted
 * for *whether* the buyer paid, never for *how much*: a mismatch is recorded and the
 * order is not fulfilled.
 */
export function amountMatches(order: { totalMinor: number; currency: string }, captured: { amountMinor: number; currency: string }): boolean {
  return order.totalMinor === captured.amountMinor && order.currency.toUpperCase() === captured.currency.toUpperCase();
}

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** "ORD-7K2M9QX4": human-friendly, no 0/O/1/I, from 8 random bytes. */
export function orderNumber(random: Uint8Array): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[random[i] % ALPHABET.length];
  return `ORD-${s}`;
}

/** "LMS-3F9K-Q2ZD-7M": a certificate serial, 10 symbols in groups. */
export function certificateSerial(random: Uint8Array, prefix = "LMS"): string {
  let s = "";
  for (let i = 0; i < 10; i++) s += ALPHABET[random[i] % ALPHABET.length];
  return `${prefix}-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
