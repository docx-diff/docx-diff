// Checks the block ↔ `w:p` mapping (`src/engine/blockKey.ts`) on a compare result.
import { JSDOM } from 'jsdom';
import { paragraphUnids } from '../src/engine/blockKey';
import { readPart, unzipDocx } from '../src/engine/ooxml';

const SCOPE_PARTS: Record<string, string> = { body: '/word/document.xml', fn: '/word/footnotes.xml', en: '/word/endnotes.xml' };

/**
 * The rendered paragraph blocks whose `data-anchor` names no `w:p` of their scope's part, e.g.
 * `p:body:<unid> "text…"`; expected empty. Tables, rows and cells carry anchors too and are skipped.
 * Also returns how many blocks were checked.
 */
export async function unmappedBlocks(redline: Uint8Array, html: string): Promise<{ checked: number; unmapped: string[] }> {
  const files = unzipDocx(redline);
  const unids = new Map<string, Set<string>>();
  for (const [scope, partUri] of Object.entries(SCOPE_PARTS)) {
    const part = readPart(files, partUri);
    unids.set(scope, new Set(part ? (await paragraphUnids(part)).keys() : []));
  }
  const document = new JSDOM(html).window.document;
  const unmapped: string[] = [];
  let checked = 0;
  for (const block of document.querySelectorAll<HTMLElement>('[data-anchor]:not(table, tr, td)')) {
    checked++;
    const source = block.dataset.sourceAnchorId ?? '';
    if (!unids.get(source.split(':')[1] ?? '')?.has(block.dataset.anchor!)) {
      unmapped.push(`${source} ${JSON.stringify(block.textContent?.slice(0, 40))}`);
    }
  }
  return { checked, unmapped };
}
