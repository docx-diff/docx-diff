// The headings of an input document (FR-24a), read from its own XML: the redline cannot be used,
// since the engine can drop the Edited's paragraph style from it (on the sample, the Edited's
// `Heading3` paragraphs come out with no style, the Original's `Cmsor3` recorded as the old one).
import type { Element } from '@xmldom/xmldom';
import { W_NS, readPart, unzipDocx } from './ooxml';
import type { DocumentHeading } from './types';

/** Word's outline levels are 0–8; 9 is body text. */
const BODY_TEXT_LEVEL = 9;

/**
 * The body paragraphs with an outline level (direct, or from the paragraph style and the styles it
 * is based on), in document order, as text in their accepted view; empty ones are left out.
 */
export function documentHeadings(bytes: Uint8Array): DocumentHeading[] {
  const files = unzipDocx(bytes);
  const document = readPart(files, '/word/document.xml');
  const body = document && (Array.from(document.getElementsByTagNameNS(W_NS, 'body'))[0] as Element | undefined);
  if (!body) return [];
  const styleLevel = styleOutlineLevels(files);
  const headings: DocumentHeading[] = [];
  for (const paragraph of Array.from(body.getElementsByTagNameNS(W_NS, 'p'))) {
    if (hasAncestor(paragraph, body, ['txbxContent', 'del', 'moveFrom'])) continue;
    const pPr = child(paragraph, 'pPr');
    const direct = pPr && child(pPr, 'outlineLvl')?.getAttributeNS(W_NS, 'val');
    const styleId = (pPr && child(pPr, 'pStyle')?.getAttributeNS(W_NS, 'val')) ?? null;
    const level = direct ? Number(direct) : styleLevel(styleId);
    if (!(level >= 0 && level < BODY_TEXT_LEVEL)) continue;
    const text = paragraphText(paragraph);
    if (text) headings.push({ level: level + 1, text });
  }
  return headings;
}

/** A style id (or `null`: the default paragraph style) → its outline level through `w:basedOn`, else `NaN`. */
function styleOutlineLevels(files: ReturnType<typeof unzipDocx>): (styleId: string | null) => number {
  const styles = new Map<string, Element>();
  let defaultId: string | null = null;
  const part = readPart(files, '/word/styles.xml');
  for (const style of part ? Array.from(part.getElementsByTagNameNS(W_NS, 'style')) : []) {
    if (style.getAttributeNS(W_NS, 'type') !== 'paragraph') continue;
    const id = style.getAttributeNS(W_NS, 'styleId') ?? '';
    styles.set(id, style);
    if (style.getAttributeNS(W_NS, 'default') === '1') defaultId = id;
  }
  return (styleId) => {
    const seen = new Set<string>();
    for (let id = styleId ?? defaultId; id !== null && !seen.has(id); ) {
      seen.add(id);
      const style = styles.get(id);
      if (!style) break;
      const pPr = child(style, 'pPr');
      const level = pPr && child(pPr, 'outlineLvl')?.getAttributeNS(W_NS, 'val');
      if (level) return Number(level);
      id = child(style, 'basedOn')?.getAttributeNS(W_NS, 'val') ?? null;
    }
    return NaN;
  };
}

/** The paragraph's text without deleted or moved-away runs (inputs with tracked changes are compared accepted, FR-13). */
function paragraphText(paragraph: Element): string {
  let text = '';
  for (const element of Array.from(paragraph.getElementsByTagNameNS(W_NS, '*'))) {
    const name = element.localName;
    if (name !== 't' && name !== 'tab') continue;
    if (hasAncestor(element, paragraph, ['del', 'moveFrom', 'pPr', 'rPr'])) continue;
    text += name === 't' ? (element.textContent ?? '') : ' ';
  }
  return text.replace(/\s+/g, ' ').trim();
}

function child(element: Element, localName: string): Element | undefined {
  for (let node = element.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1 && (node as Element).namespaceURI === W_NS && (node as Element).localName === localName) return node as Element;
  }
  return undefined;
}

/** Whether an element between `element` and `stop` (exclusive) is one of the `w:` names. */
function hasAncestor(element: Element, stop: Element, localNames: readonly string[]): boolean {
  for (let node = element.parentNode; node && node !== stop; node = node.parentNode) {
    if (node.nodeType === 1 && (node as Element).namespaceURI === W_NS && localNames.includes((node as Element).localName!)) return true;
  }
  return false;
}
