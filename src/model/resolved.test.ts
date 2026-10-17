import { describe, expect, it } from 'vitest';
import type { ChangeItem, ChangeKind } from './changes';
import { INITIAL_DECISIONS, finalRevisionDecisions, type DecisionState } from './decisions';
import type { RangeClass } from './range';
import { resolvedItemDecisions } from './resolved';

function item(id: string, kind: ChangeKind, revisionIds = [id]): ChangeItem {
  return {
    id,
    kind,
    revisionIds,
    removedText: '',
    addedText: '',
    location: { scope: 'body' },
    wordDelta: { removed: 0, added: 0 },
    order: 0,
    anchors: [],
  };
}

// a, d, u: text items (a accepted, d rejected, u undecided); o: out of range (accepted);
// f: formatting; g: formatting out of range; i: ignored, j: ignored but rejected.
const items = [
  item('a', 'replaced', ['a', 'a2']),
  item('d', 'deleted'),
  item('u', 'inserted'),
  item('o', 'moved'),
  item('f', 'formatting'),
  item('g', 'formatting'),
  item('i', 'inserted'),
  item('j', 'paragraph'),
];
const range = new Map<string, RangeClass>(items.map((x) => [x.id, x.id === 'o' || x.id === 'g' ? 'outOfRange' : 'inRange']));
const ignored = new Set(['i', 'j']);
const state: DecisionState = {
  ...INITIAL_DECISIONS,
  decisions: { a: 'accepted', d: 'rejected', o: 'accepted', j: 'rejected' },
};

describe('resolvedItemDecisions', () => {
  it('rejects out of range, accepts formatting, then follows decisions, ignore and undecided = accept', () => {
    expect(Object.fromEntries(resolvedItemDecisions(items, state, range, ignored))).toEqual({
      a: 'accept',
      d: 'reject',
      u: 'accept',
      o: 'reject',
      f: 'accept',
      g: 'reject',
      i: 'accept',
      j: 'reject',
    });
  });

  it('accepts formatting whatever the formatting choice', () => {
    const resolved = resolvedItemDecisions(items, { ...state, formattingChoice: 'original' }, range, ignored);
    expect(resolved.get('f')).toBe('accept');
  });

  it("agrees with the export's revision decisions (undecided accepted) for every non-formatting item", () => {
    for (const formattingChoice of ['edited', 'original'] as const) {
      const s = { ...state, formattingChoice };
      const resolved = resolvedItemDecisions(items, s, range, ignored);
      const final = finalRevisionDecisions(items, s, range, 'accept', ignored);
      for (const x of items.filter((x) => x.kind !== 'formatting')) {
        for (const revisionId of x.revisionIds) expect(final.get(revisionId), x.id).toBe(resolved.get(x.id));
      }
    }
  });
});
