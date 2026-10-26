/**
 * Every URL a person puts into the academy (a website on their profile, a lecture's HLS
 * or MP4 source, a resource link, a submission link) passes through here. Only http(s) URLs with a real host survive:
 * no javascript:, data:, file: or protocol-relative tricks, no credentials, no control
 * characters. The source system rendered links without this check, so a crafted
 * value could plant a javascript: link on a page.
 */
const MAX_URL = 500;

export function safeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s || s.length > MAX_URL) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s]/.test(s)) return null;
  // People often type "example.com/x" without a scheme: assume https.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s.replace(/^\/+/, "")}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host.endsWith(".") || host.length > 253) return null;
  return u.toString();
}

/** The registrable-ish domain of a URL or email, lower-cased: "jobs.northwind.example" -> "northwind.example". */
export function baseDomain(hostOrEmail: string): string | null {
  const host = (hostOrEmail.includes("@") ? hostOrEmail.split("@").pop()! : hostOrEmail).trim().toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;
  const parts = host.split(".");
  // Two-label public suffixes like co.uk / com.au keep three labels.
  const twoLabel = parts.length >= 3 && parts[parts.length - 2]!.length <= 3 && parts[parts.length - 1]!.length === 2;
  return parts.slice(twoLabel ? -3 : -2).join(".");
}

/** A YouTube video id from the usual URL shapes, for click-to-load embeds. */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    let id: string | null = null;
    if (host === "youtu.be") id = u.pathname.slice(1);
    else if (host === "youtube.com" || host === "youtube-nocookie.com") id = u.searchParams.get("v") ?? (u.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/)?.[1] ?? null);
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * Where a hosted checkout may send the buyer back: a link into the mobile app (one of
 * `schemes`, like `openlms://checkout/stripe`) or a page on the web app's own origin.
 * Anything else would turn checkout into an open redirect. Returns the URL to use (no
 * fragment, so appended query parameters stay visible), or null.
 */
export function checkoutReturnUrl(raw: string, webOrigin: string, schemes: readonly string[]): string | null {
  const s = raw.trim();
  // eslint-disable-next-line no-control-regex
  if (!s || s.length > MAX_URL || /[\u0000-\u001f\u007f\s]/.test(s) || s.includes("#")) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  const scheme = u.protocol.slice(0, -1).toLowerCase();
  if (scheme === "http" || scheme === "https") return u.origin === new URL(webOrigin).origin ? u.toString() : null;
  if (scheme === "javascript" || scheme === "data" || scheme === "file" || scheme === "blob") return null;
  return schemes.includes(scheme) ? s : null;
}
