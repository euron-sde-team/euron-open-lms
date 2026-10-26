/**
 * Rate limits backed by Redis, so the budget is shared by every API task (an in-memory
 * limiter multiplies the budget by the number of tasks). Keyed by user when signed in,
 * by IP otherwise.
 *
 * Redis outages degrade, they do not fail: every Redis limiter has an in-memory
 * insurance limiter with the same budget, used whenever the Redis client is not ready
 * or a command errors. During an outage each API task enforces the budget on its own
 * (so the effective budget is per task), instead of answering 500.
 *
 * Tests run with RATE_LIMITS=off unless a test turns them on to assert the 429.
 */
import type { NextFunction, Request, Response } from "express";
import type { Redis } from "ioredis";
import { RateLimiterMemory, RateLimiterRedis, type RateLimiterAbstract, RateLimiterRes } from "rate-limiter-flexible";
import { rateLimitEnv } from "../core/config";
import { tooMany } from "../core/errors";
import { redis } from "../integrations/redis";

const limiters = new Map<string, RateLimiterAbstract>();

/** A Redis limiter that falls back to memory when Redis is unavailable. Exported for tests. */
export function redisLimiter(client: Redis, name: string, points: number, durationSeconds: number): RateLimiterRedis {
  return new RateLimiterRedis({
    storeClient: client,
    keyPrefix: `rl:${name}`,
    points,
    duration: durationSeconds,
    rejectIfRedisNotReady: true,
    insuranceLimiter: new RateLimiterMemory({ keyPrefix: `rl-insurance:${name}`, points, duration: durationSeconds }),
  });
}

export function limiter(name: string, points: number, durationSeconds: number): RateLimiterAbstract {
  const key = `${name}:${points}:${durationSeconds}`;
  let l = limiters.get(key);
  if (!l) {
    l =
      rateLimitEnv().store === "memory"
        ? new RateLimiterMemory({ keyPrefix: `rl:${name}`, points, duration: durationSeconds })
        : redisLimiter(redis(), name, points, durationSeconds);
    limiters.set(key, l);
  }
  return l;
}

function enabled(): boolean {
  return rateLimitEnv().enabled;
}

/** Consume one point; throws a 429 with Retry-After when the budget is spent. */
export async function consume(name: string, subject: string, points: number, durationSeconds: number): Promise<void> {
  if (!enabled()) return;
  try {
    await limiter(name, points, durationSeconds).consume(subject);
  } catch (err) {
    if (err instanceof RateLimiterRes) throw tooMany(undefined, Math.ceil(err.msBeforeNext / 1000));
    throw err;
  }
}

/**
 * Failure budgets (sign-in): `spent` says whether the subject has used the whole budget,
 * without spending anything; `penalise` records one failure; `forgive` clears it.
 */
export const failureBudget = {
  async spent(name: string, subject: string, points: number, durationSeconds: number): Promise<boolean> {
    if (!enabled()) return false;
    const res = await limiter(name, points, durationSeconds).get(subject);
    return !!res && res.consumedPoints >= points;
  },
  async penalise(name: string, subject: string, points: number, durationSeconds: number): Promise<void> {
    if (!enabled()) return;
    await limiter(name, points, durationSeconds).penalty(subject, 1);
  },
  async forgive(name: string, subject: string, points: number, durationSeconds: number): Promise<void> {
    if (!enabled()) return;
    await limiter(name, points, durationSeconds).delete(subject);
  },
};

export function rateLimit(name: string, points: number, durationSeconds: number, by: "ip" | "user" = "user") {
  return async (req: Request, res: Response, next: NextFunction) => {
    const subject = by === "user" && req.actor ? `u:${req.actor.id}` : `ip:${req.ip}`;
    try {
      await consume(name, subject, points, durationSeconds);
    } catch (err) {
      const retry = (err as { details?: { retryAfterSeconds?: number } }).details?.retryAfterSeconds;
      if (retry) res.setHeader("Retry-After", String(retry));
      throw err;
    }
    next();
  };
}
