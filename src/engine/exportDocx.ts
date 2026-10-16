// Export: apply the final decision of every revision to the redline and return a clean `.docx`
// (PRD §7.3). Rejected revisions are first rewritten so that accepting them gives the Original
// version, and text from the version the formatting choice did not pick takes the chosen look
// (`consistentLook.ts`); then one stateless accept pass resolves everything, and the notes are
// matched up with their references again (`notes.ts`). In-range content the engine placed after
// the region outside the comparison range goes back before it (`rangeOrder.ts`).
import { planConsistentLook, type FormattingChoice } from './consistentLook';
import { acceptAll, listRevisions } from './docxodus';
import { reconcileNotes } from './notes';
import { planRangeOrder } from './rangeOrder';
import { UnsupportedRevisionError, rejectRevisions, type PartHook } from './rejectRewrite';
import type { RevisionListEntry } from './types';

export interface ExportOptions {
  /** Gives the export one look (FR-39a); without it, every text keeps its own version's formatting. */
  formattingChoice?: FormattingChoice;
  /** Revisions outside the comparison range (rejected; the look leaves them as they are). */
  outOfRange?: ReadonlySet<string>;
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
  const rewritten = rejected.size > 0 || hook ? rejectRevisions(redline, revisions, rejected, hook) : redline;
  const result = reconcileNotes(await acceptAll(rewritten), redline);
  const remaining = await listRevisions(result);
  if (remaining.length > 0) {
    throw new Error(`The exported document still contains ${remaining.length} tracked revisions.`);
  }
  return result;
}
