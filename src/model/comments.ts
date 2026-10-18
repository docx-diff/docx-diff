// Reviewer comments for the export (FR-27b): the text of the Word comment added on each commented
// change, saying what the decision was, what the change was, and the reviewer's words.
import type { ExportComment } from '../engine/types';
import type { ChangeItem } from './changes';
import type { DecisionState, FinalDecision } from './decisions';
import type { RangeClass } from './range';

/** One side of a change as comment paragraphs (`¶` separates paragraphs in the item texts). */
function sideParagraphs(text: string): string[] {
  if (text === '') return ['(nothing)'];
  const paragraphs = text.split('¶');
  while (paragraphs.length > 1 && paragraphs[paragraphs.length - 1]!.trim() === '') paragraphs.pop();
  return paragraphs.every((paragraph) => paragraph.trim() === '') ? ['(paragraph break)'] : paragraphs;
}

const DECISION_HEADINGS: Record<FinalDecision, string> = { accept: 'Accepted:', reject: 'Rejected:', track: 'Undecided:' };

/**
 * The comment's paragraphs:
 *
 *     Accepted:            (Rejected:, or Undecided: for a change kept as a tracked change)
 *
 *     Changed from
 *     <the Original's text>
 *     to
 *     <the Edited's text>
 *
 *     Comment:
 *     <the reviewer's comment>
 */
export function commentParagraphs(item: ChangeItem, decision: FinalDecision, comment: string): string[] {
  const [from, to] = item.moveEdit
    ? [item.moveEdit.from, item.moveEdit.to]
    : item.kind === 'moved'
      ? [item.text ?? '', item.text ?? '']
      : [item.removedText, item.addedText];
  return [
    DECISION_HEADINGS[decision],
    '',
    'Changed from',
    ...sideParagraphs(from),
    'to',
    ...sideParagraphs(to),
    '',
    'Comment:',
    ...comment.trim().split(/\r?\n/),
  ];
}

/**
 * The comments to export: those on text items inside the comparison range that say something, with
 * the final decision of each item (an undecided item's is the export dialog's choice).
 */
export function exportComments(
  items: readonly ChangeItem[],
  state: DecisionState,
  range: ReadonlyMap<string, RangeClass>,
  finalDecisions: ReadonlyMap<string, FinalDecision>,
): ExportComment[] {
  return items.flatMap((item) => {
    const comment = state.comments[item.id];
    if (!comment?.trim() || item.kind === 'formatting' || range.get(item.id) === 'outOfRange') return [];
    const decision = finalDecisions.get(item.revisionIds[0]!) ?? 'accept';
    return [{ revisionIds: item.revisionIds, paragraphs: commentParagraphs(item, decision, comment) }];
  });
}
