/**
 * Turning what people type into search predicates. Pure, so the escaping is
 * unit-tested: user text never reaches LIKE or tsquery syntax unescaped (the source
 * system passed % and _ straight into ILIKE).
 */

/**
 * Words of a search query: letters and digits only, lower-cased, at most 8. This is how
 * Postgres's 'simple' parser splits text, so "C++" becomes "c" on both sides.
 */
export function searchTerms(q: string): string[] {
  return (q.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).slice(0, 8);
}

/** "data sci" -> "data:* & sci:*", or null when nothing searchable remains. */
export function prefixTsQuery(q: string): string | null {
  const terms = searchTerms(q);
  if (!terms.length) return null;
  return terms.map((t) => `${t}:*`).join(" & ");
}

/** Escape LIKE wildcards so user text is matched literally (trigram indexes serve ILIKE). */
export function likeContains(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
