/**
 * Usernames are the public handle in /in/<username>. Rules: 3 to 40 characters,
 * letters, digits and hyphens, starting and ending with a letter or digit (the same
 * shape the users.username CHECK enforces). A small reserved list keeps handles from
 * colliding with routes or impersonating the operator.
 */
export const USERNAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,38}[a-zA-Z0-9]$/;

const RESERVED = new Set([
  "academy", "account", "admin", "administrator", "api", "app", "auth", "billing", "bundles", "certificates",
  "checkout", "courses", "dashboard", "edit", "help", "home", "instructor", "instructors", "learn", "login",
  "logout", "me", "moderation", "moderator", "my-learning", "new", "notifications", "official", "plans",
  "privacy", "root", "search", "security", "settings", "signin", "signup", "staff", "static", "support",
  "system", "teach", "team", "terms", "verify", "www",
]);

export function isReservedUsername(username: string): boolean {
  return RESERVED.has(username.toLowerCase());
}

/**
 * Candidate handles for a display name, best first: "ada-lovelace", "adalovelace",
 * "ada-lovelace-2", ... The caller checks availability.
 */
export function usernameSuggestions(displayName: string, count = 5): string[] {
  const words = displayName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 3);
  const base = (words.length ? words.join("-") : "member").slice(0, 34).replace(/^-+|-+$/g, "");
  const padded = base.length >= 3 ? base : `${base}-me`.slice(0, 34);
  const out = new Set<string>([padded, padded.replace(/-/g, "")]);
  for (let i = 2; out.size < count + 1; i++) out.add(`${padded}-${i}`);
  return [...out].filter((u) => USERNAME_PATTERN.test(u) && !isReservedUsername(u)).slice(0, count);
}
