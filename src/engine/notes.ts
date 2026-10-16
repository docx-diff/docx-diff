// Footnote and endnote references after the export's accept pass. Decisions can separate a
// note's reference from its content: the engine reports a reference that moved to another
// paragraph as a deletion plus an insertion of the same note id, so rejecting one and accepting
// the other leaves the note referenced twice (which fails package verification), or not at all
// (an orphan note, which the engine's own reject removes). And accepting the deletion of a note's
// whole text (with its number) while keeping its reference leaves a note without its number, or
// without paragraphs, which the schema does not allow. The change items keep a note that only one
// version has together with its reference (`foldWholeNotes` in src/model/changes.ts), so these
// cases need decisions made per revision; the repairs here keep any export valid.
import type { Document, Element } from '@xmldom/xmldom';
import { W_NS, readPart, unzipDocx, writePart, zipDocx } from './ooxml';

const KINDS = [
  { reference: 'footnoteReference', note: 'footnote', mark: 'footnoteRef', part: '/word/footnotes.xml' },
  { reference: 'endnoteReference', note: 'endnote', mark: 'endnoteRef', part: '/word/endnotes.xml' },
] as const;

const DOCUMENT_PART = '/word/document.xml';
const W14_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';

/**
 * Gives a referenced note that lost its number (`w:footnoteRef`/`w:endnoteRef`) the number back,
 * as in the redline, and one without paragraphs a paragraph for it; gives every extra reference to
 * a note its own copy of the note; and removes the notes that the redline referenced but the
 * export no longer does. Returns the same bytes when nothing changes.
 */
export function reconcileNotes(exported: Uint8Array, redline: Uint8Array): Uint8Array {
  const files = unzipDocx(exported);
  const document = readPart(files, DOCUMENT_PART);
  if (!document) return exported;
  const redlineFiles = unzipDocx(redline);
  const redlineDocument = readPart(redlineFiles, DOCUMENT_PART);
  let changed = false;

  for (const kind of KINDS) {
    const notesDocument = readPart(files, kind.part);
    if (!notesDocument) continue;
    const redlineNotes = readPart(redlineFiles, kind.part);
    const notes = new Map(elements(notesDocument, kind.note).map((note) => [note.getAttributeNS(W_NS, 'id') ?? '', note]));
    const references = elements(document, kind.reference);
    let partChanged = false;

    const referenced = new Set(references.map((reference) => reference.getAttributeNS(W_NS, 'id') ?? ''));
    for (const [id, note] of notes) {
      if (!referenced.has(id) || elements(note, kind.mark).length > 0) continue;
      const redlineNote = redlineNotes && elements(redlineNotes, kind.note).find((n) => n.getAttributeNS(W_NS, 'id') === id);
      const firstParagraph = elements(note, 'p')[0];
      if (firstParagraph) {
        if (!redlineNote || elements(redlineNote, kind.mark).length === 0) continue;
        const pPr = childElements(firstParagraph).find((child) => child.namespaceURI === W_NS && child.localName === 'pPr');
        firstParagraph.insertBefore(numberRun(notesDocument, kind, redlineNote), pPr ? pPr.nextSibling : firstParagraph.firstChild);
      } else if (elements(note, 'tbl').length === 0) {
        note.appendChild(emptyParagraph(notesDocument, kind, redlineNote));
      } else {
        continue;
      }
      partChanged = true;
    }

    let nextId = Math.max(0, ...[...notes.keys()].map(Number).filter(Number.isFinite)) + 1;
    const seen = new Set<string>();
    for (const reference of references) {
      const id = reference.getAttributeNS(W_NS, 'id') ?? '';
      const note = notes.get(id);
      if (!seen.has(id) || !note) {
        seen.add(id);
        continue;
      }
      const copy = note.cloneNode(true) as Element;
      copy.setAttributeNS(W_NS, 'w:id', String(nextId));
      // Paragraph ids must stay unique; Word assigns new ones.
      for (const paragraph of elements(copy, 'p')) {
        paragraph.removeAttributeNS(W14_NS, 'paraId');
        paragraph.removeAttributeNS(W14_NS, 'textId');
      }
      note.parentNode!.insertBefore(copy, note.nextSibling);
      reference.setAttributeNS(W_NS, 'w:id', String(nextId));
      nextId++;
      partChanged = true;
    }

    const referencedBefore = new Set(redlineDocument ? elements(redlineDocument, kind.reference).map((r) => r.getAttributeNS(W_NS, 'id')) : []);
    for (const [id, note] of notes) {
      if (referencedBefore.has(id) && !seen.has(id)) {
        note.parentNode!.removeChild(note);
        partChanged = true;
      }
    }

    if (partChanged) {
      writePart(files, kind.part, notesDocument);
      changed = true;
    }
  }

  if (!changed) return exported;
  writePart(files, DOCUMENT_PART, document);
  return zipDocx(files);
}

/**
 * A note paragraph with the paragraph style of the note in the redline, and its number if the
 * redline note has one.
 */
function emptyParagraph(document: Document, kind: (typeof KINDS)[number], redlineNote: Element | undefined): Element {
  const paragraph = document.createElementNS(W_NS, 'w:p');
  const style = redlineNote && elements(redlineNote, 'pStyle')[0]?.getAttributeNS(W_NS, 'val');
  if (style) {
    const pPr = document.createElementNS(W_NS, 'w:pPr');
    const pStyle = document.createElementNS(W_NS, 'w:pStyle');
    pStyle.setAttributeNS(W_NS, 'w:val', style);
    pPr.appendChild(pStyle);
    paragraph.appendChild(pPr);
  }
  if (redlineNote && elements(redlineNote, kind.mark).length > 0) paragraph.appendChild(numberRun(document, kind, redlineNote));
  return paragraph;
}

/** A run with the note number, with the run properties of the number in the redline note. */
function numberRun(document: Document, kind: (typeof KINDS)[number], redlineNote: Element): Element {
  const run = document.createElementNS(W_NS, 'w:r');
  const markRun = elements(redlineNote, kind.mark)[0]?.parentNode as Element | undefined;
  const rPr = markRun && childElements(markRun).find((child) => child.namespaceURI === W_NS && child.localName === 'rPr');
  if (rPr) {
    const copy = document.importNode(rPr, true) as Element;
    // The redline's tracked formatting change of the number is not part of the export.
    for (const change of childElements(copy).filter((child) => child.localName === 'rPrChange')) copy.removeChild(change);
    run.appendChild(copy);
  }
  run.appendChild(document.createElementNS(W_NS, `w:${kind.mark}`));
  return run;
}

function childElements(element: Element): Element[] {
  const children: Element[] = [];
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === child.ELEMENT_NODE) children.push(child as Element);
  }
  return children;
}

function elements(root: Document | Element, localName: string): Element[] {
  const found = root.getElementsByTagNameNS(W_NS, localName);
  const list: Element[] = [];
  for (let i = 0; i < found.length; i++) list.push(found.item(i)!);
  return list;
}
