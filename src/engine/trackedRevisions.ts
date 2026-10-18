// Undecided changes exported as Word tracked changes (FR-38b). The engine's accept pass resolves
// every revision it finds and fails on markup it does not know, so the revisions to keep are
// *parked* before it: their content stays as plain text (inserted and deleted text alike, as in
// Word's markup view) between a pair of bookmarks, and markers without content (paragraph marks,
// table rows, move ranges) become empty bookmark pairs at their place. The accept pass keeps
// bookmarks and the text between them; `restoreRevisions` then puts the markup back, with the
// export's author and date. Works on @xmldom/xmldom documents, since it runs in the worker.
import type { Document, Element, Node } from '@xmldom/xmldom';
import { ElementIndex, W_NS, parseConstituentKey, readPart, unzipDocx, writePart, zipDocx } from './ooxml';
import { RevisionMarkupError, UnsupportedRevisionError } from './rejectRewrite';
import type { RevisionListEntry } from './types';

/** The bookmark names of parked markup: `_DDK<n>` (Word hides bookmarks starting with `_`). */
const TOKEN_PREFIX = '_DDK';

/** Run-level markup: the content between the bookmarks goes back inside it. */
const WRAPPERS = new Set(['ins', 'del', 'moveFrom', 'moveTo']);
/** Wrappers whose text is deleted text (`w:delText`, `w:delInstrText`). */
const DELETED = new Set(['del', 'moveFrom']);
const RANGE_MARKERS = new Set(['moveFromRangeStart', 'moveFromRangeEnd', 'moveToRangeStart', 'moveToRangeEnd']);
/** The revision markers a paragraph mark's `w:rPr` starts with, in schema order. */
const PARAGRAPH_MARKS = ['ins', 'del', 'moveFrom', 'moveTo'];
/** The row markers `w:trPr` ends with (before `w:trPrChange`), in schema order. */
const ROW_MARKS = ['ins', 'del'];

type Placement = 'wrapper' | 'paragraphMark' | 'rowMark' | 'rangeMarker';

interface ParkedElement {
  revisionId: string;
  partUri: string;
  placement: Placement;
  localName: string;
  /** The element's attributes as `[namespace, qualified name, value]`. */
  attributes: [string | null, string, string][];
}

/** What `parkRevisions` took out, by bookmark name. */
export type ParkedRevisions = Map<string, ParkedElement>;

/**
 * Which final decision leaves a tracked revision's content in the document, for the steps that
 * plan with decisions (the look, the range order, the comment anchors): accepting an insertion or a
 * move, rejecting a deletion.
 */
export function presentDecision(revision: Pick<RevisionListEntry, 'constituentKeys'>): 'accept' | 'reject' {
  const inserts = revision.constituentKeys.some((key) => ['ins', 'moveTo', 'cellIns'].includes(parseConstituentKey(key).localName));
  return inserts ? 'accept' : 'reject';
}

/**
 * Replaces the markup of the `tracked` revisions with bookmarks the accept pass keeps. Throws when
 * a revision's markup is missing or ambiguous, or cannot be kept (cell markers, property changes).
 */
export function parkRevisions(
  redline: Uint8Array,
  revisions: readonly RevisionListEntry[],
  tracked: ReadonlySet<string>,
): { redline: Uint8Array; parked: ParkedRevisions } {
  const parked: ParkedRevisions = new Map();
  if (tracked.size === 0) return { redline, parked };
  const files = unzipDocx(redline);
  const byPart = new Map<string, RevisionListEntry[]>();
  for (const revision of revisions) {
    if (tracked.has(revision.id)) byPart.set(revision.partUri, [...(byPart.get(revision.partUri) ?? []), revision]);
  }
  let nextId = firstFreeBookmarkId(files);
  for (const [partUri, partRevisions] of byPart) {
    const document = readPart(files, partUri);
    if (!document) throw new RevisionMarkupError(partRevisions[0]!.id, `the package has no part ${partUri}`);
    const index = new ElementIndex(document);
    const targets: { element: Element; revision: RevisionListEntry }[] = [];
    for (const revision of partRevisions) {
      for (const keyText of revision.constituentKeys) {
        const key = parseConstituentKey(keyText);
        const element = index.find(key);
        if (!element) {
          throw new RevisionMarkupError(revision.id, `${index.isAmbiguous(key) ? 'several elements match' : 'no element matches'} ${keyText}`);
        }
        targets.push({ element, revision });
      }
    }
    for (const { element, revision } of targets) {
      const placement = placementOf(element, revision);
      const token = `${TOKEN_PREFIX}${parked.size}`;
      parked.set(token, { revisionId: revision.id, partUri, placement, localName: element.localName!, attributes: attributesOf(element) });
      const [start, end] = bookmarks(document, token, String(nextId++));
      const parent = element.parentNode!;
      if (placement === 'wrapper') {
        if (DELETED.has(element.localName!)) renameText(element, 'restore');
        parent.insertBefore(start, element);
        while (element.firstChild) parent.insertBefore(element.firstChild, element);
        parent.insertBefore(end, element);
        parent.removeChild(element);
      } else if (placement === 'rangeMarker') {
        parent.insertBefore(start, element);
        parent.insertBefore(end, element);
        parent.removeChild(element);
      } else {
        // The bookmarks go into the paragraph (the row's first one), which the accept pass keeps
        // now that its mark is no longer inserted or deleted.
        const paragraph = placement === 'paragraphMark' ? parent.parentNode!.parentNode! : firstParagraph(parent.parentNode as Element);
        if (!paragraph) throw new UnsupportedRevisionError(revision.id, revision.family, 'a table row without a paragraph');
        parent.removeChild(element);
        paragraph.appendChild(start);
        paragraph.appendChild(end);
      }
    }
    writePart(files, partUri, document);
  }
  return { redline: zipDocx(files), parked };
}

/**
 * Puts the parked markup back at its bookmarks, with `author` and `date` (ISO). A note the export
 * copied (`reconcileNotes`) has its bookmarks twice: each copy gets the markup, with a new `w:id`.
 * Bookmarks can also be gone with what held them, e.g. a note whose reference another decision
 * removed: such a change has nothing left to track.
 */
export function restoreRevisions(exported: Uint8Array, parked: ParkedRevisions, author: string, date: string): Uint8Array {
  if (parked.size === 0) return exported;
  const files = unzipDocx(exported);
  let nextId = Math.max(0, ...[...parked.values()].map((entry) => Number(attribute(entry, 'id')) || 0)) + 1;
  const restored = new Set<string>();
  for (const partUri of new Set([...parked.values()].map((entry) => entry.partUri))) {
    const document = readPart(files, partUri);
    if (!document) continue;
    for (const start of elements(document, 'bookmarkStart')) {
      const token = start.getAttributeNS(W_NS, 'name') ?? '';
      const entry = parked.get(token);
      if (entry?.partUri !== partUri) continue;
      const end = followingEnd(start);
      if (!end) throw new RevisionMarkupError(entry.revisionId, 'the tracked change lost its place in the export');
      // A range marker's id pairs it with its other end, so it keeps it.
      const id = restored.has(token) && entry.placement !== 'rangeMarker' ? String(nextId++) : undefined;
      restore(document, entry, start, end, { author, date, id });
      restored.add(token);
    }
    writePart(files, partUri, document);
  }
  return zipDocx(files);
}

/** The `w:bookmarkEnd` closing a parked bookmark: a later sibling with its id. */
function followingEnd(start: Element): Element | undefined {
  const id = start.getAttributeNS(W_NS, 'id');
  for (let node = start.nextSibling; node; node = node.nextSibling) {
    if (isW(node, 'bookmarkEnd') && (node as Element).getAttributeNS(W_NS, 'id') === id) return node as Element;
  }
  return undefined;
}

function attribute(entry: ParkedElement, localName: string): string | undefined {
  return entry.attributes.find(([namespace, name]) => namespace === W_NS && name.replace(/^.*:/, '') === localName)?.[2];
}

function restore(
  document: Document,
  entry: ParkedElement,
  start: Element,
  end: Element,
  { author, date, id }: { author: string; date: string; id?: string },
): void {
  const parent = start.parentNode!;
  const element = document.createElementNS(W_NS, `w:${entry.localName}`);
  for (const [namespace, name, value] of entry.attributes) element.setAttributeNS(namespace, name, value);
  if (id !== undefined) element.setAttributeNS(W_NS, 'w:id', id);
  // Range end markers have neither.
  if (element.hasAttributeNS(W_NS, 'author') || entry.placement !== 'rangeMarker') {
    element.setAttributeNS(W_NS, 'w:author', author);
    element.setAttributeNS(W_NS, 'w:date', date);
  }
  switch (entry.placement) {
    case 'wrapper': {
      while (start.nextSibling && start.nextSibling !== end) element.appendChild(start.nextSibling);
      // Nothing left to mark (no Word markup wraps nothing).
      if (element.firstChild) {
        if (DELETED.has(entry.localName)) renameText(element, 'delete');
        parent.insertBefore(element, start);
      }
      break;
    }
    case 'rangeMarker':
      parent.insertBefore(element, start);
      break;
    case 'paragraphMark': {
      if (!isW(parent, 'p')) throw new RevisionMarkupError(entry.revisionId, 'the tracked paragraph mark lost its paragraph in the export');
      const pPr = ensureChild(document, parent as Element, 'pPr', []);
      const rPr = ensureChild(document, pPr, 'rPr', ['sectPr', 'pPrChange']);
      insertInOrder(rPr, element, PARAGRAPH_MARKS, 'start');
      break;
    }
    case 'rowMark': {
      const row = ancestor(parent as Element, 'tr');
      if (!row) throw new RevisionMarkupError(entry.revisionId, 'the tracked table row lost its row in the export');
      const trPr = ensureChild(document, row, 'trPr', ['tc', 'customXml', 'sdt', 'bookmarkStart', 'bookmarkEnd'], ['tblPrEx']);
      insertInOrder(trPr, element, ROW_MARKS, 'end');
      break;
    }
  }
  parent.removeChild(start);
  parent.removeChild(end);
}

function placementOf(element: Element, revision: RevisionListEntry): Placement {
  const unsupported = (detail: string) => new UnsupportedRevisionError(revision.id, revision.family, `it cannot be kept as a tracked change: ${detail}`);
  const name = element.localName!;
  if (element.namespaceURI !== W_NS) throw unsupported(`element {${element.namespaceURI}}${name}`);
  if (RANGE_MARKERS.has(name)) return 'rangeMarker';
  if (!WRAPPERS.has(name)) throw unsupported(`w:${name}`);
  const parent = element.parentNode as Element;
  if (isW(parent, 'rPr') && isW(parent.parentNode, 'pPr')) return 'paragraphMark';
  if (isW(parent, 'trPr') && ROW_MARKS.includes(name)) return 'rowMark';
  if (isW(parent, 'rPr') || isW(parent, 'numPr') || isW(parent, 'trPr')) throw unsupported(`w:${name} inside w:${parent.localName}`);
  return 'wrapper';
}

/** One past the largest `w:id` of a bookmark in the main document and the notes. */
function firstFreeBookmarkId(files: Record<string, Uint8Array>): number {
  let max = 0;
  for (const partUri of ['/word/document.xml', '/word/footnotes.xml', '/word/endnotes.xml']) {
    const document = readPart(files, partUri);
    if (!document) continue;
    for (const start of elements(document, 'bookmarkStart')) max = Math.max(max, Number(start.getAttributeNS(W_NS, 'id')) || 0);
  }
  return max + 1;
}

function bookmarks(document: Document, name: string, id: string): [Element, Element] {
  const start = document.createElementNS(W_NS, 'w:bookmarkStart');
  start.setAttributeNS(W_NS, 'w:id', id);
  start.setAttributeNS(W_NS, 'w:name', name);
  const end = document.createElementNS(W_NS, 'w:bookmarkEnd');
  end.setAttributeNS(W_NS, 'w:id', id);
  return [start, end];
}

function firstParagraph(row: Element): Element | undefined {
  return elements(row, 'p')[0];
}

function attributesOf(element: Element): ParkedElement['attributes'] {
  const result: ParkedElement['attributes'] = [];
  for (let i = 0; i < element.attributes.length; i++) {
    const attribute = element.attributes.item(i)!;
    if (attribute.name !== 'xmlns' && !attribute.name.startsWith('xmlns:')) result.push([attribute.namespaceURI, attribute.name, attribute.value]);
  }
  return result;
}

/**
 * The parent's `w:<localName>` child, created if missing: before the first child named in `before`
 * (none: at the start, after the children named in `after`).
 */
function ensureChild(document: Document, parent: Element, localName: string, before: readonly string[], after: readonly string[] = []): Element {
  const children = childElements(parent);
  const existing = children.find((child) => isW(child, localName));
  if (existing) return existing;
  const created = document.createElementNS(W_NS, `w:${localName}`);
  const next = before.length > 0 ? children.find((child) => child.namespaceURI === W_NS && before.includes(child.localName!)) : children.find((child) => !after.some((name) => isW(child, name)));
  parent.insertBefore(created, next ?? null);
  return created;
}

/** Inserts a marker among its siblings named in `order` (at the start or the end of the parent). */
function insertInOrder(parent: Element, marker: Element, order: readonly string[], at: 'start' | 'end'): void {
  const children = childElements(parent);
  const rank = order.indexOf(marker.localName!);
  const later = children.find((child) => child.namespaceURI === W_NS && order.indexOf(child.localName!) > rank);
  if (later) parent.insertBefore(marker, later);
  else if (at === 'start') {
    const firstOther = children.find((child) => !(child.namespaceURI === W_NS && order.includes(child.localName!)));
    parent.insertBefore(marker, firstOther ?? null);
  } else {
    const change = children.find((child) => isW(child, 'trPrChange'));
    parent.insertBefore(marker, change ?? null);
  }
}

function ancestor(element: Element, localName: string): Element | undefined {
  for (let node: Node | null = element; node; node = node.parentNode) if (isW(node, localName)) return node as Element;
  return undefined;
}

/** Turns the text inside into deleted text (`w:t` → `w:delText`), or back. */
function renameText(element: Element, direction: 'delete' | 'restore'): void {
  const pairs = direction === 'delete' ? [['t', 'delText'], ['instrText', 'delInstrText']] : [['delText', 't'], ['delInstrText', 'instrText']];
  for (const [from, to] of pairs) {
    for (const text of elements(element, from!)) {
      const renamed = text.ownerDocument!.createElementNS(W_NS, `w:${to}`);
      for (const [namespace, name, value] of attributesOf(text)) renamed.setAttributeNS(namespace, name, value);
      while (text.firstChild) renamed.appendChild(text.firstChild);
      text.parentNode!.replaceChild(renamed, text);
    }
  }
}

function isW(node: Node | null, localName: string): boolean {
  return !!node && node.nodeType === node.ELEMENT_NODE && (node as Element).namespaceURI === W_NS && (node as Element).localName === localName;
}

function childElements(element: Element): Element[] {
  const children: Element[] = [];
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === child.ELEMENT_NODE) children.push(child as Element);
  }
  return children;
}

/** A copy of the live list (see docs/architecture.md, xmldom's live lists). */
function elements(root: Document | Element, localName: string): Element[] {
  const found = root.getElementsByTagNameNS(W_NS, localName);
  const list: Element[] = [];
  for (let i = 0; i < found.length; i++) list.push(found.item(i)!);
  return list;
}
