// Zip and XML helpers for the redline package. XML goes through @xmldom/xmldom because
// `DOMParser` does not exist in Web Workers (PRD §7.1); the same code runs in Node tests.
import { DOMParser, XMLSerializer, type Document, type Element } from '@xmldom/xmldom';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** The package files by path (`word/document.xml`, …). */
export type DocxFiles = Record<string, Uint8Array>;

export function unzipDocx(bytes: Uint8Array): DocxFiles {
  return unzipSync(bytes);
}

export function zipDocx(files: DocxFiles): Uint8Array {
  const zippable: Zippable = {};
  for (const [path, data] of Object.entries(files)) zippable[path] = data;
  return zipSync(zippable);
}

/** Zip path of a part, from its part URI (`/word/document.xml` → `word/document.xml`). */
export function partPath(partUri: string): string {
  return partUri.replace(/^\//, '');
}

export function parseXml(xml: Uint8Array | string): Document {
  const text = typeof xml === 'string' ? xml : strFromU8(xml);
  // Any well-formedness error throws (xmldom's default only throws on fatal errors).
  const parser = new DOMParser({
    onError(level, message) {
      if (level !== 'warning') throw new Error(`XML ${level}: ${message}`);
    },
  });
  return parser.parseFromString(text, 'text/xml');
}

export function serializeXml(document: Document): Uint8Array {
  return strToU8(new XMLSerializer().serializeToString(document));
}

/** Reads and parses one part; `undefined` when the package does not have it. */
export function readPart(files: DocxFiles, partUri: string): Document | undefined {
  const data = files[partPath(partUri)];
  return data && parseXml(data);
}

export function writePart(files: DocxFiles, partUri: string, document: Document): void {
  files[partPath(partUri)] = serializeXml(document);
}

/**
 * One entry of a revision's `constituentKeys`: the markup element (namespace + local name + `w:id`)
 * that carries part of the revision. Formats (PRD §7.3):
 * `kind=Content:<ns>:ins:<id>`, `kind=ParaMark:<ns>:del:<id>`, `kind=PropsChange:<ns>:rPrChange:<id>`,
 * `kind=Content:<ns>:moveFrom:<id>:name=<move>`, and range markers without `kind=`, e.g.
 * `<ns>:moveFromRangeStart:<id>:name=<move>` or `<ns>:moveToRangeEnd:<id>`.
 */
export interface ConstituentKey {
  /** `Content`, `ParaMark`, `PropsChange`, …; absent for move range markers. */
  kind?: string;
  namespace: string;
  localName: string;
  id: string;
  /** The move name (`w:name`) of move markup. */
  moveName?: string;
}

export function parseConstituentKey(key: string): ConstituentKey {
  let rest = key;
  let kind: string | undefined;
  const kindMatch = /^kind=([^:]+):/.exec(rest);
  if (kindMatch) {
    kind = kindMatch[1];
    rest = rest.slice(kindMatch[0].length);
  }
  let moveName: string | undefined;
  const nameAt = rest.lastIndexOf(':name=');
  if (nameAt >= 0) {
    moveName = rest.slice(nameAt + ':name='.length);
    rest = rest.slice(0, nameAt);
  }
  const idAt = rest.lastIndexOf(':');
  const nameStart = rest.lastIndexOf(':', idAt - 1);
  if (idAt <= 0 || nameStart <= 0) throw new Error(`Unrecognized constituent key: ${key}`);
  return {
    kind,
    namespace: rest.slice(0, nameStart),
    localName: rest.slice(nameStart + 1, idAt),
    id: rest.slice(idAt + 1),
    moveName,
  };
}

/**
 * Finds elements by namespace + local name + `w:id`, after one walk over the part.
 * `(element name, w:id)` is unique within a part on the sample (PRD §7.3), but nothing guarantees
 * it: a content `w:ins`, a paragraph-mark `w:ins` and a table-row `w:ins` share the name. A key
 * that names more than one element finds nothing and is reported by `isAmbiguous`, so that a
 * rewrite never picks the wrong one.
 */
export class ElementIndex {
  private readonly byKey = new Map<string, Element>();
  private readonly duplicates = new Set<string>();

  constructor(document: Document) {
    const walk = (element: Element): void => {
      const id = element.getAttributeNS(W_NS, 'id');
      if (id !== null && id !== '') {
        const key = indexKey(element.namespaceURI ?? '', element.localName ?? '', id);
        if (this.byKey.has(key)) this.duplicates.add(key);
        else this.byKey.set(key, element);
      }
      for (let child = element.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === child.ELEMENT_NODE) walk(child as Element);
      }
    };
    if (document.documentElement) walk(document.documentElement);
  }

  /** The one element with this name and id; `undefined` when there is none or more than one. */
  get(namespace: string, localName: string, id: string): Element | undefined {
    const key = indexKey(namespace, localName, id);
    return this.duplicates.has(key) ? undefined : this.byKey.get(key);
  }

  /** The element a constituent key names, if present and unique. */
  find(key: ConstituentKey): Element | undefined {
    return this.get(key.namespace, key.localName, key.id);
  }

  /** More than one element has the name and id the key gives. */
  isAmbiguous(key: ConstituentKey): boolean {
    return this.duplicates.has(indexKey(key.namespace, key.localName, key.id));
  }
}

function indexKey(namespace: string, localName: string, id: string): string {
  return `${namespace}|${localName}|${id}`;
}
