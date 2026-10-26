import type { AuthResult } from "@open-lms/types";
import { ApiError, REFRESHABLE_CODES, networkError, toApiError } from "./errors";

export type QueryValue = string | number | boolean | null | undefined | readonly (string | number)[];
export type Query = Record<string, QueryValue>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Send the refresh cookie (auth endpoints). */
  withCredentials?: boolean;
  /** Skip the refresh-and-retry dance (used by the auth endpoints themselves). */
  noRefresh?: boolean;
  /** Return the raw Response (for text/calendar and other non-JSON bodies). */
  raw?: boolean;
  /** Let the request outlive the page (final player heartbeats on tab hide or unload). */
  keepalive?: boolean;
}

export type SignOutReason = "SESSION_EXPIRED" | "SIGNED_OUT" | "REVOKED";

export interface ApiClientOptions {
  /** API base including the /api prefix, for example "/api" or "https://lms.example.org/api". */
  baseUrl: string;
  /** The in-memory access token, or null when signed out. */
  getAccessToken: () => string | null;
  /** Called with every successful refresh (store the new token, schedule the next refresh). */
  onRefresh?: (result: AuthResult) => void;
  /** Called when a refresh fails with 401: the session is over. */
  onSignedOut?: (reason: SignOutReason) => void;
  /**
   * Serialise refreshes across tabs (the refresh cookie rotates, so two tabs
   * refreshing at once would race). Defaults to the Web Locks API when present.
   */
  crossTabLock?: <T>(fn: () => Promise<T>) => Promise<T>;
  /**
   * Awaited before every request except the auth endpoints (`noRefresh`). The web app
   * holds requests here until its boot refresh has settled, so a page loaded with a
   * refresh cookie never fetches viewer-dependent data as a signed-out visitor.
   */
  ready?: () => Promise<void>;
  fetch?: typeof fetch;
}

export function buildQuery(query?: Query): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) for (const v of value) params.append(key, String(v));
    else params.append(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

const defaultLock = <T>(fn: () => Promise<T>): Promise<T> => {
  const locks = (globalThis as { navigator?: { locks?: { request: (name: string, cb: () => Promise<T>) => Promise<T> } } }).navigator?.locks;
  return locks ? locks.request("open-lms-auth-refresh", fn) : fn();
};

export class HttpClient {
  private inflightRefresh: Promise<AuthResult | null> | null = null;
  private readonly fetchImpl: typeof fetch;
  readonly baseUrl: string;

  constructor(private readonly opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? ((...args) => globalThis.fetch(...args));
  }

  url(path: string, query?: Query): string {
    return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}${buildQuery(query)}`;
  }

  /**
   * Single-flight refresh: concurrent callers share one POST /auth/refresh.
   * Resolves null when the session is over (401), rejects on transport errors
   * (so a flaky network does not sign anyone out).
   */
  refreshSession(): Promise<AuthResult | null> {
    if (!this.inflightRefresh) {
      const lock = this.opts.crossTabLock ?? defaultLock;
      this.inflightRefresh = lock(() => this.doRefresh()).finally(() => {
        this.inflightRefresh = null;
      });
    }
    return this.inflightRefresh;
  }

  private async doRefresh(): Promise<AuthResult | null> {
    try {
      const result = await this.send<AuthResult | undefined>("POST", "/auth/refresh", { withCredentials: true, noRefresh: true }, null);
      // 204: there was no session to refresh (signed out).
      if (!result) return null;
      this.opts.onRefresh?.(result);
      return result;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null;
      throw e;
    }
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    if (this.opts.ready && !options.noRefresh) await this.opts.ready();
    const token = this.opts.getAccessToken();
    try {
      return await this.send<T>(method, path, options, token);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401 || options.noRefresh) throw e;
      // Refresh only for a stale token; a 401 without a token is a plain "sign in".
      if (!REFRESHABLE_CODES.has(e.code) && !(token && e.code === "UNAUTHENTICATED")) throw e;
      const refreshed = await this.refreshSession();
      if (!refreshed) {
        this.opts.onSignedOut?.("SESSION_EXPIRED");
        throw e;
      }
      return this.send<T>(method, path, options, refreshed.accessToken);
    }
  }

  private async send<T>(method: string, path: string, options: RequestOptions, token: string | null): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      const b = options.body;
      if (typeof FormData !== "undefined" && b instanceof FormData) body = b;
      else if (typeof Blob !== "undefined" && b instanceof Blob) body = b;
      else {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(b);
      }
    }
    if (token) headers.Authorization = `Bearer ${token}`;

    let res: Response;
    try {
      res = await this.fetchImpl(this.url(path, options.query), {
        method,
        headers,
        body,
        signal: options.signal,
        ...(options.keepalive ? { keepalive: true } : {}),
        credentials: options.withCredentials ? "include" : "same-origin",
      });
    } catch (e) {
      if (isAbort(e)) throw e;
      throw networkError(e);
    }

    if (options.raw && res.ok) return res as unknown as T;
    const payload = await readBody(res);
    if (!res.ok) throw toApiError(res.status, payload);
    return payload as T;
  }
}

function isAbort(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { name?: string }).name === "AbortError";
}

async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204 || res.status === 205) return undefined;
  const text = await res.text().catch(() => "");
  if (!text) return undefined;
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("json")) {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }
  return text;
}
