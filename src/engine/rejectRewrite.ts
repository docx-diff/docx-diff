// The export's reject rewrite (docs/architecture.md): each rejected revision's markup is rewritten
// so that *accepting* it gives the Original version. One stateless accept pass then resolves the
// whole document. Works on @xmldom/xmldom documents, since it runs in the worker.
import type { Document, Element, Node } from '@xmldom/xmldom';
import { ElementIndex, W_NS, parseConstituentKey, readPart, unzipDocx, writePart, zipDocx } from './ooxml';
import type { RevisionListEntry } from './types';

/** A revision the export cannot reject (unknown markup, or the engine does not support it). */
export class UnsupportedRevisionError extends Error {
  constructor(
    readonly revisionId: string,
    readonly family: string,
    detail?: string,
  ) {
    super(`Revision ${revisionId} (${family}) cannot be exported${detail ? `: ${detail}` : ''}.`);
    this.name = 'UnsupportedRevisionError';
  }
}

/** A revision whose markup is missing from the redline, or not found uniquely. */
export class RevisionMarkupError extends Error {
  constructor(
    readonly revisionId: string,
    detail: string,
  ) {
    super(`The markup of revision ${revisionId} was not found: ${detail}.`);
    this.name = 'RevisionMarkupError';
  }
}

/**
 * Old properties stored in a `…Change` element replace the parent's current ones. `first` and
 * `last` name the parent's children that are kept, before and after the restored properties
 * (schema order): revision markers, and the paragraph's own `w:rPr`/`w:sectPr`.
 */
const PROPERTY_CHANGES: Record<string, { parent: string; first?: string[]; last?: string[] }> = {
  // A paragraph mark's `w:rPr` starts with its revision markers.
  rPrChange: { parent: 'rPr', first: ['ins', 'del', 'moveFrom', 'moveTo'] },
  pPrChange: { parent: 'pPr', last: ['rPr', 'sectPr'] },
  sectPrChange: { parent: 'sectPr', first: ['headerReference', 'footerReference'] },
  tblPrChange: { parent: 'tblPr' },
  tblPrExChange: { parent: 'tblPrEx' },
  trPrChange: { parent: 'trPr', last: ['ins', 'del'] },
  tcPrChange: { parent: 'tcPr', last: ['cellIns', 'cellDel', 'cellMerge'] },
  tblGridChange: { parent: 'tblGrid' },
};

const MOVE_RANGE_MARKERS = new Set(['moveFromRangeStart', 'moveFromRangeEnd', 'moveToRangeStart', 'moveToRangeEnd']);

/**
 * Rewrites one markup element of a rejected revision. The rule depends on the element and where
 * it sits (run content, paragraph mark `w:pPr/w:rPr`, table row `w:trPr`), not on the key's kind:
 * a content deletion can also list the paragraph mark it removes.
 */
export function rejectElement(element: Element, revision: Pick<RevisionListEntry, 'id' | 'family'>): void {
  const unsupported = (detail: string) => new UnsupportedRevisionError(revision.id, revision.family, detail);
  if (element.namespaceURI !== W_NS) throw unsupported(`element {${element.namespaceURI}}${element.localName}`);
  const name = element.localName!;
  const parent = element.parentNode as Element | null;
  if (!parent) throw unsupported(`detached w:${name}`);
  const parentName = parent.namespaceURI === W_NS ? parent.localName : `{${parent.namespaceURI}}${parent.localName}`;
  const isParagraphMark = parentName === 'rPr' && isW(parent.parentNode, 'pPr');

  const change = PROPERTY_CHANGES[name];
  if (change) {
    if (parentName !== change.parent) throw unsupported(`w:${name} inside w:${parentName}`);
    restoreProperties(element, change.first ?? [], change.last ?? []);
    return;
  }
  if (MOVE_RANGE_MARKERS.has(name)) {
    parent.removeChild(element);
    return;
  }

  switch (name) {
    case 'ins':
      if (isParagraphMark || parentName === 'trPr') rename(element, 'del');
      else if (parentName === 'rPr' || parentName === 'numPr') throw unsupported(`w:ins inside w:${parentName}`);
      else renameText(rename(element, 'del'), 'delete');
      return;
    case 'del':
      if (isParagraphMark || parentName === 'trPr') parent.removeChild(element);
      else if (parentName === 'rPr' || parentName === 'numPr') throw unsupported(`w:del inside w:${parentName}`);
      else unwrap(renameText(element, 'restore'));
      return;
    case 'moveFrom':
      if (isParagraphMark) parent.removeChild(element);
      else unwrap(renameText(element, 'restore'));
      return;
    case 'moveTo':
      if (isParagraphMark) rename(element, 'del');
      else renameText(rename(element, 'del'), 'delete');
      return;
    case 'cellIns':
      rename(element, 'cellDel');
      return;
    case 'cellDel':
      parent.removeChild(element);
      return;
    default:
      throw unsupported(`w:${name}`);
  }
}

/**
 * Runs on a part before the rewrite (seeing all its revisions); the returned function runs after it.
 * The export uses it to keep one look (`consistentLook.ts`).
 */
export type PartHook = (document: Document, partRevisions: readonly RevisionListEntry[]) => () => void;

/**
 * Applies the rewrite to every revision in `rejected`, in each revision's part. Throws when a
 * revision's markup is missing or ambiguous, or the revision is not supported. With `hook`, every
 * part that has revisions is visited, also those without a rejected one.
 */
export function rejectRevisions(
  redline: Uint8Array,
  revisions: readonly RevisionListEntry[],
  rejected: ReadonlySet<string>,
  hook?: PartHook,
): Uint8Array {
  const files = unzipDocx(redline);
  const byPart = new Map<string, RevisionListEntry[]>();
  for (const revision of revisions) {
    if (!hook && !rejected.has(revision.id)) continue;
    byPart.set(revision.partUri, [...(byPart.get(revision.partUri) ?? []), revision]);
  }

  for (const [partUri, partRevisions] of byPart) {
    const document = readPart(files, partUri);
    if (!document) throw new RevisionMarkupError(partRevisions[0]!.id, `the package has no part ${partUri}`);
    const after = hook?.(document, partRevisions);
    rejectInPart(document, partRevisions.filter((revision) => rejected.has(revision.id)));
    after?.();
    writePart(files, partUri, document);
  }
  return zipDocx(files);
}

/** Locates every element first (rewrites replace elements), then rewrites them. */
function rejectInPart(document: Document, revisions: readonly RevisionListEntry[]): void {
  const index = new ElementIndex(document);
  const targets: { element: Element; revision: RevisionListEntry }[] = [];
  for (const revision of revisions) {
    for (const keyText of revision.constituentKeys) {
      const key = parseConstituentKey(keyText);
      const element = index.find(key);
      if (!element) {
        throw new RevisionMarkupError(revision.id, `${index.isAmbiguous(key) ? 'several elements match' : 'no element matches'} ${keyText}`);
      }
      targets.push({ element, revision });
    }
  }
  for (const { element, revision } of targets) rejectElement(element, revision);
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

/** Replaces the element with a `w:<localName>` that has its attributes and (moved) children. */
function rename(element: Element, localName: string): Element {
  const document = element.ownerDocument!;
  const renamed = document.createElementNS(W_NS, element.prefix ? `${element.prefix}:${localName}` : localName);
  for (let i = 0; i < element.attributes.length; i++) {
    const attribute = element.attributes.item(i)!;
    renamed.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
  }
  while (element.firstChild) renamed.appendChild(element.firstChild);
  element.parentNode!.replaceChild(renamed, element);
  return renamed;
}

/** Turns the text inside into deleted text (`w:t` → `w:delText`), or back. */
function renameText(element: Element, direction: 'delete' | 'restore'): Element {
  const pairs = direction === 'delete' ? [['t', 'delText'], ['instrText', 'delInstrText']] : [['delText', 't'], ['delInstrText', 'instrText']];
  for (const [from, to] of pairs) {
    const found = element.getElementsByTagNameNS(W_NS, from!);
    const list: Element[] = [];
    for (let i = 0; i < found.length; i++) list.push(found.item(i)!);
    for (const text of list) rename(text, to!);
  }
  return element;
}

/** Replaces the element with its children. */
function unwrap(element: Element): void {
  const parent = element.parentNode!;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  parent.removeChild(element);
}

function restoreProperties(change: Element, first: readonly string[], last: readonly string[]): void {
  const parent = change.parentNode as Element;
  const old = childElements(change).find((child) => isW(child, parent.localName!));
  const children = childElements(parent);
  const kept = (names: readonly string[]) => children.filter((child) => child.namespaceURI === W_NS && names.includes(child.localName!));
  const [before, after] = [kept(first), kept(last)];
  const restored = old ? childElements(old) : [];

  while (parent.firstChild) parent.removeChild(parent.firstChild);
  for (const child of [...before, ...restored, ...after]) parent.appendChild(child);
}
