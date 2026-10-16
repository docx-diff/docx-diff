// Export: apply the final decision of every revision to the redline and return a clean `.docx`
// (PRD §7.3). Rejected revisions are first rewritten so that accepting them gives the Original
// version, and text from the version the formatting choice did not pick takes the chosen look
// (`consistentLook.ts`); then one stateless accept pass resolves everything, and the notes are
// matched up with their references again (`notes.ts`).
import { planConsistentLook, type LookOptions } from './consistentLook';
import { acceptAll, listRevisions } from './docxodus';
import { reconcileNotes } from './notes';
import { UnsupportedRevisionError, rejectRevisions } from './rejectRewrite';
import type { RevisionListEntry } from './types';

export async function exportDocx(
  redline: Uint8Array,
  revisions: readonly RevisionListEntry[],
  finalDecision: ReadonlyMap<string, 'accept' | 'reject'>,
  /** Gives the export one look; without it, every text keeps its own version's formatting. */
  look?: LookOptions,
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
  const hook = look && ((document: Parameters<typeof planConsistentLook>[0], partRevisions: readonly RevisionListEntry[]) =>
    planConsistentLook(document, partRevisions, finalDecision, look));
  const rewritten = rejected.size > 0 || hook ? rejectRevisions(redline, revisions, rejected, hook) : redline;
  const result = reconcileNotes(await acceptAll(rewritten), redline);
  const remaining = await listRevisions(result);
  if (remaining.length > 0) {
    throw new Error(`The exported document still contains ${remaining.length} tracked revisions.`);
  }
  return result;
}
