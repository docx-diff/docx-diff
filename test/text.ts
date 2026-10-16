// Plain text of a .docx for round-trip checks: one line per paragraph of the main body, then of
// the footnotes and endnotes, whitespace-normalized; empty paragraphs are dropped. Deleted text
// (`w:delText`) is not text, so a document with tracked changes reads as if they were rejected
// for insertions only; compare clean documents.
import { DOMParser, type Element } from '@xmldom/xmldom';
import { strFromU8, unzipSync } from 'fflate';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PARTS = ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml'];

function paragraphText(paragraph: Element): string {
  let text = '';
  const walk = (element: Element) => {
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== child.ELEMENT_NODE) continue;
      const node = child as Element;
      if (node.namespaceURI === W_NS) {
        if (node.localName === 't') text += node.textContent ?? '';
        else if (node.localName === 'tab') text += ' ';
        else if (node.localName === 'br' || node.localName === 'cr') text += ' ';
        else if (node.localName === 'noBreakHyphen') text += '-';
        // A nested paragraph (text box) is a paragraph of its own.
        else if (node.localName !== 'p') walk(node);
      }
    }
  };
  walk(paragraph);
  return text.replace(/\s+/g, ' ').trim();
}

export function docxText(bytes: Uint8Array): string[] {
  const files = unzipSync(bytes, { filter: (file) => PARTS.includes(file.name) });
  const lines: string[] = [];
  for (const part of PARTS) {
    const data = files[part];
    if (!data) continue;
    const document = new DOMParser().parseFromString(strFromU8(data), 'text/xml');
    const paragraphs = document.getElementsByTagNameNS(W_NS, 'p');
    for (let i = 0; i < paragraphs.length; i++) {
      const line = paragraphText(paragraphs[i]!);
      if (line) lines.push(line);
    }
  }
  return lines;
}
