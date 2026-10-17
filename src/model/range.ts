// The comparison range for partially edited documents (FR-14 – FR-19, PRD §7.5).
// The end point is an index into `DocIndex.bodyParagraphs`: Original body paragraphs at or after
// it are outside the range. Changing it only reclassifies items; nothing is compared again.
import { deletedLastParagraph, type ChangeItem } from './changes';
import type { DocIndex } from './docIndex';
import { noteKey } from './docIndex';

export type RangeClass = 'inRange' | 'outOfRange';

/**
 * The comparison range the reviewer works with: the detected end point (`auto`), one they set
 * (`manual`), or none (`off`, the full documents). `endPoint` is `null` exactly when `mode` is `off`.
 */
export type RangeState = { mode: 'auto' | 'manual'; endPoint: number } | { mode: 'off'; endPoint: null };

/** The range a new comparison starts with: the detected end point, if any. */
export function initialRange(suggestedEndPoint: number | null): RangeState {
  return suggestedEndPoint === null ? { mode: 'off', endPoint: null } : { mode: 'auto', endPoint: suggestedEndPoint };
}

/**
 * A saved range, if it still fits the document (an end point from 1 to the last paragraph);
 * otherwise the range a new comparison starts with.
 */
export function restoredRange(saved: RangeState, paragraphCount: number, suggestedEndPoint: number | null): RangeState {
  if (saved.mode === 'off') return saved;
  const valid = (saved.mode === 'auto' || saved.mode === 'manual') && Number.isInteger(saved.endPoint) && saved.endPoint >= 1 && saved.endPoint < paragraphCount;
  return valid ? saved : initialRange(suggestedEndPoint);
}

/**
 * Position of every block on the Original's paragraph axis. An Original body paragraph sits at its
 * index in `bodyParagraphs`; a block not in the Original sits half a step after the Original
 * paragraph before it; a note paragraph sits where its note is referenced.
 *
 * Except after a trailing unedited region (`trailingStart`, from `detectTrailingRegion`): the
 * engine writes the region's deletion before the Edited's last paragraphs, so the blocks not in the
 * Original that come after the last Original paragraph belong to the end of the edited part. They
 * sit half a step before the region, inside the detected range (on the sample: the move
 * destinations and the Edited's closing note "(Átnézve eddig, …)").
 */
export function blockPositions(index: DocIndex, trailingStart: number | null = null): Map<string, number> {
  const positions = new Map<string, number>();
  let last = -1;
  for (const block of index.blocks) {
    if (block.scope !== 'body') continue;
    if (block.inOriginal) {
      last += 1;
      positions.set(block.unid, last);
    } else {
      const afterEnd = trailingStart !== null && last === index.bodyParagraphs.length - 1;
      positions.set(block.unid, afterEnd ? trailingStart - 0.5 : last + 0.5);
    }
  }
  for (const block of index.blocks) {
    if (block.scope === 'body' || block.noteId === undefined) continue;
    const ref = index.noteRefs.get(noteKey(block.scope, block.noteId));
    const position = ref === undefined ? undefined : positions.get(ref);
    if (position !== undefined) positions.set(block.unid, position);
  }
  return positions;
}

/**
 * The proposed end point, when the last Original body paragraph is wholly deleted: the first
 * wholly deleted Original paragraph of the body deletion that covers it, or `null` when there is
 * none. A deletion that only touches the last paragraph (a word deleted from it) is an ordinary
 * edit. When the deletion starts within a paragraph the Edited document keeps part of, the end
 * point is the next paragraph; the deletion then spans it and is outside the range as a whole.
 * The deletion need not be the last item (on the sample, small paragraph-mark inserts and a
 * formatting change follow it).
 */
export function detectTrailingRegion(items: readonly ChangeItem[], index: DocIndex): number | null {
  const lastParagraph = deletedLastParagraph(index);
  if (lastParagraph === undefined) return null;
  const tail = items.find(
    (item) =>
      item.kind === 'deleted' &&
      (item.location.scope === 'body' || item.location.scope === 'table') &&
      item.anchors.includes(lastParagraph),
  );
  if (!tail) return null;
  const paragraphIndex = new Map(index.bodyParagraphs.map((unid, i) => [unid, i]));
  const starts = tail.anchors
    .filter((unid) => index.blockByUnid.get(unid)?.inEdited === false)
    .map((unid) => paragraphIndex.get(unid))
    .filter((i) => i !== undefined);
  const start = Math.min(...starts);
  // A deletion of the whole document is not a trailing region.
  return start > 0 ? start : null;
}

/**
 * Classifies items against an end point (`null` = no range: everything is in range). An item is
 * outside the range when any of its anchors lies at or after the end point, so an item spanning
 * the end point is outside; note items follow the paragraph that references the note. A move
 * counts by its source alone: a move from before the end point is the editor's work even when the
 * engine placed its destination after the end point (on the sample, after the deleted tail), and
 * the export puts that destination back before the region outside (`rangeOrder.ts`). Items without
 * a known position (e.g. section properties) stay in range.
 */
export function classify(
  items: readonly ChangeItem[],
  index: DocIndex,
  endPoint: number | null,
  positions: Map<string, number> = blockPositions(index, detectTrailingRegion(items, index)),
): Map<string, RangeClass> {
  const result = new Map<string, RangeClass>();
  for (const item of items) {
    const out =
      endPoint !== null &&
      rangeAnchors(item, index).some((unid) => {
        const position = positions.get(unid);
        return position !== undefined && position >= endPoint;
      });
    result.set(item.id, out ? 'outOfRange' : 'inRange');
  }
  return result;
}

/** The anchors that place an item: all of them, except for a move only those of its source. */
function rangeAnchors(item: ChangeItem, index: DocIndex): readonly string[] {
  if (item.kind !== 'moved') return item.anchors;
  return item.anchors.filter((unid) => index.blockByUnid.get(unid)?.inOriginal !== false);
}

/**
 * The items outside the range that also have content before the end point (a deletion that starts
 * before it and continues after it): they are outside as a whole, so the reviewer should be told
 * (PRD §7.5). Moves are placed by their source alone and never span.
 */
export function spanningItems(
  items: readonly ChangeItem[],
  index: DocIndex,
  endPoint: number | null,
  classes: ReadonlyMap<string, RangeClass>,
  positions: Map<string, number> = blockPositions(index, detectTrailingRegion(items, index)),
): ChangeItem[] {
  if (endPoint === null) return [];
  return items.filter(
    (item) =>
      item.kind !== 'moved' &&
      classes.get(item.id) === 'outOfRange' &&
      item.anchors.some((unid) => {
        const position = positions.get(unid);
        return position !== undefined && position < endPoint;
      }),
  );
}

/**
 * The blocks outside the range: Original body paragraphs at or after the end point, and the note
 * paragraphs of notes referenced only from there. For the Original's panel, where these positions
 * hold (blocks the Original lacks are not shown there).
 */
export function outOfRangeBlocks(index: DocIndex, endPoint: number | null, positions: Map<string, number> = blockPositions(index)): Set<string> {
  const blocks = new Set<string>();
  if (endPoint === null) return blocks;
  for (const block of index.blocks) {
    if (!block.inOriginal) continue;
    const position = positions.get(block.unid);
    if (position !== undefined && position >= endPoint) blocks.add(block.unid);
  }
  return blocks;
}
