// The comparison range for partially edited documents (FR-14 – FR-19, PRD §7.5).
// The end point is an index into `DocIndex.bodyParagraphs`: Original body paragraphs at or after
// it are outside the range. Changing it only reclassifies items; nothing is compared again.
import { deletedLastParagraph, type ChangeItem } from './changes';
import type { DocIndex } from './docIndex';
import { noteKey } from './docIndex';

export type RangeClass = 'inRange' | 'outOfRange';

/**
 * Position of every block on the Original's paragraph axis. An Original body paragraph sits at its
 * index in `bodyParagraphs`; a block not in the Original sits half a step after the Original
 * paragraph before it; a note paragraph sits where its note is referenced.
 */
export function blockPositions(index: DocIndex): Map<string, number> {
  const positions = new Map<string, number>();
  let last = -1;
  for (const block of index.blocks) {
    if (block.scope !== 'body') continue;
    if (block.inOriginal) {
      last += 1;
      positions.set(block.unid, last);
    } else {
      positions.set(block.unid, last + 0.5);
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
 * the end point is outside; note items follow the paragraph that references the note. Items
 * without a known position (e.g. section properties) stay in range.
 */
export function classify(
  items: readonly ChangeItem[],
  index: DocIndex,
  endPoint: number | null,
  positions: Map<string, number> = blockPositions(index),
): Map<string, RangeClass> {
  const result = new Map<string, RangeClass>();
  for (const item of items) {
    const out =
      endPoint !== null &&
      item.anchors.some((unid) => {
        const position = positions.get(unid);
        return position !== undefined && position >= endPoint;
      });
    result.set(item.id, out ? 'outOfRange' : 'inRange');
  }
  return result;
}
