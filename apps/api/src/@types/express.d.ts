import type { Actor } from "../core/context";

declare global {
  namespace Express {
    interface Request {
      /** Set by authenticate/optionalAuth; null on public requests. */
      actor: Actor | null;
      requestId: string;
    }
  }
}

export {};
