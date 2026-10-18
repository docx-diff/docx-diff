// Reviewer comments in the export (FR-27b): each becomes a Word comment in the main document,
// anchored on the change it is about. `anchorComments` puts the range markers into the redline,
// next to (never inside) the revision markup, so that the reject rewrite and the accept pass keep
// them; `addComments` adds the reference runs and the comments part to the result.
import type { Document, Element, Node } from '@xmldom/xmldom';
import { ElementIndex, W_NS, parseConstituentKey, parseXml, readPart, serializeXml, unzipDocx, writePart, zipDocx, type DocxFiles } from './ooxml';
import { DEFAULT_AUTHOR, type ExportComment, type RevisionListEntry } from './types';

const DOCUMENT_PART = '/word/document.xml';
export const COMMENTS_PART = 'word/comments.xml';
const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const COMMENTS_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';
const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';

const NOTES = [
  { part: '/word/footnotes.xml', note: 'footnote', reference: 'footnoteReference' },
  { part: '/word/endnotes.xml', note: 'endnote', reference: 'endnoteReference' },
] as const;

/** Word's comment initials for an author: the first letter of each word, at most three. */
export function authorInitials(author: string): string {
  const initials = author
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => [...word][0]!.toUpperCase())
    .slice(0, 3)
    .join('');
  return initials || 'R';
}

/** As the export plans with it: a tracked revision has the decision that keeps its content (`presentDecision`). */
type FinalDecision = 'accept' | 'reject';

/** A comment with the `w:id` it has in the export. */
export interface NumberedComment extends ExportComment {
  commentId: string;
}

/** Where a marker goes: into `parent`, before `before` (`null`: at the end). */
interface Position {
  parent: Node;
  before: Node | null;
}

/** Where a comment's range starts and ends; `first`/`last` order spans in the document. */
interface Span {
  start: Position;
  end: Position;
  first: Element;
  last: Element;
}

/**
 * Puts `w:commentRangeStart`/`w:commentRangeEnd` around the markup of each comment's revisions in
 * the main document, numbering the comments after the ids the package already uses. A change in a
 * footnote or endnote is anchored on the note's reference; a move on the side the export keeps; a
 * change whose table row or trailing paragraph the export removes, next to what is kept. A comment
 * whose change has no markup to anchor on gets no markers (`addComments` places it).
 */
export function anchorComments(
  redline: Uint8Array,
  revisions: readonly RevisionListEntry[],
  comments: readonly ExportComment[],
  finalDecision: ReadonlyMap<string, FinalDecision>,
): { redline: Uint8Array; comments: NumberedComment[] } {
  const files = unzipDocx(redline);
  const document = readPart(files, DOCUMENT_PART);
  if (!document) throw new Error('The redline has no main document part.');
  const numbered = numberComments(files, document, comments);

  const index = new ElementIndex(document);
  const byId = new Map(revisions.map((revision) => [revision.id, revision]));
  // The decision on each markup element of the main document.
  const decisionOf = new Map<Element, FinalDecision>();
  for (const revision of revisions) {
    if (revision.partUri !== DOCUMENT_PART) continue;
    for (const element of keyElements(revision, index)) decisionOf.set(element, finalDecision.get(revision.id) ?? 'accept');
  }
  const order = documentOrder(document);
  const noteIndexes = new Map<string, ElementIndex | null>();
  const noteIndex = (part: string) => {
    if (!noteIndexes.has(part)) {
      const notes = readPart(files, part);
      noteIndexes.set(part, notes ? new ElementIndex(notes) : null);
    }
    return noteIndexes.get(part)!;
  };

  for (const comment of numbered) {
    const own = comment.revisionIds.map((id) => byId.get(id)).filter((revision): revision is RevisionListEntry => revision !== undefined);
    let spans = own
      .filter((revision) => revision.partUri === DOCUMENT_PART)
      .flatMap((revision) => anchorElements(revision, index, finalDecision.get(revision.id) ?? 'accept'))
      .map((element) => markupSpan(element))
      .filter((span): span is Span => span !== undefined);
    if (spans.length === 0) {
      spans = own
        .map((revision) => noteReference(revision, noteIndex, document, decisionOf))
        .filter((element): element is Element => element !== undefined)
        .map((element) => markupSpan(element)!);
    }
    spans = spans
      .map((span) => outsideRemovedRows(span, decisionOf))
      .map((span) => span && outsideRemovedParagraphs(span, decisionOf))
      .filter((span): span is Span => span !== undefined);
    if (spans.length === 0) continue;
    const first = spans.reduce((a, b) => (order.get(b.first)! < order.get(a.first)! ? b : a));
    const last = spans.reduce((a, b) => (order.get(b.last)! > order.get(a.last)! ? b : a));
    insert(first.start, marker(document, 'commentRangeStart', comment.commentId));
    insert(last.end, marker(document, 'commentRangeEnd', comment.commentId));
  }
  writePart(files, DOCUMENT_PART, document);
  return { redline: zipDocx(files), comments: numbered };
}

/** Numbers after every comment id in the comments part and the main document. */
function numberComments(files: DocxFiles, document: Document, comments: readonly ExportComment[]): NumberedComment[] {
  const used = [
    ...(files[COMMENTS_PART] ? elements(parseXml(files[COMMENTS_PART]), 'comment') : []),
    ...['commentRangeStart', 'commentRangeEnd', 'commentReference'].flatMap((name) => elements(document, name)),
  ].map((element) => Number(element.getAttributeNS(W_NS, 'id')));
  let next = Math.max(-1, ...used.filter(Number.isFinite)) + 1;
  return comments.map((comment) => ({ ...comment, commentId: String(next++) }));
}

/** Markup that shows where a change's text is (not move range markers or property changes). */
const ANCHORS = new Set(['ins', 'del', 'moveFrom', 'moveTo', 'cellIns', 'cellDel']);

function keyElements(revision: RevisionListEntry, index: ElementIndex): Element[] {
  return revision.constituentKeys
    .map((key) => index.find(parseConstituentKey(key)))
    .filter((element): element is Element => element !== undefined);
}

/** The revision's markup that shows where its text is; of a move, only the side the export keeps. */
function anchorElements(revision: RevisionListEntry, index: ElementIndex, decision: FinalDecision): Element[] {
  const keys = revision.constituentKeys.map(parseConstituentKey).filter((key) => key.kind !== undefined && ANCHORS.has(key.localName));
  const dropped = decision === 'accept' ? 'moveFrom' : 'moveTo';
  return keys
    .filter((key) => key.localName !== dropped)
    .map((key) => index.find(key))
    .filter((element): element is Element => element !== undefined);
}

/**
 * Run-level markup is its own span (markers go just outside it). A paragraph mark's (`w:pPr/w:rPr`),
 * a table row's (`w:trPr`) or a cell's (`w:tcPr`) marker spans the content of its paragraph, or of
 * the row's or cell's paragraphs.
 */
function markupSpan(element: Element): Span | undefined {
  const parent = element.parentNode as Element;
  if (!['rPr', 'pPr', 'trPr', 'tcPr'].includes(parent.localName ?? '')) {
    return { start: { parent, before: element }, end: { parent, before: element.nextSibling }, first: element, last: element };
  }
  const container = ancestor(element, parent.localName === 'trPr' ? 'tr' : parent.localName === 'tcPr' ? 'tc' : 'p');
  if (!container) return undefined;
  const paragraphs = container.localName === 'p' ? [container] : elements(container, 'p');
  const [first, last] = [paragraphs[0], paragraphs[paragraphs.length - 1]];
  if (!first || !last) return undefined;
  return { start: paragraphStart(first), end: { parent: last, before: null }, first, last };
}

/** Just after the paragraph's `w:pPr`. */
function paragraphStart(paragraph: Element): Position {
  const pPr = childElements(paragraph).find((child) => isW(child, 'pPr'));
  return { parent: paragraph, before: pPr ? pPr.nextSibling : paragraph.firstChild };
}

/**
 * The reference, in the main document, to the note holding a revision of a notes part: one the
 * export keeps if there is one (a moved reference is a deletion plus an insertion of the same id).
 * Returned as the run-level element to put the markers around.
 */
function noteReference(
  revision: RevisionListEntry,
  noteIndex: (part: string) => ElementIndex | null,
  document: Document,
  decisionOf: ReadonlyMap<Element, FinalDecision>,
): Element | undefined {
  const kind = NOTES.find((notes) => notes.part === revision.partUri);
  const index = kind && noteIndex(kind.part);
  if (!kind || !index) return undefined;
  const note = keyElements(revision, index)
    .map((element) => ancestor(element, kind.note))
    .find((found) => found !== undefined);
  const noteId = note?.getAttributeNS(W_NS, 'id');
  if (!noteId) return undefined;
  const references = elements(document, kind.reference)
    .filter((reference) => reference.getAttributeNS(W_NS, 'id') === noteId)
    .map((reference) => runLevel(reference.parentNode as Element));
  return references.find((element) => kept(element, decisionOf)) ?? references[0];
}

/** The run, or the revision element around it. */
function runLevel(run: Element): Element {
  const parent = run.parentNode as Element;
  return ['ins', 'del', 'moveFrom', 'moveTo'].includes(parent.localName ?? '') && parent.namespaceURI === W_NS ? parent : run;
}

/** Whether the export keeps this run-level element (an insertion accepted, a deletion rejected). */
function kept(element: Element, decisionOf: ReadonlyMap<Element, FinalDecision>): boolean {
  const decision = decisionOf.get(element);
  if (!decision) return true;
  return ['ins', 'moveTo'].includes(element.localName ?? '') ? decision === 'accept' : decision === 'reject';
}

/**
 * A span inside a table row the export removes (an inserted row rejected, a deleted one accepted)
 * would go with the row: it moves to the start of the paragraph after the row's table, or the end of
 * the one before it.
 */
function outsideRemovedRows(span: Span, decisionOf: ReadonlyMap<Element, FinalDecision>): Span | undefined {
  const table = removedRowTable(span.first, decisionOf) ?? removedRowTable(span.last, decisionOf);
  if (!table) return span;
  for (let sibling = table.nextSibling; sibling; sibling = sibling.nextSibling) {
    if (isW(sibling, 'p')) {
      const start = paragraphStart(sibling as Element);
      return { start, end: start, first: sibling as Element, last: sibling as Element };
    }
  }
  for (let sibling = table.previousSibling; sibling; sibling = sibling.previousSibling) {
    if (isW(sibling, 'p')) {
      const end = { parent: sibling, before: null };
      return { start: end, end, first: sibling as Element, last: sibling as Element };
    }
  }
  return undefined;
}

/**
 * The accept pass drops paragraphs whose mark the export removes when no kept paragraph follows them
 * in their container (nothing to merge into), and the markers with them. A span starting in such a
 * paragraph becomes a point at the end of the last kept paragraph before it; one ending in it ends
 * there.
 */
function outsideRemovedParagraphs(span: Span, decisionOf: ReadonlyMap<Element, FinalDecision>): Span | undefined {
  const firstParagraph = isW(span.first, 'p') ? span.first : ancestor(span.first, 'p');
  const lastParagraph = isW(span.last, 'p') ? span.last : ancestor(span.last, 'p');
  if (firstParagraph && isDropped(firstParagraph, decisionOf)) {
    const before = keptBefore(firstParagraph, decisionOf);
    if (!before) return undefined;
    const end = { parent: before, before: null };
    return { start: end, end, first: before, last: before };
  }
  if (lastParagraph && isDropped(lastParagraph, decisionOf)) {
    const before = keptBefore(lastParagraph, decisionOf);
    if (before) return { ...span, end: { parent: before, before: null }, last: before };
  }
  return span;
}

/** The export removes the paragraph's mark: an inserted mark rejected, a deleted one accepted. */
function markRemoved(paragraph: Element, decisionOf: ReadonlyMap<Element, FinalDecision>): boolean {
  const pPr = childElements(paragraph).find((child) => isW(child, 'pPr'));
  const rPr = pPr && childElements(pPr).find((child) => isW(child, 'rPr'));
  return !!rPr && childElements(rPr).some((marker) => {
    const decision = decisionOf.get(marker);
    if (!decision) return false;
    return ['ins', 'moveTo'].includes(marker.localName ?? '') ? decision === 'reject' : decision === 'accept';
  });
}

/** A paragraph whose mark goes, with no paragraph whose mark stays after it before the next table or the end. */
function isDropped(paragraph: Element, decisionOf: ReadonlyMap<Element, FinalDecision>): boolean {
  if (!markRemoved(paragraph, decisionOf)) return false;
  for (let sibling = paragraph.nextSibling; sibling; sibling = sibling.nextSibling) {
    if (sibling.nodeType !== sibling.ELEMENT_NODE) continue;
    if (!isW(sibling, 'p')) return true;
    if (!markRemoved(sibling as Element, decisionOf)) return false;
  }
  return true;
}

function keptBefore(paragraph: Element, decisionOf: ReadonlyMap<Element, FinalDecision>): Element | undefined {
  for (let sibling = paragraph.previousSibling; sibling; sibling = sibling.previousSibling) {
    if (isW(sibling, 'p') && !markRemoved(sibling as Element, decisionOf)) return sibling as Element;
  }
  return undefined;
}

/** The table of the outermost removed row around the element. */
function removedRowTable(element: Element, decisionOf: ReadonlyMap<Element, FinalDecision>): Element | undefined {
  let table: Element | undefined;
  for (let node: Node | null = element; node; node = node.parentNode) {
    if (!isW(node, 'tr')) continue;
    const trPr = childElements(node as Element).find((child) => isW(child, 'trPr'));
    const removed = trPr && childElements(trPr).some((marker) => {
      const decision = decisionOf.get(marker);
      return (isW(marker, 'ins') && decision === 'reject') || (isW(marker, 'del') && decision === 'accept');
    });
    if (removed) table = node.parentNode as Element;
  }
  return table;
}

function insert(position: Position, element: Element): void {
  position.parent.insertBefore(element, position.before);
}

/**
 * Adds a reference run after each comment's `w:commentRangeEnd` in the main document, and the
 * comments to the package (creating `word/comments.xml`, its relationship and content type when the
 * package has none). A comment whose markers the export no longer has (its change left nothing to
 * anchor on) goes at the end of the document; returns those.
 */
export function addComments(files: DocxFiles, comments: readonly NumberedComment[], date: string, author = DEFAULT_AUTHOR): NumberedComment[] {
  if (comments.length === 0) return [];
  const document = readPart(files, DOCUMENT_PART)!;
  const ends = new Map(elements(document, 'commentRangeEnd').map((end) => [end.getAttributeNS(W_NS, 'id'), end]));
  const starts = new Map(elements(document, 'commentRangeStart').map((start) => [start.getAttributeNS(W_NS, 'id'), start]));
  const relocated: NumberedComment[] = [];
  for (const comment of comments) {
    let end = ends.get(comment.commentId);
    if (!end || !starts.has(comment.commentId)) {
      for (const orphan of [end, starts.get(comment.commentId)]) orphan?.parentNode?.removeChild(orphan);
      end = atDocumentEnd(document, comment.commentId);
      relocated.push(comment);
    }
    const run = document.createElementNS(W_NS, 'w:r');
    run.appendChild(marker(document, 'commentReference', comment.commentId));
    end.parentNode!.insertBefore(run, end.nextSibling);
  }
  writePart(files, DOCUMENT_PART, document);

  const existing = files[COMMENTS_PART];
  const part = existing ? parseXml(existing) : parseXml(`<w:comments xmlns:w="${W_NS}"/>`);
  for (const comment of comments) {
    const element = part.createElementNS(W_NS, 'w:comment');
    element.setAttributeNS(W_NS, 'w:id', comment.commentId);
    element.setAttributeNS(W_NS, 'w:author', author);
    element.setAttributeNS(W_NS, 'w:date', date);
    element.setAttributeNS(W_NS, 'w:initials', authorInitials(author));
    comment.paragraphs.forEach((text, i) => element.appendChild(commentParagraph(part, text, i === 0)));
    part.documentElement!.appendChild(element);
  }
  files[COMMENTS_PART] = serializeXml(part);
  if (!existing) register(files);
  return relocated;
}

/** An empty comment range at the end of the body's last paragraph (one is added if there is none); returns its end. */
function atDocumentEnd(document: Document, id: string): Element {
  const body = elements(document, 'body')[0]!;
  let paragraph = childElements(body).filter((child) => isW(child, 'p')).pop();
  if (!paragraph) {
    paragraph = document.createElementNS(W_NS, 'w:p');
    const sectPr = childElements(body).find((child) => isW(child, 'sectPr'));
    body.insertBefore(paragraph, sectPr ?? null);
  }
  paragraph.appendChild(marker(document, 'commentRangeStart', id));
  const end = marker(document, 'commentRangeEnd', id);
  paragraph.appendChild(end);
  return end;
}

/** A paragraph of a comment; the first starts with the comment's mark (`w:annotationRef`). */
function commentParagraph(document: Document, text: string, first: boolean): Element {
  const paragraph = document.createElementNS(W_NS, 'w:p');
  if (first) {
    const run = document.createElementNS(W_NS, 'w:r');
    run.appendChild(document.createElementNS(W_NS, 'w:annotationRef'));
    paragraph.appendChild(run);
  }
  if (text !== '') {
    const run = document.createElementNS(W_NS, 'w:r');
    const t = document.createElementNS(W_NS, 'w:t');
    t.setAttribute('xml:space', 'preserve');
    t.appendChild(document.createTextNode(text));
    run.appendChild(t);
    paragraph.appendChild(run);
  }
  return paragraph;
}

/** The relationship from the main document and the content type of a new comments part. */
function register(files: DocxFiles): void {
  const relsPath = 'word/_rels/document.xml.rels';
  const rels = parseXml(files[relsPath]!);
  const ids = new Set(elements(rels, 'Relationship', RELS_NS).map((relationship) => relationship.getAttribute('Id')));
  let n = ids.size + 1;
  while (ids.has(`rId${n}`)) n++;
  const relationship = rels.createElementNS(RELS_NS, 'Relationship');
  relationship.setAttribute('Id', `rId${n}`);
  relationship.setAttribute('Type', COMMENTS_REL);
  relationship.setAttribute('Target', 'comments.xml');
  rels.documentElement!.appendChild(relationship);
  files[relsPath] = serializeXml(rels);

  const typesPath = '[Content_Types].xml';
  const types = parseXml(files[typesPath]!);
  const override = types.createElementNS(TYPES_NS, 'Override');
  override.setAttribute('PartName', `/${COMMENTS_PART}`);
  override.setAttribute('ContentType', COMMENTS_TYPE);
  types.documentElement!.appendChild(override);
  files[typesPath] = serializeXml(types);
}

function marker(document: Document, localName: string, id: string): Element {
  const element = document.createElementNS(W_NS, `w:${localName}`);
  element.setAttributeNS(W_NS, 'w:id', id);
  return element;
}

function documentOrder(document: Document): Map<Element, number> {
  const order = new Map<Element, number>();
  const walk = (element: Element): void => {
    order.set(element, order.size);
    for (let child = element.firstChild; child; child = child.nextSibling) if (child.nodeType === child.ELEMENT_NODE) walk(child as Element);
  };
  if (document.documentElement) walk(document.documentElement);
  return order;
}

function ancestor(element: Element, localName: string): Element | undefined {
  for (let node: Node | null = element.parentNode; node; node = node.parentNode) if (isW(node, localName)) return node as Element;
  return undefined;
}

function isW(node: Node | null, localName: string): boolean {
  return !!node && node.nodeType === node.ELEMENT_NODE && (node as Element).namespaceURI === W_NS && (node as Element).localName === localName;
}

function elements(root: Document | Element, localName: string, namespace = W_NS): Element[] {
  const found = root.getElementsByTagNameNS(namespace, localName);
  const list: Element[] = [];
  for (let i = 0; i < found.length; i++) list.push(found.item(i)!);
  return list;
}

function childElements(element: Element): Element[] {
  const children: Element[] = [];
  for (let child = element.firstChild; child; child = child.nextSibling) if (child.nodeType === child.ELEMENT_NODE) children.push(child as Element);
  return children;
}
