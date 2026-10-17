// Decision states for the Resolved column's text parity checks (test/fixture-pairs.test.ts,
// test/sample-pair.test.ts).
import type { ChangeItem } from '../src/model/changes';
import { INITIAL_DECISIONS, type Decision, type DecisionState } from '../src/model/decisions';

/** Every reviewable item accepted, rejected, undecided, or alternating. */
export function parityStates(reviewable: readonly ChangeItem[]): [string, DecisionState][] {
  const all = (decision: Decision) => Object.fromEntries(reviewable.map((item) => [item.id, decision]));
  const alternating = (first: Decision, other: Decision) => Object.fromEntries(reviewable.map((item, i) => [item.id, i % 2 === 0 ? first : other]));
  return [
    ['all accepted', { ...INITIAL_DECISIONS, decisions: all('accepted') }],
    ['all rejected', { ...INITIAL_DECISIONS, decisions: all('rejected') }],
    ['all undecided', INITIAL_DECISIONS],
    ['alternating from accept', { ...INITIAL_DECISIONS, decisions: alternating('accepted', 'rejected') }],
    ['alternating from reject', { ...INITIAL_DECISIONS, decisions: alternating('rejected', 'accepted') }],
  ];
}
