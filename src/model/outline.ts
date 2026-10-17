// The document outline (FR-24a): the Edited's headings, or the Original's when the Edited has none,
// each placed on its block of the rendered redline. The headings come from the input documents
// (`src/engine/headings.ts`), not from the redline's `h1`–`h6`: the engine can drop the Edited's
// paragraph style from the redline. A heading is matched, in document order, to the next body
// paragraph whose text in that version is the heading's text.
import type { DocumentHeading } from '../engine/types';
import { NOT_TEXT } from './docIndex';

export interface OutlineEntry {
  /** The heading's block (`data-anchor`): the same block in both panels. */
  unid: string;
  /** 1–9. */
  level: number;
  text: string;
  /** The block has text in the Original / in the Edited. */
  inOriginal: boolean;
  inEdited: boolean;
}

/** Text that is not a paragraph's wording: rendering aids, list labels and note references. */
const NOT_PARAGRAPH_TEXT = `${NOT_TEXT}, a.footnote-ref, a.endnote-ref`;
/** Content the Original lacks, and the class of a paragraph mark it lacks; likewise for the Edited. */
const MISSING = {
  original: { content: 'ins, .rev-move-to', paragraphMark: 'rev-para-ins' },
  edited: { content: 'del, .rev-move-from', paragraphMark: 'rev-para-del' },
};
/** `NodeFilter.SHOW_TEXT`; `NodeFilter` is not a global when the document comes from jsdom in Node tests. */
const SHOW_TEXT = 0x4;

interface Paragraph {
  unid: string;
  original: string;
  edited: string;
  /** In each version, the paragraph continues in the next one (its mark is missing there). */
  joined: { original: boolean; edited: boolean };
}

export function buildOutline(root: ParentNode, headings: { original: readonly DocumentHeading[]; edited: readonly DocumentHeading[] }): OutlineEntry[] {
  const version = headings.edited.length > 0 ? 'edited' : 'original';
  const paragraphs: Paragraph[] = [];
  for (const block of root.querySelectorAll<HTMLElement>(':is(p, h1, h2, h3, h4, h5, h6)[data-anchor]')) {
    if (block.closest('li[id^="fn-"], li[id^="en-"]')) continue;
    paragraphs.push({
      unid: block.dataset.anchor!,
      original: paragraphText(block, MISSING.original.content),
      edited: paragraphText(block, MISSING.edited.content),
      joined: {
        original: block.classList.contains(MISSING.original.paragraphMark),
        edited: block.classList.contains(MISSING.edited.paragraphMark),
      },
    });
  }

  const entries: OutlineEntry[] = [];
  let next = 0;
  for (const heading of headings[version]) {
    const at = findParagraph(paragraphs, next, heading.text, version);
    // Not found (text the HTML shows differently): left out, and later headings still match.
    if (at === -1) continue;
    const paragraph = paragraphs[at]!;
    entries.push({
      unid: paragraph.unid,
      level: heading.level,
      text: heading.text,
      inOriginal: paragraph.original !== '',
      inEdited: paragraph.edited !== '',
    });
    next = at + 1;
  }
  return entries;
}

/**
 * The first paragraph from `from` with the heading's text in that version; or one that starts it
 * and continues in the next paragraph (two paragraphs joined into the heading).
 */
function findParagraph(paragraphs: readonly Paragraph[], from: number, text: string, version: 'original' | 'edited'): number {
  for (let i = from; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i]!;
    const own = paragraph[version];
    if (own === text || (own !== '' && paragraph.joined[version] && text.startsWith(own))) return i;
  }
  return -1;
}

function paragraphText(block: HTMLElement, missing: string): string {
  let text = '';
  const walker = block.ownerDocument.createTreeWalker(block, SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest(NOT_PARAGRAPH_TEXT) || parent.closest(missing)) continue;
    text += node.textContent ?? '';
  }
  return text.replace(/\s+/g, ' ').trim();
}
