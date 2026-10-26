/** Only same-site paths are honoured as a post-login destination (no open redirects). */
export function safeNext(raw: string | null | undefined, fallback = "/"): string {
  if (!raw) return fallback;
  let v = raw.trim();
  try {
    v = decodeURIComponent(v);
  } catch {
    return fallback;
  }
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(v)) return fallback;
  // Do not bounce back into the auth pages.
  if (/^\/(login|signup|verify-email|forgot-password|reset-password)(\/|\?|$)/.test(v)) return fallback;
  return v;
}

const AFTER_VERIFY_KEY = "lms:after-verify";
const AFTER_VERIFY_TTL_MS = 2 * 86_400_000;

/**
 * Sign-up with email confirmation leaves the site (the link arrives by email, often in a
 * new tab), so the `next` destination is kept in localStorage for the confirmation page.
 */
export function rememberAfterVerify(next: string, now = Date.now()): void {
  if (!next || next === "/") return;
  try {
    window.localStorage.setItem(AFTER_VERIFY_KEY, JSON.stringify({ next, at: now }));
  } catch {
    /* private mode: the learner lands on the home page instead */
  }
}

/** The remembered destination (once), checked again with safeNext; "/" when there is none. */
export function takeAfterVerify(now = Date.now()): string {
  try {
    const raw = window.localStorage.getItem(AFTER_VERIFY_KEY);
    window.localStorage.removeItem(AFTER_VERIFY_KEY);
    if (!raw) return "/";
    const v = JSON.parse(raw) as { next?: unknown; at?: unknown };
    if (typeof v.next !== "string" || typeof v.at !== "number" || now - v.at > AFTER_VERIFY_TTL_MS) return "/";
    return safeNext(v.next);
  } catch {
    return "/";
  }
}
