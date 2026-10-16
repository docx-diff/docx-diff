// The changes list as the reviewer sees it (FR-26, FR-30, FR-31, FR-33, FR-34): text items in
// document order, with the formatting group as one entry at the position of its first item; the
// group's items follow its header when it is expanded. Navigation follows the list.
import type { ChangeItem } from './changes';
import type { Decision } from './decisions';

export type ListEntry =
  | { type: 'item'; item: ChangeItem; /** e.g. "12", or "F3" for a formatting item. */ label: string }
  | { type: 'formatting-group'; count: number };

/**
 * The list entries. `reviewable` are the text items (see `reviewableItems`) and `formatting` the
 * formatting items in range, each in document order.
 */
export function buildReviewList(reviewable: readonly ChangeItem[], formatting: readonly ChangeItem[], expanded: boolean): ListEntry[] {
  const entries: ListEntry[] = reviewable.map((item, i) => ({ type: 'item', item, label: String(i + 1) }));
  if (formatting.length === 0) return entries;
  const groupAt = entries.findIndex((entry) => entry.type === 'item' && entry.item.order > formatting[0]!.order);
  const group: ListEntry[] = [{ type: 'formatting-group', count: formatting.length }];
  if (expanded) group.push(...formatting.map((item, i): ListEntry => ({ type: 'item', item, label: `F${i + 1}` })));
  entries.splice(groupAt === -1 ? entries.length : groupAt, 0, ...group);
  return entries;
}

/** The items Previous/Next step through: those shown in the list, in list order. */
export function navigationOrder(entries: readonly ListEntry[]): ChangeItem[] {
  return entries.flatMap((entry) => (entry.type === 'item' ? [entry.item] : []));
}

/**
 * The item before or after the current one; the first (last) one when there is no current item or
 * it is not in the order. Stays at the ends (returns the current id).
 */
export function step(order: readonly ChangeItem[], currentId: string | null, direction: 1 | -1): string | null {
  if (order.length === 0) return null;
  const at = currentId === null ? -1 : order.findIndex((item) => item.id === currentId);
  if (at === -1) return (direction === 1 ? order[0] : order.at(-1))!.id;
  return order[Math.max(0, Math.min(order.length - 1, at + direction))]!.id;
}

/**
 * The next undecided text item after the current one, wrapping around to the start; `null` when
 * every text item is decided. Formatting items are skipped (they have no decision of their own).
 */
export function nextUndecided(
  order: readonly ChangeItem[],
  currentId: string | null,
  decisions: Readonly<Record<string, Decision>>,
): string | null {
  const at = currentId === null ? -1 : order.findIndex((item) => item.id === currentId);
  for (let i = 1; i <= order.length; i++) {
    const item = order[(at + i + order.length) % order.length]!;
    if (item.kind !== 'formatting' && !(item.id in decisions)) return item.id;
  }
  return null;
}
