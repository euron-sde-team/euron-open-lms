/** The request helpers every endpoint group is built from. */
import type { HttpClient, Query } from "../http";

export interface PageQuery {
  cursor?: string;
  limit?: number;
}

export const enc = encodeURIComponent;

export function helpers(http: HttpClient) {
  return {
    http,
    get: <T>(path: string, query?: Query, signal?: AbortSignal) => http.request<T>("GET", path, { query, signal }),
    post: <T = void>(path: string, body?: unknown) => http.request<T>("POST", path, { body }),
    put: <T = void>(path: string, body?: unknown) => http.request<T>("PUT", path, { body }),
    patch: <T = void>(path: string, body?: unknown) => http.request<T>("PATCH", path, { body }),
    del: <T = void>(path: string, query?: Query) => http.request<T>("DELETE", path, { query }),
    /** Public GETs that must not trigger a refresh (catalog pages for signed-out visitors work too). */
    pub: <T>(path: string, query?: Query, signal?: AbortSignal) => http.request<T>("GET", path, { query, signal }),
    pq: (q?: object) => q as Query | undefined,
    download: async (path: string, query?: Query): Promise<Blob> => (await http.request<Response>("GET", path, { raw: true, query })).blob(),
    csv: (v?: readonly string[]) => (v && v.length ? v.join(",") : undefined),
  };
}

export type Helpers = ReturnType<typeof helpers>;
