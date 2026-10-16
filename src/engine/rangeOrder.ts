// The comparison range on export (PRD §7.5): the region outside the range keeps the Original's
// text, and everything the reviewer decided comes before it. The engine can place in-range content
// after a deleted tail: on the sample, the destinations of two moves from just before the tail
// (with the editor's changes) sit after it. Left there, accepting the moves puts these paragraphs
// after the kept tail. So the body elements after the start of the outside region that carry
// in-range changes go back before it, and their paragraph marks come with them.
import type { Document, Element, Node } from '@xmldom/xmldom';
import { ElementIndex, W_NS, parseConstituentKey } from './ooxml';
import type { RevisionListEntry } from './types';

/** A pulled paragraph's mark from an outside revision, and whether the export keeps the mark. */
interface Mark {
  paragraph: Element;
  id: string;
  keep: boolean;
}

/**
 * Plans the reordering on a part before the reject rewrite (which replaces revision elements, not
 * the body's children) and returns the step that applies it afterwards. Without any outside
 * revision, or for a part without a body (notes), it does nothing.
 *
 * The outside region starts at the first body element that holds only outside revisions' markup.
 * After it, each element holding the markup of an in-range text change (not just formatting) is
 * moved, in order, before that start. A moved paragraph whose mark was inserted by an outside
 * revision (the engine gives such paragraphs after a deleted tail an inserted mark) keeps the mark
 * when every in-range change in it is accepted, as in the Edited document; otherwise the mark is
 * rejected with its revision and the emptied paragraph joins the next one.
 */
export function planRangeOrder(
  document: Document,
  partRevisions: readonly RevisionListEntry[],
  finalDecision: ReadonlyMap<string, 'accept' | 'reject'>,
  outOfRange: ReadonlySet<string>,
): () => void {
  const body = document.getElementsByTagNameNS(W_NS, 'body').item(0);
  if (!body || !partRevisions.some((revision) => outOfRange.has(revision.id))) return () => {};

  interface Holder {
    inRange: RevisionListEntry[];
    outside: boolean;
    marks: { element: Element; revision: RevisionListEntry }[];
  }
  const holders = new Map<Element, Holder>();
  const index = new ElementIndex(document);
  for (const revision of partRevisions) {
    const outside = outOfRange.has(revision.id);
    for (const keyText of revision.constituentKeys) {
      const key = parseConstituentKey(keyText);
      const element = index.find(key);
      const top = element && topLevel(element, body);
      if (!element || !top) continue;
      const holder = holders.get(top) ?? { inRange: [], outside: false, marks: [] };
      holders.set(top, holder);
      if (outside) {
        holder.outside = true;
        if (key.kind === 'ParaMark' && key.localName === 'ins') holder.marks.push({ element, revision });
      } else if (key.kind !== 'PropsChange' && !holder.inRange.includes(revision)) {
        holder.inRange.push(revision);
      }
    }
  }

  const children = childElements(body).filter((child) => !isW(child, 'sectPr'));
  const start = children.findIndex((child) => {
    const holder = holders.get(child);
    return holder !== undefined && holder.outside && holder.inRange.length === 0;
  });
  if (start < 0) return () => {};
  const pulled = children.slice(start + 1).filter((child) => (holders.get(child)?.inRange.length ?? 0) > 0);
  if (pulled.length === 0) return () => {};

  const marks: Mark[] = [];
  for (const child of pulled) {
    const holder = holders.get(child)!;
    const keep = holder.inRange.every((revision) => finalDecision.get(revision.id) === 'accept');
    for (const { element } of holder.marks) {
      const paragraph = element.parentNode?.parentNode?.parentNode as Element | null;
      if (paragraph && isW(paragraph, 'p')) marks.push({ paragraph, id: element.getAttributeNS(W_NS, 'id') ?? '', keep });
    }
  }

  const before = children[start]!;
  return () => {
    for (const child of pulled) body.insertBefore(child, before);
    for (const mark of marks) {
      if (!mark.keep) continue;
      // The rewrite renamed a rejected mark's `w:ins` to `w:del`; without its marker, the mark stays.
      const pPr = childElements(mark.paragraph).find((child) => isW(child, 'pPr'));
      const rPr = pPr && childElements(pPr).find((child) => isW(child, 'rPr'));
      const marker = rPr && childElements(rPr).find((child) => (isW(child, 'del') || isW(child, 'ins')) && child.getAttributeNS(W_NS, 'id') === mark.id);
      marker?.parentNode?.removeChild(marker);
    }
  };
}

/** The body child that contains the element (the element itself when it is one). */
function topLevel(element: Element, body: Element): Element | null {
  let node: Node | null = element;
  while (node && node.parentNode !== body) node = node.parentNode;
  return node as Element | null;
}

function isW(node: Node, localName: string): boolean {
  return node.nodeType === node.ELEMENT_NODE && (node as Element).namespaceURI === W_NS && (node as Element).localName === localName;
}

function childElements(element: Element): Element[] {
  const children: Element[] = [];
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === child.ELEMENT_NODE) children.push(child as Element);
  }
  return children;
}
