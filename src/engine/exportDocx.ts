// Export: apply the final decision of every revision to the redline and return a clean `.docx`
// (PRD §7.3). Rejected revisions are first rewritten so that accepting them gives the Original
// version; then one stateless accept pass resolves everything.
import { acceptAll, listRevisions } from './docxodus';
import type { RevisionListEntry } from './types';

export async function exportDocx(
  redline: Uint8Array,
  revisions: readonly RevisionListEntry[],
  finalDecision: ReadonlyMap<string, 'accept' | 'reject'>,
): Promise<Uint8Array> {
  const missing = revisions.filter((revision) => !finalDecision.has(revision.id));
  if (missing.length > 0) {
    throw new Error(`No decision for ${missing.length} revisions (first: ${missing[0]!.id}).`);
  }
  const rejected = revisions.filter((revision) => finalDecision.get(revision.id) === 'reject');
  if (rejected.length > 0) {
    // The reject rewrite of the redline XML is not implemented yet.
    throw new Error(`Rejecting changes is not supported yet (${rejected.length} rejected revisions).`);
  }

  const result = await acceptAll(redline);
  const remaining = await listRevisions(result);
  if (remaining.length > 0) {
    throw new Error(`The exported document still contains ${remaining.length} tracked revisions.`);
  }
  return result;
}
