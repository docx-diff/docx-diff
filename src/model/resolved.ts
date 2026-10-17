// What the Resolved column shows of each item (docs/architecture.md, "Resolved column"): the side
// the export resolves it to, with undecided changes accepted, as the export dialog's default. Its
// formatting is always the Edited's, so formatting items are accepted whatever the formatting
// choice.
import type { ChangeItem } from './changes';
import { finalItemDecision, type DecisionState } from './decisions';
import type { RangeClass } from './range';

export type ResolvedSide = 'accept' | 'reject';

/**
 * Each item's resolved side, by item id: out of range → reject; formatting → accept; otherwise as
 * the export with undecided changes accepted (`finalItemDecision`).
 */
export function resolvedItemDecisions(
  items: readonly ChangeItem[],
  state: DecisionState,
  range: ReadonlyMap<string, RangeClass>,
  ignored: ReadonlySet<string>,
): Map<string, ResolvedSide> {
  const result = new Map<string, ResolvedSide>();
  for (const item of items) {
    const formatting = item.kind === 'formatting' && range.get(item.id) !== 'outOfRange';
    result.set(item.id, formatting ? 'accept' : finalItemDecision(item, state, range, 'accept', ignored));
  }
  return result;
}
