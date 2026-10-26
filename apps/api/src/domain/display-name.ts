/**
 * Display names are public. Free-text name fields collect anything people type, and in
 * practice that includes email addresses and phone numbers, so names are cleaned when
 * they are written, never at read time.
 *
 * Returns the cleaned name, or null when nothing name-like is left.
 */
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
// Seven or more digits, allowing spaces, dots, dashes, parentheses and a leading +.
const PHONE = /\+?\d[\d\s().-]{5,}\d/g;
const URL = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;

export function cleanDisplayName(raw: string, max = 80): string | null {
  const cleaned = raw
    .normalize("NFKC")
    .replace(EMAIL, " ")
    .replace(URL, " ")
    .replace(PHONE, " ")
    // Control and zero-width characters, then collapse whitespace.
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
  // A name needs at least one letter (in any script).
  return /\p{L}/u.test(cleaned) ? cleaned : null;
}
