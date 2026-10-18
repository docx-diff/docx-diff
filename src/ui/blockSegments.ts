// A rendered block as the segments of the paragraph edit model (`src/model/paragraphEdit.ts`),
// read from the decorated HTML (docs/architecture.md, "Inline edits"). Its offsets agree with the
// redline paragraph's, as the export's patch needs (`src/engine/applyEdits.ts`): what isn't document
// text is skipped as `DocIndex` does, and each inline object is one placeholder.
import { revisionIdFromAuthor } from '../engine/tagRedline';
import { NOT_TEXT } from '../model/docIndex';
import type { ObjectSegment, Segment } from '../model/paragraphEdit';

/** `Node.TEXT_NODE`, `Node.ELEMENT_NODE` (`Node` is not a global with jsdom in Node). */
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
/** The converter writes a left-to-right mark after each line break. */
const BREAK_MARK = '\u200e';

/** The block's segments: unchanged text, each revision's inserted or deleted text, inline objects. */
export function readBlockSegments(block: Element): Segment[] {
  const segments: Segment[] = [];
  let afterBreak = false;

  const changeOf = (node: Node): { change: 'del' | 'ins'; itemId: string; revisionId: string } | undefined => {
    const element = (node.nodeType === ELEMENT_NODE ? (node as Element) : node.parentElement)?.closest<HTMLElement>('ins, del');
    if (!element || !block.contains(element)) return undefined;
    const revisionId = revisionIdFromAuthor(element.dataset.author);
    if (revisionId === null) return undefined;
    return { change: element.localName as 'del' | 'ins', itemId: element.dataset.changeId ?? revisionId, revisionId };
  };

  const addText = (text: string, node: Node) => {
    if (!text) return;
    const change = changeOf(node);
    const last = segments.at(-1);
    if (!change) {
      if (last?.kind === 'equal') last.text += text;
      else segments.push({ kind: 'equal', text });
    } else if (last && last.kind === change.change && last.itemId === change.itemId && last.revisionId === change.revisionId) {
      last.text += text;
    } else {
      segments.push({ kind: change.change, text, itemId: change.itemId, revisionId: change.revisionId });
    }
  };

  const addObject = (key: string, element: Element) => {
    const change = changeOf(element);
    const segment: ObjectSegment = change ? { kind: 'object', key, owner: change } : { kind: 'object', key };
    segments.push(segment);
  };

  const visit = (parent: Node): void => {
    for (let node = parent.firstChild; node; node = node.nextSibling) {
      if (node.nodeType === TEXT_NODE) {
        let text = node.textContent ?? '';
        if (afterBreak && text.startsWith(BREAK_MARK)) text = text.slice(1);
        afterBreak = false;
        if (!isMarkFiller(node)) addText(text, node);
        continue;
      }
      if (node.nodeType !== ELEMENT_NODE) continue;
      const element = node as Element;
      if (element.matches(NOT_TEXT)) continue;
      const object = objectKey(element);
      if (object) {
        addObject(object, element);
        afterBreak = element.localName === 'br';
        continue;
      }
      visit(element);
    }
  };
  visit(block);

  // An empty paragraph renders a no-break space so that it has a height.
  const [only] = segments;
  if (segments.length === 1 && only!.kind === 'equal' && /^[\u00a0 ]$/.test(only!.text)) return [];
  return segments;
}

/** The key of an inline object element: a note reference, a tab or a line break. */
function objectKey(element: Element): string | undefined {
  if (element.matches('a.footnote-ref')) return `fn:${(element as HTMLElement).dataset.footnoteId ?? ''}`;
  if (element.matches('a.endnote-ref')) return `en:${(element.getAttribute('href') ?? '').replace(/^#en-/, '')}`;
  if (element.matches('[data-docx-tab]')) return 'tab';
  if (element.localName === 'br') return 'br';
  return undefined;
}

/** The space the converter puts before the ¶ glyph of a deleted paragraph mark. */
function isMarkFiller(node: Node): boolean {
  const element = node.parentElement;
  return !!element && !(node.textContent ?? '').trim() && element.nextElementSibling?.matches('.rev-para-mark-del') === true && element.childNodes.length === 1;
}
