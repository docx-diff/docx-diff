// Prepares the rendered redline HTML for the two document panels. The HTML is parsed once on the
// main thread; the document index is built from the same parse, then the document is decorated
// (change ids, fallback markers, which blocks each side shows) and each panel clones its body.
import { revisionIdFromAuthor } from '../engine/tagRedline';
import type { ChangeItem } from '../model/changes';
import type { DocIndex } from '../model/docIndex';
import {
  collectItemTexts,
  commonAffixes,
  relabelTextUnchanged,
  type CommonToken,
  type CompareSettings,
  type ItemText,
} from '../model/equivalence';

export interface RenderedDocument {
  /** The converter's stylesheet, scoped to the panel's `.doc` wrapper. */
  css: string;
  /** The decorated document body; panels clone its children. */
  body: HTMLElement;
}

/**
 * Parses the HTML without running anything in it. The HTML comes from our own engine, but it
 * carries text and links from the user's documents, so scripts and `javascript:` links are
 * removed and other links open in a new tab instead of replacing the app.
 */
export function parseRenderedHtml(html: string, parse = (text: string) => new DOMParser().parseFromString(text, 'text/html')): Document {
  const document = parse(html);
  for (const script of document.querySelectorAll('script')) script.remove();
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = link.getAttribute('href') ?? '';
    if (href.startsWith('#')) continue;
    if (/^\s*javascript:/i.test(href)) {
      link.removeAttribute('href');
    } else {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
  }
  return document;
}

/**
 * The converter's CSS from the document's `<style>` elements, with `html`/`body` selectors moved to
 * the panel's `.doc` wrapper (the panels live in shadow roots) and any per-author rules
 * (`[data-author="…"]`) removed: every revision is its own "author" after tagging
 * (docs/architecture.md).
 */
export function documentCss(document: Document): string {
  const css = [...document.querySelectorAll('style')].map((style) => style.textContent ?? '').join('\n');
  return css
    .replace(/[^{}]*\[data-author[^{}]*\{[^{}]*\}/g, '')
    .replace(/(^|[\s,>+~(}])(html|body)(?=$|[\s,.:#[>+~){])/g, '$1.doc');
}

/**
 * Marks the document for display, in place:
 * - every revision element (`data-author="rev:<id>"`) gets `data-change-id` = its item's id;
 * - formatting items none of whose revisions has an element get a marker element with their
 *   `data-change-id` at the start of each paragraph they affect;
 * - blocks missing from one version get `not-in-original` / `not-in-edited`, so each panel can
 *   hide them (also note list items whose paragraphs are all missing).
 */
export function decorateDocument(document: Document, items: readonly ChangeItem[], index: DocIndex): void {
  const itemByRevision = new Map<string, string>();
  for (const item of items) for (const revisionId of item.revisionIds) itemByRevision.set(revisionId, item.id);

  for (const element of document.querySelectorAll<HTMLElement>('[data-author^="rev:"]')) {
    const itemId = itemByRevision.get(revisionIdFromAuthor(element.dataset.author)!);
    if (itemId !== undefined) element.dataset.changeId = itemId;
  }

  const blockElements = new Map<string, HTMLElement>();
  for (const element of document.querySelectorAll<HTMLElement>('[data-anchor]')) {
    blockElements.set(element.dataset.anchor!, element);
  }

  for (const item of items) {
    if (item.kind !== 'formatting' || item.revisionIds.some((id) => index.revisionsInHtml.has(id))) continue;
    for (const unid of item.anchors) {
      const block = blockElements.get(unid);
      if (!block) continue;
      const marker = document.createElement('span');
      marker.className = 'rev-format-marker';
      marker.dataset.changeId = item.id;
      block.prepend(marker);
    }
  }

  for (const [unid, element] of blockElements) {
    const block = index.blockByUnid.get(unid);
    if (!block) continue;
    if (!block.inOriginal) element.classList.add('not-in-original');
    if (!block.inEdited) element.classList.add('not-in-edited');
  }
  for (const note of document.querySelectorAll('li[id^="fn-"], li[id^="en-"]')) {
    const blocks = [...note.querySelectorAll('[data-anchor]')];
    if (blocks.length === 0) continue;
    for (const missing of ['not-in-original', 'not-in-edited']) {
      if (blocks.every((block) => block.classList.contains(missing))) note.classList.add(missing);
    }
  }
}

/** Adds a class to every element of the given items. */
export function markItems(root: ParentNode, itemIds: ReadonlySet<string>, className: string): void {
  for (const element of root.querySelectorAll<HTMLElement>('[data-change-id]')) {
    element.classList.toggle(className, itemIds.has(element.dataset.changeId!));
  }
}

/**
 * Shows paragraphs joined or split by a change as one paragraph in the panel of the version that
 * has them as one. A paragraph whose mark that version lacks (right: deleted, left: inserted)
 * continues in the next paragraph it shows, which owns the surviving mark and so the paragraph's
 * properties (e.g. a list number): its content moves to the start of that paragraph, after the
 * list label, and the emptied paragraph gets `merged-into-next`. A join never crosses a table or
 * the end of its container (body, cell, note): there the paragraph stays as it is, as the export's
 * accept pass keeps it.
 */
export function mergeJoinedParagraphs(root: ParentNode, side: 'left' | 'right'): void {
  const missingMark = side === 'left' ? 'rev-para-ins' : 'rev-para-del';
  const missingBlock = side === 'left' ? 'not-in-original' : 'not-in-edited';
  const blocks = [...root.querySelectorAll<HTMLElement>(`[data-anchor].${missingMark}:not(.${missingBlock})`)];
  // Last first, so that a chain of joined paragraphs ends up in document order in the last one.
  for (const block of blocks.reverse()) {
    let next = block.nextElementSibling;
    while (next?.matches(`[data-anchor]:is(.${missingBlock}, .merged-into-next)`)) next = next.nextElementSibling;
    if (!next?.matches(PARAGRAPH_BLOCK)) continue;
    let insertBefore = next.firstChild;
    while (insertBefore?.nodeType === ELEMENT_NODE && isListLabel(insertBefore as Element)) insertBefore = insertBefore.nextSibling;
    next.insertBefore(moveChildren(block), insertBefore);
    block.classList.add('merged-into-next');
  }
}

/** The converter renders a paragraph as `p`, or `h1`–`h6` when its style has an outline level. */
const PARAGRAPH_BLOCK = ':is(p, h1, h2, h3, h4, h5, h6)[data-anchor]';

/** `Node.ELEMENT_NODE` (`Node` is not a global with jsdom in Node). */
const ELEMENT_NODE = 1;

function isListLabel(element: Element): boolean {
  return element.matches('[data-list-marker]') || element.querySelector('[data-list-marker]') !== null;
}

function moveChildren(element: Element): DocumentFragment {
  const fragment = element.ownerDocument.createDocumentFragment();
  while (element.firstChild) fragment.append(element.firstChild);
  return fragment;
}

/**
 * A typed list number replaced by automatic numbering with the same label. The engine reports the
 * deletion of the typed "8. " and, separately, a paragraph-properties change that adds the
 * numbering, which the HTML renders as an inserted label "8.". The label's paragraph either is the
 * typed number's paragraph, or follows the paragraph(s) joined into it (their marks deleted). When
 * the first text of the list item is a deletion of exactly the label, the two become one
 * formatting item (the deletion's id); the label's elements are re-tagged with it.
 */
export function combineTypedListNumbers(document: Document, items: readonly ChangeItem[]): ChangeItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const absorbed = new Set<string>();
  const combined = new Map<string, ChangeItem>();
  for (const block of document.querySelectorAll<HTMLElement>('[data-anchor]')) {
    const labels: Element[] = [];
    for (let child = block.firstElementChild; child && isListLabel(child); child = child.nextElementSibling) labels.push(child);
    const labelText = labels.map((label) => label.textContent ?? '').join('').trim();
    const numbering = byId.get(labels[0]?.closest<HTMLElement>('[data-change-id]')?.dataset.changeId ?? '');
    if (!labelText || numbering?.kind !== 'formatting' || absorbed.has(numbering.id)) continue;

    const typedElement = firstText(listItemParagraphs(block));
    const typed = byId.get(typedElement?.closest<HTMLElement>('del[data-change-id]')?.dataset.changeId ?? '');
    if (!typed || typed.kind !== 'deleted' || combined.has(typed.id)) continue;
    if (typed.removedText.replace(/[¶\s]+/gu, '') !== labelText.replace(/\s+/gu, '')) continue;

    absorbed.add(numbering.id);
    for (const element of document.querySelectorAll<HTMLElement>(`[data-change-id="${numbering.id}"]`)) element.dataset.changeId = typed.id;
    combined.set(typed.id, {
      ...typed,
      kind: 'formatting',
      revisionIds: [...typed.revisionIds, ...numbering.revisionIds],
      text: labelText,
      removedText: '',
      addedText: '',
      description: 'Typed list number replaced by automatic numbering',
      wordDelta: { removed: 0, added: 0 },
      anchors: [...new Set([...typed.anchors, ...numbering.anchors])],
    });
  }
  return items
    .filter((item) => !absorbed.has(item.id))
    .map((item, order) => ({ ...(combined.get(item.id) ?? item), order }));
}

/** The paragraphs that make up a block in the Edited document: those joined into it, then itself. */
function listItemParagraphs(block: Element): Element[] {
  const paragraphs = [block];
  for (let previous = block.previousElementSibling; previous?.matches('[data-anchor]'); previous = previous.previousElementSibling) {
    if (previous.matches('.not-in-edited')) continue;
    if (!previous.matches('.rev-para-del')) break;
    paragraphs.unshift(previous);
  }
  return paragraphs;
}

/** The element holding the first non-blank text of the paragraphs, skipping labels and rendering aids. */
function firstText(paragraphs: Element[]): Element | null {
  for (const paragraph of paragraphs) {
    const walker = paragraph.ownerDocument.createTreeWalker(paragraph, SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.closest('[data-list-marker], .rev-para-mark-del') || !node.textContent?.trim()) continue;
      return parent;
    }
  }
  return null;
}

/** `NodeFilter.SHOW_TEXT` (not a global with jsdom in Node). */
const SHOW_TEXT = 0x4;

/**
 * Splits off the words a replacement's two sides share at its edges (see `commonAffixes`) into
 * elements of their own, so that a panel can show them as plain text: a child element cannot undo
 * its parent's strikethrough. Each such element gets `data-common-needs`: the compare settings
 * (space-separated, possibly none) under which it counts as unchanged; `markCommon` applies them.
 */
export function isolateCommonAffixes(document: Document, items: readonly ChangeItem[]): void {
  for (const item of items) {
    if (item.kind !== 'replaced') continue;
    const removed = [...document.querySelectorAll<HTMLElement>(`del[data-change-id="${item.id}"]`)];
    const added = [...document.querySelectorAll<HTMLElement>(`ins[data-change-id="${item.id}"]`)];
    if (removed.length === 0 || added.length === 0) continue;
    const text = (elements: HTMLElement[]) => elements.map((element) => element.textContent ?? '').join('');
    const { prefix, suffix } = commonAffixes(text(removed), text(added));
    if (prefix.length === 0 && suffix.length === 0) continue;
    markEdge(removed, prefix, suffix, (token) => token.removedLength);
    markEdge(added, prefix, suffix, (token) => token.addedLength);
  }
}

function markEdge(elements: HTMLElement[], prefix: CommonToken[], suffix: CommonToken[], length: (token: CommonToken) => number): void {
  let pieces = elements;
  for (const token of prefix) {
    const taken = takeChars(pieces, length(token), 'start');
    for (const piece of taken.edge) piece.dataset.commonNeeds = token.needs.join(' ');
    pieces = taken.rest;
  }
  for (const token of suffix) {
    const taken = takeChars(pieces, length(token), 'end');
    for (const piece of taken.edge) piece.dataset.commonNeeds = token.needs.join(' ');
    pieces = taken.rest;
  }
}

/** Takes `count` characters from one end of the elements, splitting one element if needed. */
function takeChars(elements: HTMLElement[], count: number, from: 'start' | 'end'): { edge: HTMLElement[]; rest: HTMLElement[] } {
  const rest = from === 'start' ? [...elements] : [...elements].reverse();
  const edge: HTMLElement[] = [];
  let remaining = count;
  while (remaining > 0 && rest.length > 0) {
    const element = rest.shift()!;
    const length = element.textContent?.length ?? 0;
    if (length <= remaining) {
      edge.push(element);
      remaining -= length;
      continue;
    }
    const tail = splitElement(element, from === 'start' ? remaining : length - remaining);
    if (from === 'start') {
      edge.push(element);
      rest.unshift(tail);
    } else {
      edge.push(tail);
      rest.unshift(element);
    }
    remaining = 0;
  }
  return from === 'start' ? { edge, rest } : { edge: edge.reverse(), rest: rest.reverse() };
}

/** Splits an element at a character offset of its text; the element keeps the head, the returned copy (inserted after it) holds the tail. */
function splitElement(element: HTMLElement, offset: number): HTMLElement {
  const document = element.ownerDocument;
  const walker = document.createTreeWalker(element, SHOW_TEXT);
  let node = walker.nextNode();
  let position = offset;
  while (node && position > (node.textContent?.length ?? 0)) {
    position -= node.textContent?.length ?? 0;
    node = walker.nextNode();
  }
  const range = document.createRange();
  range.setStart(node!, position);
  range.setEnd(element, element.childNodes.length);
  const tail = element.cloneNode(false) as HTMLElement;
  tail.append(range.extractContents());
  element.after(tail);
  return tail;
}

/** Gives `change-common` to the split-off edge elements that the settings count as unchanged. */
export function markCommon(root: ParentNode, settings: CompareSettings): void {
  for (const element of root.querySelectorAll<HTMLElement>('[data-common-needs]')) {
    const needs = element.dataset.commonNeeds!.split(' ').filter(Boolean) as (keyof CompareSettings)[];
    element.classList.toggle('change-common', needs.every((name) => settings[name]));
  }
}

export interface PreparedComparison<A> {
  /** What `analyze` returned, with the items adjusted (see `prepareRenderedDocument`). */
  analysis: A;
  document: RenderedDocument;
  /** Each text change's paragraph text before and after it, for the compare settings. */
  itemTexts: Map<string, ItemText>;
}

/**
 * Parses, indexes (via `analyze`) and decorates the HTML, then turns changes that leave the text as
 * it was into formatting items: identical text (`relabelTextUnchanged`), and typed list numbers
 * replaced by the same automatic numbering (`combineTypedListNumbers`). Every element of a
 * formatting item gets `change-as-formatting`, so an `ins`/`del` of one (e.g. a list label added
 * by a paragraph-properties change) is drawn as formatting, not as an insertion or deletion.
 * Finally, the shared edges of replacements are split off (`isolateCommonAffixes`).
 */
export function prepareRenderedDocument<A extends { items: ChangeItem[]; index: DocIndex }>(
  html: string,
  analyze: (parsed: Document) => A,
  parse?: (text: string) => Document,
): PreparedComparison<A> {
  const parsed = parseRenderedHtml(html, parse);
  const analysis = analyze(parsed);
  decorateDocument(parsed, analysis.items, analysis.index);
  const itemTexts = collectItemTexts(parsed, analysis.items);
  const items = combineTypedListNumbers(parsed, relabelTextUnchanged(analysis.items, itemTexts).items);
  isolateCommonAffixes(parsed, items);
  markItems(parsed, new Set(items.filter((item) => item.kind === 'formatting').map((item) => item.id)), 'change-as-formatting');
  return { analysis: { ...analysis, items }, document: { css: documentCss(parsed), body: parsed.body }, itemTexts };
}
