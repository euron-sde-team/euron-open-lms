/**
 * Ordering within the curriculum. Positions are dense, 0..n-1 per parent. A move takes
 * the id out of its list and inserts it at the target index, then every sibling is
 * renumbered; the repository writes the result in one transaction with the UNIQUE
 * constraints deferred. Pure (test/unit/curriculum.test.ts).
 */

/** Reorder within one list. `toIndex` is clamped to the list. */
export function moveWithin(ids: string[], id: string, toIndex: number): string[] {
  const from = ids.indexOf(id);
  if (from === -1) return ids.slice();
  const rest = ids.filter((x) => x !== id);
  const at = Math.max(0, Math.min(rest.length, Math.floor(toIndex)));
  rest.splice(at, 0, id);
  return rest;
}

/** Move between two lists (an item dragged into another section). */
export function moveAcross(source: string[], target: string[], id: string, toIndex: number): { source: string[]; target: string[] } {
  const nextSource = source.filter((x) => x !== id);
  const nextTarget = target.filter((x) => x !== id);
  const at = Math.max(0, Math.min(nextTarget.length, Math.floor(toIndex)));
  nextTarget.splice(at, 0, id);
  return { source: nextSource, target: nextTarget };
}

/** [id, position] pairs for a list, dense from zero. */
export function positions(ids: string[]): [string, number][] {
  return ids.map((id, i) => [id, i]);
}

/** Flatten sections into one ordered item list (prev/next navigation and "resume"). */
export function flatten<T extends { id: string }>(sections: { items: T[] }[]): T[] {
  return sections.flatMap((s) => s.items);
}

export function neighbours(order: string[], id: string): { prev: string | null; next: string | null } {
  const i = order.indexOf(id);
  if (i === -1) return { prev: null, next: null };
  return { prev: i > 0 ? order[i - 1] : null, next: i < order.length - 1 ? order[i + 1] : null };
}

/** The first item not yet completed, else the last one touched, else the first. */
export function resumeTarget(order: string[], completed: Set<string>, lastItemId: string | null): string | null {
  if (lastItemId && order.includes(lastItemId) && !completed.has(lastItemId)) return lastItemId;
  return order.find((id) => !completed.has(id)) ?? lastItemId ?? order[0] ?? null;
}
