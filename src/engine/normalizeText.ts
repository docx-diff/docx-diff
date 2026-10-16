// Unicode normalization of the inputs before comparing. The engine matches words by their exact
// code points, so "ā" typed as "a" + combining macron (as some macOS input methods do) differs
// from the precomposed "ā". Text runs are rewritten to NFC, which renders the same.
import { W_NS, readPart, unzipDocx, writePart, zipDocx, partPath } from './ooxml';

const TEXT_PARTS = ['/word/document.xml', '/word/footnotes.xml', '/word/endnotes.xml'];
const TEXT_ELEMENTS = ['t', 'delText', 'instrText', 'delInstrText'];

/** The document with every text run in NFC; the same bytes when nothing needed normalizing. */
export function normalizeDocxText(bytes: Uint8Array): Uint8Array {
  const files = unzipDocx(bytes);
  let changed = false;
  for (const partUri of TEXT_PARTS) {
    const data = files[partPath(partUri)];
    if (!data) continue;
    const xml = new TextDecoder().decode(data);
    if (xml === xml.normalize('NFC')) continue;
    const document = readPart(files, partUri)!;
    for (const name of TEXT_ELEMENTS) {
      const elements = document.getElementsByTagNameNS(W_NS, name);
      for (let i = 0; i < elements.length; i++) {
        for (let node = elements[i]!.firstChild; node; node = node.nextSibling) {
          if (node.nodeType !== node.TEXT_NODE) continue;
          const text = node.nodeValue ?? '';
          const normalized = text.normalize('NFC');
          if (normalized !== text) {
            node.nodeValue = normalized;
            (node as unknown as { data: string }).data = normalized;
            changed = true;
          }
        }
      }
    }
    writePart(files, partUri, document);
  }
  return changed ? zipDocx(files) : bytes;
}
