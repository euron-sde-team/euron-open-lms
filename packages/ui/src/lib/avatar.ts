/**
 * Avatar fallback helpers: initials from a display name, and a background
 * colour picked deterministically from a stable seed (the user id or username),
 * so the same person always gets the same colour on every device.
 */

/** Up to two initials: first letter of the first and last words. */
export function initials(name: string | null | undefined): string {
  const words = (name ?? "")
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  const first = Array.from(words[0] ?? "")[0] ?? "";
  if (words.length === 1) return first.toUpperCase();
  const last = Array.from(words[words.length - 1] ?? "")[0] ?? "";
  return (first + last).toUpperCase();
}

/**
 * Hues chosen so white initials stay readable (AA for large text) on each
 * background at the fixed saturation and lightness below.
 */
export const AVATAR_HUES = [210, 226, 248, 268, 290, 330, 350, 14, 28, 160, 174, 190] as const;

/** FNV-1a 32-bit hash: tiny, fast and stable across runtimes. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function avatarHue(seed: string): number {
  return AVATAR_HUES[hashString(seed) % AVATAR_HUES.length] ?? AVATAR_HUES[0];
}

/** CSS colour for the fallback background. */
export function avatarColor(seed: string): string {
  return `hsl(${avatarHue(seed)} 55% 40%)`;
}
