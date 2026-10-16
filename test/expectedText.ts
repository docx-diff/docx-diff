// The text a set of decisions should give, read straight from the redline: an independent model
// of accept/reject for the round-trip tests. Text inside `w:ins`/`w:moveTo` stays when its
// revision is accepted, text inside `w:del`/`w:moveFrom` when it is rejected; a paragraph whose
// mark goes away (inserted mark rejected, deleted mark accepted) joins the next one. Same lines
// as `docxText` (whitespace-normalized, empty ones dropped). A note appears once per reference
// the body keeps (the export copies a note referenced twice), and not at all when the body lost
// its references. Formatting and table rows are not modelled (the sample has no tables).
import { DOMParser, type Document, type Element } from '@xmldom/xmldom';
import { strFromU8, unzipSync } from 'fflate';
import type { RevisionListEntry } from '../src/engine/types';
import { parseConstituentKey } from '../src/engine/ooxml';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PARTS = ['/word/document.xml', '/word/footnotes.xml', '/word/endnotes.xml'];
const MARKUP = new Set(['ins', 'del', 'moveFrom', 'moveTo']);
const NOTES: Record<string, { note: string; reference: string }> = {
  '/word/footnotes.xml': { note: 'footnote', reference: 'footnoteReference' },
  '/word/endnotes.xml': { note: 'endnote', reference: 'endnoteReference' },
};

export function expectedText(
  redline: Uint8Array,
  revisions: readonly RevisionListEntry[],
  decisions: ReadonlyMap<string, 'accept' | 'reject'>,
): string[] {
  const files = unzipSync(redline);
  const lines: string[] = [];
  /** References kept in the body, and all references in the redline, by element name and note id. */
  const keptReferences = new Map<string, number>();
  const redlineReferences = new Set<string>();
  for (const partUri of PARTS) {
    const data = files[partUri.slice(1)];
    if (!data) continue;
    const revisionOf = new Map<string, string>();
    for (const revision of revisions.filter((r) => r.partUri === partUri)) {
      for (const key of revision.constituentKeys) {
        const { localName, id } = parseConstituentKey(key);
        revisionOf.set(`${localName}:${id}`, revision.id);
      }
    }
    /** Whether the markup element's content (or paragraph mark) is in the result. */
    const kept = (element: Element): boolean => {
      const revisionId = revisionOf.get(`${element.localName}:${element.getAttributeNS(W_NS, 'id')}`);
      const decision = revisionId && decisions.get(revisionId);
      if (!decision) throw new Error(`No revision or decision for w:${element.localName} ${element.getAttributeNS(W_NS, 'id')}`);
      const inserted = element.localName === 'ins' || element.localName === 'moveTo';
      return inserted === (decision === 'accept');
    };

    const document = new DOMParser().parseFromString(strFromU8(data), 'text/xml');
    const onReference = (element: Element, isKept: boolean) => {
      const key = `${element.localName}:${element.getAttributeNS(W_NS, 'id')}`;
      redlineReferences.add(key);
      if (isKept) keptReferences.set(key, (keptReferences.get(key) ?? 0) + 1);
    };
    const notes = NOTES[partUri];
    const blocks = notes ? elementsByName(document, notes.note) : [document.documentElement!];
    for (const block of blocks) {
      const blockLines: string[] = [];
      const paragraphs = block.getElementsByTagNameNS(W_NS, 'p');
      let pending = '';
      for (let i = 0; i < paragraphs.length; i++) {
        const paragraph = paragraphs.item(i)!;
        pending += paragraphText(paragraph, kept, onReference);
        const mark = paragraphMark(paragraph);
        if (!mark || kept(mark)) {
          blockLines.push(pending);
          pending = '';
        }
      }
      blockLines.push(pending);
      let copies = 1;
      if (notes) {
        const key = `${notes.reference}:${block.getAttributeNS(W_NS, 'id')}`;
        if (redlineReferences.has(key)) copies = keptReferences.get(key) ?? 0;
      }
      for (let copy = 0; copy < copies; copy++) lines.push(...blockLines);
    }
  }
  return lines.map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function elementsByName(root: Document, localName: string): Element[] {
  const found = root.getElementsByTagNameNS(W_NS, localName);
  const list: Element[] = [];
  for (let i = 0; i < found.length; i++) list.push(found.item(i)!);
  return list;
}

function children(element: Element): Element[] {
  const list: Element[] = [];
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === child.ELEMENT_NODE) list.push(child as Element);
  }
  return list;
}

/** The paragraph mark's revision marker (`w:pPr/w:rPr/w:ins|del|moveFrom|moveTo`), if any. */
function paragraphMark(paragraph: Element): Element | undefined {
  const pPr = children(paragraph).find((child) => child.localName === 'pPr');
  const rPr = pPr && children(pPr).find((child) => child.localName === 'rPr');
  return rPr && children(rPr).find((child) => MARKUP.has(child.localName!));
}

function paragraphText(
  paragraph: Element,
  kept: (element: Element) => boolean,
  onReference: (reference: Element, kept: boolean) => void,
): string {
  let text = '';
  const walk = (element: Element, isKept: boolean) => {
    for (const node of children(element)) {
      if (node.namespaceURI !== W_NS) continue;
      const name = node.localName!;
      if (name === 'footnoteReference' || name === 'endnoteReference') onReference(node, isKept);
      if (!isKept) {
        if (name !== 'p') walk(node, false);
        continue;
      }
      if (name === 't' || name === 'delText') text += node.textContent ?? '';
      else if (name === 'tab' || name === 'br' || name === 'cr') text += ' ';
      else if (name === 'noBreakHyphen') text += '-';
      else if (MARKUP.has(name)) walk(node, kept(node));
      else if (name !== 'p' && name !== 'pPr' && name !== 'rPr') walk(node, true);
    }
  };
  walk(paragraph, true);
  return text;
}
