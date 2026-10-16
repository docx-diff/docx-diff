// Footnote and endnote references after the export's accept pass. Decisions can separate a
// note's reference from its content: the engine reports a reference that moved to another
// paragraph as a deletion plus an insertion of the same note id, so rejecting one and accepting
// the other leaves the note referenced twice (which fails package verification), or not at all
// (an orphan note, which the engine's own reject removes). And accepting the deletion of a note's
// whole text while keeping its reference leaves a note without paragraphs, which the schema
// does not allow.
import type { Document, Element } from '@xmldom/xmldom';
import { W_NS, readPart, unzipDocx, writePart, zipDocx } from './ooxml';

const KINDS = [
  { reference: 'footnoteReference', note: 'footnote', part: '/word/footnotes.xml' },
  { reference: 'endnoteReference', note: 'endnote', part: '/word/endnotes.xml' },
] as const;

const DOCUMENT_PART = '/word/document.xml';
const W14_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';

/**
 * Gives a referenced note without paragraphs an empty one (with the paragraph style the note had
 * in the redline), every extra reference to a note its own copy of the note, and removes the
 * notes that the redline referenced but the export no longer does. Returns the same bytes when
 * nothing changes.
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
    const notes = new Map(elements(notesDocument, kind.note).map((note) => [note.getAttributeNS(W_NS, 'id') ?? '', note]));
    const references = elements(document, kind.reference);
    let partChanged = false;

    const referenced = new Set(references.map((reference) => reference.getAttributeNS(W_NS, 'id') ?? ''));
    for (const [id, note] of notes) {
      if (!referenced.has(id) || elements(note, 'p').length > 0 || elements(note, 'tbl').length > 0) continue;
      note.appendChild(emptyParagraph(notesDocument, redlineNoteStyle(redlineFiles, kind, id)));
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

/** The paragraph style of the note's first paragraph in the redline. */
function redlineNoteStyle(files: ReturnType<typeof unzipDocx>, kind: (typeof KINDS)[number], id: string): string | null {
  const notesDocument = readPart(files, kind.part);
  const note = notesDocument && elements(notesDocument, kind.note).find((n) => n.getAttributeNS(W_NS, 'id') === id);
  const style = note && elements(note, 'pStyle')[0];
  return style ? style.getAttributeNS(W_NS, 'val') : null;
}

function emptyParagraph(document: Document, style: string | null): Element {
  const paragraph = document.createElementNS(W_NS, 'w:p');
  if (style) {
    const pPr = document.createElementNS(W_NS, 'w:pPr');
    const pStyle = document.createElementNS(W_NS, 'w:pStyle');
    pStyle.setAttributeNS(W_NS, 'w:val', style);
    pPr.appendChild(pStyle);
    paragraph.appendChild(pPr);
  }
  return paragraph;
}

function elements(root: Document | Element, localName: string): Element[] {
  const found = root.getElementsByTagNameNS(W_NS, localName);
  const list: Element[] = [];
  for (let i = 0; i < found.length; i++) list.push(found.item(i)!);
  return list;
}
