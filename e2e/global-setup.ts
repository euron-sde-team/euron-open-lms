/**
 * Wait until the stack answers before the first test: `make up` returns as soon as the
 * containers report healthy, and the first requests can still race the API's warm-up.
 * Polls the API readiness check (Postgres and Redis reachable) and the web app.
 */
import { API, WEB } from "./helpers";

async function ready(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    return r.ok;
  } catch {
    return false;
  }
}

export default async function globalSetup(): Promise<void> {
  const deadline = Date.now() + 90_000;
  for (const url of [`${API}/ready`, `${WEB}/`]) {
    let ok = await ready(url);
    while (!ok && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1_000));
      ok = await ready(url);
    }
    if (!ok) throw new Error(`${url} did not answer within 90 seconds: is the stack up (make up)?`);
  }
}
