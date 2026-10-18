// A rendered block as the segments of the paragraph edit model (`src/model/paragraphEdit.ts`),
// read from the decorated HTML, and segments rendered back into a block's markup
// (docs/architecture.md, "Inline edits"). Offsets agree with the redline paragraph's, as the
// export's patch needs (`src/engine/applyEdits.ts`): what isn't document text is skipped as
// `DocIndex` does, and each inline object is one placeholder.
import { revisionIdFromAuthor } from '../engine/tagRedline';
import { NOT_TEXT } from '../model/docIndex';
import { PARAGRAPH_BLOCK } from './renderedDocument';
import { alignUnits, revisionTexts, segmentUnits, type AlignStep, type AlignUnit, type ObjectSegment, type Segment } from '../model/paragraphEdit';

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
  | { kind: 'char'; ch: string; chain: Element[]; change?: Change }
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
        if (afterBreak && text.startsWith(BREAK_MARK)) {
          entries.push({ kind: 'keep', node: node.ownerDocument!.createTextNode(BREAK_MARK), chain });
          text = text.slice(1);
        }
        afterBreak = false;
        if (isMarkFiller(node)) {
          entries.push({ kind: 'keep', node, chain });
          continue;
        }
        const change = changeOf(chain);
        for (const ch of Array.from(text)) entries.push({ kind: 'char', ch, chain, change });
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
  const visibleChar = (step: AlignStep<Leaf>) => !!step.leaf && !!step.unit && !step.leaf.object && step.unit.side !== 'del';
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
  let source: Leaf | undefined;
  steps.forEach((step, i) => {
    if (step.leaf) {
      pieces.push(...keepsBefore.get(step.leaf)!, ...waiting);
      waiting = [];
      started = true;
      if (!step.unit) return;
      const chain = chains.get(step.leaf)!;
      const entry = step.leaf.entry;
      pieces.push(entry.kind === 'char' ? { chain, ch: entry.ch } : { chain, node: entry.element });
      if (visibleChar(step)) source = step.leaf;
      return;
    }
    const neighbour = source ?? steps.slice(i + 1).find(visibleChar)?.leaf ?? fallback;
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
export type UneditableReason = 'not-a-paragraph' | 'out-of-range' | 'move' | 'paragraph-break' | 'joined' | 'object';

/** The message shown for a click in a block that can't be edited. */
export const UNEDITABLE_MESSAGES: Record<UneditableReason, string> = {
  'not-a-paragraph': 'This can’t be edited here.',
  'out-of-range': 'This paragraph can’t be edited here: it is outside the comparison range.',
  move: 'This paragraph can’t be edited here: it contains a moved passage.',
  'paragraph-break': 'This paragraph can’t be edited here: it contains a paragraph break change.',
  joined: 'This paragraph can’t be edited here: text from another paragraph is joined into it.',
  object: 'This paragraph can’t be edited here: it contains a field or object that can’t be edited here.',
};

/**
 * Why the block of the decorated, unjoined document can't be edited (`undefined` when it can):
 * only paragraphs in the comparison range are, without move content or a paragraph-mark change,
 * not following a paragraph whose mark changes (a panel may join that one into it), and without
 * content the export's patch refuses (`uneditable`, from the compare: `CompareResult.uneditableBlocks`).
 */
export function uneditableReason(
  block: Element,
  context: { outOfRange: ReadonlySet<string>; uneditable: Readonly<Record<string, string>> },
): UneditableReason | undefined {
  const unid = (block as HTMLElement).dataset.anchor;
  if (unid === undefined || !block.matches(PARAGRAPH_BLOCK)) return 'not-a-paragraph';
  if (context.outOfRange.has(unid)) return 'out-of-range';
  if (block.querySelector('.rev-move-from, .rev-move-to')) return 'move';
  if (block.matches('.rev-para-ins, .rev-para-del') || block.querySelector('.rev-para-mark-del')) return 'paragraph-break';
  if (block.previousElementSibling?.matches('[data-anchor]:is(.rev-para-ins, .rev-para-del)')) return 'joined';
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
