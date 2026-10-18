// A rendered block as the segments of the paragraph edit model (`src/model/paragraphEdit.ts`),
// read from the decorated HTML, and segments rendered back into a block's markup
// (docs/architecture.md, "Inline edits"). Offsets agree with the redline paragraph's, as the
// export's patch needs (`src/engine/applyEdits.ts`): what isn't document text is skipped as
// `DocIndex` does, and each inline object is one placeholder.
import { revisionIdFromAuthor } from '../engine/tagRedline';
import { NOT_TEXT } from '../model/docIndex';
import { PARAGRAPH_BLOCK } from './renderedDocument';
import { alignUnits, formattingSource, revisionTexts, segmentUnits, type AlignUnit, type ObjectSegment, type Segment } from '../model/paragraphEdit';

/** `Node.TEXT_NODE`, `Node.ELEMENT_NODE` (`Node` is not a global with jsdom in Node). */
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
/** The converter writes a left-to-right mark after each line break. */
const BREAK_MARK = '\u200e';

interface Change {
  change: 'del' | 'ins';
  itemId: string;
  revisionId: string;
}

/**
 * One piece of a block's content, with `chain`: its ancestors below the block, outermost first.
 * Characters and objects are the segments' text; `keep` is anything else (list labels, ¶ glyphs,
 * back links, bookmarks, the mark after a break, fillers), which a rendering keeps in place.
 */
type Entry =
  | { kind: 'char'; ch: string; chain: Element[]; change?: Change; node: Text; at: number }
  | { kind: 'object'; key: string; element: Element; chain: Element[]; change?: Change }
  | { kind: 'keep'; node: Node; chain: Element[]; filler?: boolean };

/** The revision of the innermost `ins`/`del` of the chain, if it is one of ours. */
function changeOf(chain: readonly Element[]): Change | undefined {
  const element = chain.findLast(isChangeElement) as HTMLElement | undefined;
  if (!element) return undefined;
  const revisionId = revisionIdFromAuthor(element.dataset.author);
  if (revisionId === null) return undefined;
  return { change: element.localName as 'del' | 'ins', itemId: element.dataset.changeId ?? revisionId, revisionId };
}

const isChangeElement = (element: Element) => element.localName === 'ins' || element.localName === 'del';

function blockEntries(block: Element): Entry[] {
  const entries: Entry[] = [];
  let afterBreak = false;

  const visit = (parent: Node, chain: Element[]): void => {
    for (let node = parent.firstChild; node; node = node.nextSibling) {
      if (node.nodeType === TEXT_NODE) {
        let text = node.textContent ?? '';
        let at = 0;
        if (afterBreak && text.startsWith(BREAK_MARK)) {
          entries.push({ kind: 'keep', node: node.ownerDocument!.createTextNode(BREAK_MARK), chain });
          text = text.slice(1);
          at = 1;
        }
        afterBreak = false;
        if (isMarkFiller(node)) {
          entries.push({ kind: 'keep', node, chain });
          continue;
        }
        const change = changeOf(chain);
        for (const ch of Array.from(text)) {
          entries.push({ kind: 'char', ch, chain, change, node: node as Text, at });
          at += ch.length;
        }
        continue;
      }
      if (node.nodeType !== ELEMENT_NODE) {
        entries.push({ kind: 'keep', node, chain });
        continue;
      }
      const element = node as Element;
      if (element.matches(NOT_TEXT)) {
        entries.push({ kind: 'keep', node, chain });
        continue;
      }
      // A browser editing the panel's block puts a line break in a paragraph it emptied.
      if (element.localName === 'br' && !chain.some((frame) => frame.localName === 'del') && !followedByText(element, block)) continue;
      const key = objectKey(element);
      if (key) {
        entries.push({ kind: 'object', key, element, chain, change: changeOf(chain) });
        afterBreak = element.localName === 'br';
        continue;
      }
      const count = entries.length;
      visit(element, [...chain, element]);
      if (entries.length === count) entries.push({ kind: 'keep', node, chain });
    }
  };
  visit(block, []);

  // An empty paragraph renders a no-break space so that it has a height.
  const text = entries.filter((entry) => entry.kind !== 'keep');
  const [only] = text;
  if (text.length === 1 && only!.kind === 'char' && !only!.change && /^[\u00a0 ]$/.test(only!.ch)) {
    entries[entries.indexOf(only!)] = { kind: 'keep', node: block.ownerDocument.createTextNode(only!.ch), chain: only!.chain, filler: true };
  }
  return entries;
}

/** The block's segments: unchanged text, each revision's inserted or deleted text, inline objects. */
export function readBlockSegments(block: Element): Segment[] {
  const segments: Segment[] = [];
  for (const entry of blockEntries(block)) {
    if (entry.kind === 'keep') continue;
    const change = entry.change;
    if (entry.kind === 'object') {
      const segment: ObjectSegment = change ? { kind: 'object', key: entry.key, owner: change } : { kind: 'object', key: entry.key };
      segments.push(segment);
      continue;
    }
    const last = segments.at(-1);
    if (!change) {
      if (last?.kind === 'equal') last.text += entry.ch;
      else segments.push({ kind: 'equal', text: entry.ch });
    } else if (last && last.kind === change.change && last.itemId === change.itemId && last.revisionId === change.revisionId) {
      last.text += entry.ch;
    } else {
      segments.push({ kind: change.change, text: entry.ch, itemId: change.itemId, revisionId: change.revisionId });
    }
  }
  return segments;
}

const isVisible = (entry: Entry): entry is Extract<Entry, { kind: 'char' | 'object' }> => entry.kind !== 'keep' && entry.change?.change !== 'del';

/** Where an entry starts in the DOM. */
function startOf(entry: Extract<Entry, { kind: 'char' | 'object' }>): { node: Node; offset: number } {
  if (entry.kind === 'char') return { node: entry.node, offset: entry.at };
  const parent = entry.element.parentNode!;
  return { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, entry.element) };
}

/**
 * The offset in the block's visible text (`visibleText(readBlockSegments(block))`) of a DOM point
 * inside it (a cursor): the number of visible characters, objects as one, before it.
 */
export function visibleOffset(block: Element, node: Node, offset: number): number {
  const point = block.ownerDocument.createRange();
  point.setStart(node, offset);
  let count = 0;
  for (const entry of blockEntries(block)) {
    if (!isVisible(entry)) continue;
    const start = startOf(entry);
    if (point.comparePoint(start.node, start.offset) >= 0) break;
    count += entry.kind === 'char' ? entry.ch.length : 1;
  }
  return count;
}

/**
 * The DOM point for an offset in the block's visible text: right after the visible character or
 * object before it (so that typing there continues that character's element), or before the first
 * one for offset 0. Offsets past the end give the end.
 */
export function visiblePoint(block: Element, offset: number): { node: Node; offset: number } {
  let count = 0;
  let first: Extract<Entry, { kind: 'char' | 'object' }> | undefined;
  let last: typeof first;
  for (const entry of blockEntries(block)) {
    if (!isVisible(entry)) continue;
    first ??= entry;
    last = entry;
    const length = entry.kind === 'char' ? entry.ch.length : 1;
    if (offset > 0 && count + length >= offset) return pointAfter(entry, offset - count);
    count += length;
  }
  if (offset > 0 && last) return pointAfter(last, Infinity);
  if (first) return startOf(first);
  const text = firstText(block);
  return text ? { node: text, offset: 0 } : { node: block, offset: 0 };
}

function pointAfter(entry: Extract<Entry, { kind: 'char' | 'object' }>, units: number): { node: Node; offset: number } {
  if (entry.kind === 'char') return { node: entry.node, offset: entry.at + Math.min(units, entry.ch.length) };
  const start = startOf(entry);
  return { node: start.node, offset: start.offset + 1 };
}

function firstText(node: Node): Text | null {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === TEXT_NODE) return child as Text;
    const text = firstText(child);
    if (text) return text;
  }
  return null;
}

/** Whether text that isn't deleted follows the element in the block (the converter writes a mark after each line break). */
function followedByText(element: Element, block: Element): boolean {
  const hasText = (node: Node): boolean => {
    if (node.nodeType === TEXT_NODE) return (node.textContent ?? '') !== '';
    if (node.nodeType !== ELEMENT_NODE || (node as Element).localName === 'del') return false;
    for (let child = node.firstChild; child; child = child.nextSibling) if (hasText(child)) return true;
    return false;
  };
  for (let node: Node | null = element; node && node !== block; node = node.parentNode) {
    for (let next = node.nextSibling; next; next = next.nextSibling) if (hasText(next)) return true;
  }
  return false;
}

/** A new `ins`/`del` of a revision in a rendering; one object per revision, so that its pieces group. */
interface NewChange {
  change: 'del' | 'ins';
  revisionId: string;
}
type Frame = Element | NewChange;
const isNewChange = (frame: Frame): frame is NewChange => !('nodeType' in frame);

/** What a rendering puts in the block, inside the elements of `chain`. */
type Piece = { chain: Frame[] } & ({ ch: string } | { node: Node });

type Leaf = AlignUnit & { entry: Extract<Entry, { kind: 'char' | 'object' }> };

/**
 * The block with its content replaced by the segments, in the converter's markup (`block` is left
 * as it is). Everything that stays keeps its elements; a character that changes between unchanged
 * and deleted, or typed text, takes the elements of its neighbouring character (before it, else
 * after it), in a new `ins`/`del` unless it stays in (or joins) the revision of that character's.
 * The segments' Original text must be the block's (`readBlockSegments`): an edit never changes it.
 */
export function renderBlockSegments(block: Element, segments: readonly Segment[]): Element {
  const entries = blockEntries(block);
  const leaves: Leaf[] = [];
  const leafOf = new Map<Entry, Leaf>();
  for (const entry of entries) {
    if (entry.kind === 'keep') continue;
    const leaf: Leaf = { entry, object: entry.kind === 'object', ch: entry.kind === 'char' ? entry.ch : '', side: entry.change?.change ?? 'equal', revisionId: entry.change?.revisionId };
    leaves.push(leaf);
    leafOf.set(entry, leaf);
  }
  const units = segmentUnits(segments);
  const steps = alignUnits(leaves, units, (detail) => new Error(`Block ${(block as HTMLElement).dataset.anchor ?? ''} cannot be rendered: ${detail}`));
  const itemOf = new Map([...revisionTexts(segments)].map(([revisionId, { itemId }]) => [revisionId, itemId]));

  const newChanges = new Map<string, NewChange>();
  const newChange = (change: 'del' | 'ins', revisionId: string) => {
    const key = `${change}:${revisionId}`;
    if (!newChanges.has(key)) newChanges.set(key, { change, revisionId });
    return newChanges.get(key)!;
  };
  const isChangeFrame = (frame: Frame) => isNewChange(frame) || isChangeElement(frame);
  /** The chain for a unit put inside the elements of `chain` (those of the character it replaces or is typed next to). */
  const chainFor = (unit: AlignUnit, chain: readonly Frame[]): Frame[] => {
    const current = chain.findLast(isChangeFrame);
    const [side, revisionId] = current === undefined
      ? ['equal', undefined]
      : isNewChange(current)
        ? [current.change, current.revisionId]
        : [current.localName, revisionIdFromAuthor((current as HTMLElement).dataset.author) ?? undefined];
    if (side === unit.side && revisionId === unit.revisionId) return [...chain];
    const plain = chain.filter((frame) => !isChangeFrame(frame));
    return unit.side === 'equal' ? plain : [newChange(unit.side, unit.revisionId!), ...plain];
  };

  const chains = new Map<Leaf, Frame[]>();
  for (const step of steps) if (step.leaf && step.unit) chains.set(step.leaf, chainFor(step.unit, step.leaf.entry.chain));
  const fallback = leaves.find((leaf) => !leaf.object);
  // Text typed into an empty paragraph goes where its filler was.
  const fillerChain = entries.find((entry) => entry.kind === 'keep' && entry.filler)?.chain ?? [];

  // What isn't text stays before the character or object it came before. An empty paragraph's
  // filler goes when the paragraph gets text, and a paragraph whose text goes gets one.
  const keepsBefore = new Map<Leaf, Piece[]>();
  let keeps: Piece[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'keep') {
      keepsBefore.set(leafOf.get(entry)!, keeps);
      keeps = [];
    } else if (!(entry.filler && units.length > 0)) {
      keeps.push({ chain: entry.chain, node: entry.node });
    }
  }

  const pieces: Piece[] = [];
  // Text typed before the first character goes after what precedes that character (a list label).
  let waiting: Piece[] = [];
  let started = false;
  steps.forEach((step, i) => {
    if (step.leaf) {
      pieces.push(...keepsBefore.get(step.leaf)!, ...waiting);
      waiting = [];
      started = true;
      if (!step.unit) return;
      const chain = chains.get(step.leaf)!;
      const entry = step.leaf.entry;
      pieces.push(entry.kind === 'char' ? { chain, ch: entry.ch } : { chain, node: entry.element });
      return;
    }
    const neighbour = formattingSource(steps, i) ?? fallback;
    const piece = { chain: chainFor(step.unit, neighbour ? (chains.get(neighbour) ?? neighbour.entry.chain) : fillerChain), ch: step.unit.ch };
    if (started) pieces.push(piece);
    else waiting.push(piece);
  });
  pieces.push(...keeps, ...waiting);
  if (units.length === 0 && leaves.length > 0) {
    pieces.push({ chain: [], node: block.ownerDocument.createTextNode('\u00a0') });
  }

  const document = block.ownerDocument;
  const date = block.querySelector('ins[data-date], del[data-date]')?.getAttribute('data-date');
  const make = (frame: Frame): Element => {
    if (!isNewChange(frame)) return frame.cloneNode(false) as Element;
    const element = document.createElement(frame.change);
    element.className = frame.change === 'ins' ? 'rev-ins' : 'rev-del';
    element.setAttribute('data-author', `rev:${frame.revisionId}`);
    if (date) element.setAttribute('data-date', date);
    element.setAttribute('data-change-id', itemOf.get(frame.revisionId) ?? frame.revisionId);
    return element;
  };
  // Consecutive pieces with the same element at a depth share one copy of it.
  const build = (parent: Node, group: readonly Piece[], depth: number): void => {
    let i = 0;
    while (i < group.length) {
      const piece = group[i]!;
      const frame = piece.chain[depth];
      let j = i + 1;
      if (frame !== undefined) {
        while (j < group.length && group[j]!.chain[depth] === frame) j++;
        const element = make(frame);
        parent.appendChild(element);
        build(element, group.slice(i, j), depth + 1);
      } else if ('node' in piece) {
        parent.appendChild(piece.node.cloneNode(true));
      } else {
        let text = piece.ch;
        for (let next = group[j]; next && next.chain[depth] === undefined && 'ch' in next; next = group[++j]) text += next.ch;
        parent.appendChild(document.createTextNode(text));
      }
      i = j;
    }
  };
  const rendered = block.cloneNode(false) as Element;
  build(rendered, pieces, 0);
  return rendered;
}

/** Why a block can't be edited in the panel. */
export type UneditableReason = 'not-a-paragraph' | 'out-of-range' | 'move' | 'object';

/** The message shown for a click in a block that can't be edited. */
export const UNEDITABLE_MESSAGES: Record<UneditableReason, string> = {
  'not-a-paragraph': 'This can’t be edited here.',
  'out-of-range': 'This paragraph can’t be edited here: it is outside the comparison range.',
  move: 'This paragraph can’t be edited here: it contains a moved passage.',
  object: 'This paragraph can’t be edited here: it contains a field or object that can’t be edited here.',
};

/**
 * Why the block of the decorated, unjoined document can't be edited (`undefined` when it can):
 * only paragraphs in the comparison range are, without move content, without content the export's
 * patch refuses (`uneditable`, from the compare: `CompareResult.uneditableBlocks`), and shown in
 * the Edited version (a wholly deleted paragraph isn't). A paragraph-mark change doesn't matter:
 * while editing, the Edited panel shows the paragraphs it joins one by one.
 */
export function uneditableReason(
  block: Element,
  context: { outOfRange: ReadonlySet<string>; uneditable: Readonly<Record<string, string>> },
): UneditableReason | undefined {
  const unid = (block as HTMLElement).dataset.anchor;
  if (unid === undefined || !block.matches(PARAGRAPH_BLOCK) || block.matches('.not-in-edited')) return 'not-a-paragraph';
  if (context.outOfRange.has(unid)) return 'out-of-range';
  if (block.querySelector('.rev-move-from, .rev-move-to')) return 'move';
  if (Object.hasOwn(context.uneditable, unid)) return 'object';
  return undefined;
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
