import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { smallComparison as comparison } from '../../test/small-comparison';
import { buildOutline } from '../model/outline';
import { readBlockSegments } from './blockSegments';
import { EditSession, useEdits } from './useEdits';

const block = (session: EditSession, unid: string) => session.comparison.document.body.querySelector(`[data-anchor="${unid}"]`)!;
const summary = (session: EditSession) => session.items.map((item) => `${item.order} ${item.id} ${item.kind} -${item.removedText} +${item.addedText}`);

describe('EditSession', () => {
  it('makes a new item of an edit between decided changes and leaves those as they were (the [big] red [house] example)', () => {
    const session = new EditSession(comparison());
    const [big, house] = session.items;
    const update = session.update('p', 'the big blue house', 'the big blue'.length)!;
    expect(summary(session)).toEqual(['0 r1 inserted - +big ', '1 ep.1 replaced -red +blue', '2 r2 inserted - +house', '3 r3 replaced -home +hosue']);
    expect(session.items[0]).toBe(big);
    expect(session.items[2]).toEqual({ ...house, order: 2 });
    expect(update).toMatchObject({ unid: 'p', removedItemIds: [], addedItemIds: ['ep.1'], createdItemIds: ['ep.1'] });
    expect(update.block).toBe(block(session, 'p'));
    expect(readBlockSegments(update.block)).toEqual(session.blocks.get('p')!.current);
    expect(update.block.querySelector('del[data-change-id="ep.1"]')!.textContent).toBe('red');
    expect(session.itemTexts.get('ep.1')).toEqual({ before: 'the red ', after: 'the blue ', paragraphMark: false });
    expect(session.index.revisionsInHtml.has('ep.2')).toBe(true);
    expect(session.isEdited('p')).toBe(true);
  });

  it('keeps a typo fixed inside an insertion in its item, and drops an item whose Original is typed back', () => {
    const session = new EditSession(comparison());
    const fixed = session.update('q', 'The house stood.')!;
    expect(fixed).toMatchObject({ addedItemIds: [], createdItemIds: [], removedItemIds: [] });
    expect(summary(session)[2]).toBe('2 r3 replaced -home +house');
    expect(session.itemTexts.get('r3')).toEqual({ before: 'The home stood.', after: 'The house stood.', paragraphMark: false });
    const typedBack = session.update('q', 'The home stood.')!;
    expect(typedBack.removedItemIds).toEqual(['r3']);
    expect(session.items.map((item) => item.id)).toEqual(['r1', 'r2']);
    expect(session.itemTexts.has('r3')).toBe(false);
    expect(block(session, 'q').textContent).toBe('The home stood.');
  });

  it('reverts a block to the comparison’s items and markup, and lists the edits for the export until then', () => {
    const fresh = comparison();
    const originalMarkup = fresh.document.body.querySelector('[data-anchor="p"]')!.outerHTML;
    const session = new EditSession(fresh);
    expect(session.update('p', 'the big blue house', 'the big blue'.length)).not.toBeNull();
    expect(session.revisions().map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4', 'ep.1', 'ep.2']);
    expect(session.patches()).toEqual([{ unid: 'p', scope: 'body', segments: session.blocks.get('p')!.current }]);
    const reverted = session.revert('p')!;
    expect(reverted.removedItemIds).toEqual(['ep.1']);
    expect(session.items).toEqual(fresh.analysis.items);
    expect(block(session, 'p').outerHTML).toBe(originalMarkup);
    expect(session.revisions()).toBe(fresh.result.revisions);
    expect(session.patches()).toEqual([]);
    expect(session.revert('p')).toBeNull();
    // Ids go on counting: a later edit's items never take an earlier one's id (and its decision).
    session.update('p', 'the big green house', 'the big green'.length);
    expect(session.items[1]!.id).toBe('ep.3');
  });

  it('restores saved edits with the same items and ids, none of them created, and skips records that don’t match', () => {
    const live = new EditSession(comparison());
    live.update('p', 'the big blue house', 'the big blue'.length);
    live.update('q', 'The house stood.');
    const saved = [...live.blocks.values()];
    const replay = new EditSession(comparison());
    const { updates, skipped } = replay.restore([...saved, { ...saved[0]!, unid: 'missing' }, { ...saved[1]!, original: [{ kind: 'equal', text: 'Other' }] }]);
    expect(skipped).toBe(2);
    expect(updates.flatMap((update) => update.createdItemIds)).toEqual([]);
    expect(replay.items).toEqual(live.items);
    expect(replay.blocks.get('p')!.nextId).toBe(3);
  });

  it('gives an edited heading its new text, so that the outline keeps it', () => {
    const session = new EditSession(comparison());
    session.update('h', 'The old forest monastery', 'The old forest'.length);
    expect(session.headings.edited).toEqual([{ level: 1, text: 'The old forest monastery' }]);
    expect(buildOutline(session.comparison.document.body, session.headings).map((entry) => [entry.unid, entry.text])).toEqual([['h', 'The old forest monastery']]);
    expect(buildOutline(session.comparison.document.body, session.comparison.result.headings)).toEqual([]);
  });
});

describe('useEdits', () => {
  it('re-renders with the live values after an update, and starts over with a new comparison', () => {
    const first = comparison();
    const { result, rerender } = renderHook(({ c }) => useEdits(c), { initialProps: { c: first } });
    expect(result.current.items).toBe(first.analysis.items);
    act(() => void result.current.update('p', 'the big blue house', 'the big blue'.length));
    expect(result.current.items!.map((item) => item.id)).toEqual(['r1', 'ep.1', 'r2', 'r3']);
    expect(result.current.version).toBe(1);
    const second = comparison();
    rerender({ c: second });
    expect(result.current.items).toBe(second.analysis.items);
    expect(result.current.version).toBe(0);
  });
});
