// The "look" of an exported document, for checking FR-39a (one consistent look): every distinct
// set of run properties of a text run, of paragraph properties, and of paragraph-mark properties.
import { strFromU8, unzipSync } from 'fflate';
import { DOMParser, type Element } from '@xmldom/xmldom';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PARTS = ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml'];

export interface Look {
  runs: Set<string>;
  paragraphs: Set<string>;
  marks: Set<string>;
}

function childElements(element: Element | undefined): Element[] {
  const result: Element[] = [];
  for (let child = element?.firstChild; child; child = child.nextSibling) if (child.nodeType === 1) result.push(child as Element);
  return result;
}

function child(element: Element | undefined, name: string): Element | undefined {
  return childElements(element).find((candidate) => candidate.localName === name);
}

function signature(element: Element): string {
  const attributes: string[] = [];
  for (let i = 0; i < element.attributes.length; i++) {
    const attribute = element.attributes.item(i)!;
    if (!/^w:rsid|^xmlns/.test(attribute.name)) attributes.push(`${attribute.name}=${attribute.value}`);
  }
  return `${element.localName}[${attributes.sort().join(',')}](${childElements(element).map(signature).join('')})`;
}

const propsSignature = (container: Element | undefined, skip: string[] = []) =>
  childElements(container)
    .filter((element) => !skip.includes(element.localName!))
    .map(signature)
    .join('');

/**
 * The look of a `.docx`: text runs' `w:rPr`, paragraphs' `w:pPr` (without mark, section and numbering) and
 * paragraph marks' `w:rPr`. Paragraph properties are taken from the body only: a note that only
 * one version has keeps its note style, which the other version's export may not have at all.
 */
export function documentLook(bytes: Uint8Array): Look {
  const files = unzipSync(bytes, { filter: (file) => PARTS.includes(file.name) });
  const look: Look = { runs: new Set(), paragraphs: new Set(), marks: new Set() };
  for (const part of PARTS) {
    if (!files[part]) continue;
    const document = new DOMParser().parseFromString(strFromU8(files[part]), 'text/xml');
    const runs = document.getElementsByTagNameNS(W_NS, 'r');
    for (let i = 0; i < runs.length; i++) {
      const run = runs.item(i)!;
      if (run.getElementsByTagNameNS(W_NS, 't').length === 0) continue;
      look.runs.add(propsSignature(child(run, 'rPr')));
    }
    if (part !== 'word/document.xml') continue;
    const paragraphs = document.getElementsByTagNameNS(W_NS, 'p');
    for (let i = 0; i < paragraphs.length; i++) {
      const pPr = child(paragraphs.item(i)!, 'pPr');
      // List numbering is structure, not look: a restored list item keeps its own.
      look.paragraphs.add(propsSignature(pPr, ['rPr', 'sectPr', 'numPr']));
      look.marks.add(propsSignature(child(pPr, 'rPr')));
    }
  }
  return look;
}

/** The parts of `look` that `reference` does not have. */
export function lookDifference(look: Look, reference: Look): { runs: string[]; paragraphs: string[]; marks: string[] } {
  const missing = (values: Set<string>, known: Set<string>) => [...values].filter((value) => !known.has(value));
  return { runs: missing(look.runs, reference.runs), paragraphs: missing(look.paragraphs, reference.paragraphs), marks: missing(look.marks, reference.marks) };
}
