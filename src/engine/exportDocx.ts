// Export: apply the final decision of every revision to the redline and return a clean `.docx`
// (docs/architecture.md). Rejected revisions are first rewritten so that accepting them gives the
// Original version, and text from the version the formatting choice did not pick takes the chosen
// look (`consistentLook.ts`); then one stateless accept pass resolves everything, and the notes are
// matched up with their references again (`notes.ts`). In-range content the engine placed after the
// region outside the comparison range goes back before it (`rangeOrder.ts`). Reviewer comments are
// anchored on their changes before the rewrite and added after the accept pass (`comments.ts`).
import { addComments, anchorComments } from './comments';
import { planConsistentLook, type FormattingChoice } from './consistentLook';
import { acceptAll, listRevisions } from './docxodus';
import { reconcileNotes } from './notes';
import { unzipDocx, zipDocx } from './ooxml';
import { planRangeOrder } from './rangeOrder';
import { UnsupportedRevisionError, rejectRevisions, type PartHook } from './rejectRewrite';
import type { ExportComment, RevisionListEntry } from './types';

export interface ExportOptions {
  /** Gives the export one look (FR-39a); without it, every text keeps its own version's formatting. */
  formattingChoice?: FormattingChoice;
  /** Revisions outside the comparison range (rejected; the look leaves them as they are). */
  outOfRange?: ReadonlySet<string>;
  /** Reviewer comments, added as Word comments on their changes (FR-27b). */
  comments?: readonly ExportComment[];
  /** The comments' date (ISO); default now. */
  date?: string;
  /** Told the revisions of comments placed at the end of the document, having lost their place. */
  onCommentsRelocated?: (revisionIds: string[][]) => void;
}

export async function exportDocx(
  redline: Uint8Array,
  revisions: readonly RevisionListEntry[],
  finalDecision: ReadonlyMap<string, 'accept' | 'reject'>,
  options: ExportOptions = {},
): Promise<Uint8Array> {
  const missing = revisions.filter((revision) => !finalDecision.has(revision.id));
  if (missing.length > 0) {
    throw new Error(`No decision for ${missing.length} revisions (first: ${missing[0]!.id}).`);
  }
  const unsupported = revisions.find((revision) => revision.resolutionStatus !== 'supported');
  if (unsupported) {
    throw new UnsupportedRevisionError(unsupported.id, unsupported.family, `the engine reports it as ${unsupported.resolutionStatus}`);
  }

  const rejected = new Set(revisions.filter((revision) => finalDecision.get(revision.id) === 'reject').map((revision) => revision.id));
  const { formattingChoice, outOfRange = new Set<string>() } = options;
  const anchored = options.comments?.length ? anchorComments(redline, revisions, options.comments, finalDecision) : { redline, comments: [] };
  const hooks: PartHook[] = [];
  if (formattingChoice) hooks.push((document, partRevisions) => planConsistentLook(document, partRevisions, finalDecision, { formattingChoice, outOfRange }));
  if (outOfRange.size > 0) hooks.push((document, partRevisions) => planRangeOrder(document, partRevisions, finalDecision, outOfRange));
  const hook: PartHook | undefined =
    hooks.length === 0
      ? undefined
      : (document, partRevisions) => {
          const after = hooks.map((plan) => plan(document, partRevisions));
          return () => after.forEach((apply) => apply());
        };
  const rewritten = rejected.size > 0 || hook ? rejectRevisions(anchored.redline, revisions, rejected, hook) : anchored.redline;
  let result = reconcileNotes(await acceptAll(rewritten), redline);
  if (anchored.comments.length > 0) {
    const files = unzipDocx(result);
    const relocated = addComments(files, anchored.comments, options.date ?? new Date().toISOString().replace(/\.\d+Z$/, 'Z'));
    if (relocated.length > 0) options.onCommentsRelocated?.(relocated.map((comment) => comment.revisionIds));
    result = zipDocx(files);
  }
  const remaining = await listRevisions(result);
  if (remaining.length > 0) {
    throw new Error(`The exported document still contains ${remaining.length} tracked revisions.`);
  }
  return result;
}
