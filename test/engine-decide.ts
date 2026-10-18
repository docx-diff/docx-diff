// The engine's own decisions, as references for the export's: one revision decided by a
// `DocxSession` (slow, so only for tiny documents), and the text parts' XML for comparing two exports.
import { strFromU8, unzipSync } from 'fflate';
import { docxDiffRejectRevisions, openDocxSession } from 'docxodus/core';
import { acceptAll } from '../src/engine/docxodus';
import { reconcileNotes } from '../src/engine/notes';

export type Decision = 'accept' | 'reject';

export const TEXT_PARTS = ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml'];

/**
 * The text parts' XML, for comparing two exports: namespace declarations, rsids, the space in
 * `<w:b />` (.NET writes one, xmldom doesn't) and empty property containers (`<w:rPr/>` ≡ no
 * `w:rPr`) are left out.
 */
export function partsXml(bytes: Uint8Array): string[] {
  const files = unzipSync(bytes, { filter: (file) => TEXT_PARTS.includes(file.name) });
  return TEXT_PARTS.map((part) =>
    files[part]
      ? strFromU8(files[part])
          .replace(/ xmlns:\w+="[^"]*"/g, '')
          .replace(/ w:rsid\w*="[^"]*"/g, '')
          .replace(/ \/>/g, '/>')
          .replace(/<w:(rPr|pPr|trPr|tcPr|tblPrEx)\/>/g, '')
      : '',
  );
}

/**
 * The engine's own way to decide one revision differently from the rest: a session decides it
 * (slow, so only for these tiny documents), then a stateless pass resolves the others. The
 * export's note reconciliation is applied to it too.
 */
export async function engineDecideOne(redline: Uint8Array, revisionId: string, decision: Decision): Promise<Uint8Array> {
  const session = openDocxSession(redline);
  try {
    const result = decision === 'reject' ? session.rejectRevision(revisionId) : session.acceptRevision(revisionId);
    if (!result.success) throw new Error(`session ${decision} of ${revisionId} failed: ${JSON.stringify(result.error)}`);
    const decidedOne = session.save();
    const resolved = decision === 'reject' ? await acceptAll(decidedOne) : await docxDiffRejectRevisions(decidedOne);
    return reconcileNotes(resolved, redline);
  } finally {
    session.close();
  }
}

