// The redline paragraph behind a rendered block. A block's `data-anchor` is the engine's Unid of
// its `w:p`, which the HTML converter derives from the XML it is given (`UnidHelper` in Docxodus);
// the redline carries no Unids, so they are derived here the same way (docs/architecture.md,
// "Block mapping"). Attributes don't count, so the tagged and the untagged redline give the same
// Unids. Runs in the worker (xmldom, Web Crypto) and in Node tests.
import type { Document, Element } from '@xmldom/xmldom';
import { W_NS } from './ooxml';

/**
 * Every `w:p` of a part (`word/document.xml`, `footnotes.xml`, `endnotes.xml`) by its Unid, nested
 * paragraphs (table cells, text boxes) included.
 *
 * The engine's scheme: an element's Unid is `hash(parentUnid:tag:signature:dupIndex)`, where the
 * part's root element is seeded with its local name, `signature` is a hash of the element's own
 * content (`signature` below) and `dupIndex` counts the preceding siblings with the same tag and
 * signature. Only the ancestors of paragraphs need a Unid, and only siblings sharing a tag with
 * one of them need a signature.
 */
export async function paragraphUnids(part: Document): Promise<Map<string, Element>> {
  const root = part.documentElement;
  const found = new Map<string, Element>();
  if (!root) return found;
  const holders = new Set<Element>();
  for (const paragraph of [...part.getElementsByTagNameNS(W_NS, 'p')]) {
    for (let node = paragraph.parentNode; node && node.nodeType === node.ELEMENT_NODE; node = node.parentNode) {
      if (holders.has(node as Element)) break;
      holders.add(node as Element);
    }
  }

  const visit = async (parent: Element, parentUnid: string): Promise<void> => {
    const children = elementChildren(parent);
    const needed = new Set(children.filter((child) => isW(child, 'p') || holders.has(child)));
    if (needed.size === 0) return;
    const names = new Set([...needed].map((child) => child.localName));
    const compared = children.filter((child) => names.has(child.localName));
    const signatures = await Promise.all(compared.map(signature));
    const seen = new Map<string, number>();
    const unids = await Promise.all(
      compared.map((child, i) => {
        const key = `${child.localName}:${signatures[i]}`;
        const dupIndex = seen.get(key) ?? 0;
        seen.set(key, dupIndex + 1);
        return needed.has(child) ? shortHash(`${parentUnid}:${key}:${dupIndex}`, 32) : null;
      }),
    );
    await Promise.all(
      compared.map((child, i) => {
        const unid = unids[i];
        if (unid == null) return undefined;
        if (isW(child, 'p')) found.set(unid, child);
        return holders.has(child) ? visit(child, unid) : undefined;
      }),
    );
  };
  await visit(root, root.localName!);
  return found;
}

/**
 * `UnidHelper.ContentSignature`: for an element holding a `w:p` or `w:tbl`, the hash of its tag
 * name; otherwise the hash of `<w:t text>|<pStyle>|<numId>|<names of all other descendants>,`.
 */
function signature(element: Element): Promise<string> {
  let text = '';
  const isContainer = (node: Element): boolean => {
    for (const child of elementChildren(node)) {
      if (isW(child, 'p') || isW(child, 'tbl')) return true;
      if (isW(child, 't')) text += child.textContent ?? '';
      if (isContainer(child)) return true;
    }
    return false;
  };
  if (isContainer(element)) return shortHash(element.localName!, 16);

  const pPr = firstW(element, 'pPr');
  const pStyle = pPr && firstW(pPr, 'pStyle');
  const numPr = pPr && firstW(pPr, 'numPr');
  const numId = numPr && firstW(numPr, 'numId');
  let names = '';
  const addNames = (node: Element): void => {
    for (const child of elementChildren(node)) {
      if (!isW(child, 't')) names += `${child.localName},`;
      addNames(child);
    }
  };
  addNames(element);
  return shortHash(`${text}|${pStyle?.getAttributeNS(W_NS, 'val') ?? ''}|${numId?.getAttributeNS(W_NS, 'val') ?? ''}|${names}`, 16);
}

/** `UnidHelper.ShortHash`: the first `hexChars` lowercase hex digits of the SHA-256 of the UTF-8 text. */
async function shortHash(input: string, hexChars: number): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)));
  let hex = '';
  for (let i = 0; i < hexChars / 2; i++) hex += digest[i]!.toString(16).padStart(2, '0');
  return hex;
}

function isW(element: Element, localName: string): boolean {
  return element.namespaceURI === W_NS && element.localName === localName;
}

function firstW(parent: Element, localName: string): Element | undefined {
  return elementChildren(parent).find((child) => isW(child, localName));
}

function elementChildren(parent: Element): Element[] {
  const children: Element[] = [];
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === child.ELEMENT_NODE) children.push(child as Element);
  }
  return children;
}
