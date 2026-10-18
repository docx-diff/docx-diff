// The paragraph edit model behind inline edits in the Edited panel: a block as a sequence of
// segments, and how one text edit of its visible (Edited) text changes them. Rules:
// docs/architecture.md, "Inline edits". Pure (no DOM): shared by the main thread and the worker.
import type { RevisionListEntry } from '../engine/types';
import type { BlockScope } from './docIndex';
import { countWords, type ChangeItem } from './changes';

/** The redline part that holds a block of each scope. */
export const PART_OF_SCOPE: Record<BlockScope, string> = {
  body: '/word/document.xml',
  fn: '/word/footnotes.xml',
  en: '/word/endnotes.xml',
};

/** Stands for an inline object (note reference, tab, break, …) in visible and Original text. */
export const OBJECT_CHAR = '\uFFFC';

/** Text both versions have. */
export interface EqualSegment {
  kind: 'equal';
  text: string;
}

/** Text of one revision of one item: a deletion (hidden in the Edited panel) or an insertion. */
export interface ChangeSegment {
  kind: 'del' | 'ins';
  text: string;
  itemId: string;
  revisionId: string;
}

/** An inline object; `owner` when it is inserted or deleted content. */
export interface ObjectSegment {
  kind: 'object';
  key: string;
  owner?: { change: 'del' | 'ins'; itemId: string; revisionId: string };
}

export type Segment = EqualSegment | ChangeSegment | ObjectSegment;

export interface BlockEdit {
  /** The block's `data-anchor` (`src/engine/blockKey.ts`). */
  unid: string;
  scope: BlockScope;
  /** The block as the comparison produced it. */
  original: Segment[];
  current: Segment[];
  /** The next number for `editId`. */
  nextId: number;
}

/** Item and revision ids of the items edits create: the `e` prefix never occurs in the engine's ids (`rev…`). */
export function editId(unid: string, n: number): string {
  return `e${unid}.${n}`;
}

function isEditIdOf(unid: string, id: string): boolean {
  return id.startsWith(`e${unid}.`);
}

/** The block's text as the Edited panel shows it: no deletions, objects as `OBJECT_CHAR`. */
export function visibleText(segments: readonly Segment[]): string {
  return segments.map((segment) => {
    if (segment.kind === 'object') return segment.owner?.change === 'del' ? '' : OBJECT_CHAR;
    return segment.kind === 'del' ? '' : segment.text;
  }).join('');
}

/** The block's Original text: no insertions, objects as `OBJECT_CHAR`. */
export function originalText(segments: readonly Segment[]): string {
  return segments.map((segment) => {
    if (segment.kind === 'object') return segment.owner?.change === 'ins' ? '' : OBJECT_CHAR;
    return segment.kind === 'ins' ? '' : segment.text;
  }).join('');
}

const isSpace = (ch: string | undefined) => ch === ' ' || ch === '\u00a0';
/** Browsers type and render some spaces as no-break spaces: they don't make an edit. */
const sameChar = (a: string | undefined, b: string | undefined) => a === b || (isSpace(a) && isSpace(b));
const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** The part of the visible text an edit changed: `before.slice(start, end)` became `text`. */
export interface EditSpan {
  start: number;
  end: number;
  text: string;
}

/**
 * The changed span between two visible texts, from their common prefix and suffix (an edit is
 * one contiguous span). `caret`, the cursor's offset in `after`, places an ambiguous edit (typing
 * "a" next to an "a") where it was made: the span then contains it.
 */
export function editSpan(before: string, after: string, caret?: number): EditSpan {
  const shortest = Math.min(before.length, after.length);
  const commonSuffix = (limit: number) => {
    let s = 0;
    while (s < limit && sameChar(before[before.length - 1 - s], after[after.length - 1 - s])) s++;
    if (s > 0 && isLowSurrogate(before.charCodeAt(before.length - s))) s--;
    return s;
  };
  const commonPrefix = (limit: number) => {
    let p = 0;
    while (p < limit && sameChar(before[p], after[p])) p++;
    if (p > 0 && isHighSurrogate(before.charCodeAt(p - 1))) p--;
    return p;
  };
  let prefix: number;
  let suffix: number;
  if (caret === undefined) {
    prefix = commonPrefix(shortest);
    suffix = commonSuffix(shortest - prefix);
  } else {
    suffix = commonSuffix(Math.max(0, Math.min(shortest, after.length - caret)));
    prefix = commonPrefix(Math.min(shortest - suffix, caret));
  }
  return { start: prefix, end: before.length - suffix, text: after.slice(prefix, after.length - suffix) };
}

/** One character (UTF-16 code unit) or object of a block while an edit is applied. */
interface Unit {
  /** `newDel`/`newIns`: changed by this edit outside existing items; ids are given at the end. */
  kind: 'equal' | 'del' | 'ins' | 'object' | 'newDel' | 'newIns';
  ch: string;
  itemId?: string;
  revisionId?: string;
  object?: ObjectSegment;
  /** Changed by this edit, or next to a character it removed from an item. */
  touched?: boolean;
  removed?: boolean;
}

const isChange = (unit: Unit) => unit.kind === 'del' || unit.kind === 'ins' || unit.kind === 'newDel' || unit.kind === 'newIns';
const isNew = (unit: Unit) => unit.kind === 'newDel' || unit.kind === 'newIns';
const isVisible = (unit: Unit) =>
  unit.kind === 'object' ? unit.object!.owner?.change !== 'del' : unit.kind === 'equal' || unit.kind === 'ins';
const isWordEqual = (unit: Unit | undefined) => unit?.kind === 'equal' && !/\s/u.test(unit.ch);
const isWordInsert = (unit: Unit | undefined) => unit?.kind === 'ins' && !/\s/u.test(unit.ch);

function insertedBy(unit: Unit | undefined): { itemId: string; revisionId: string } | undefined {
  if (unit?.kind === 'ins') return { itemId: unit.itemId!, revisionId: unit.revisionId! };
  if (unit?.kind === 'object' && unit.object!.owner?.change === 'ins') return unit.object!.owner;
  return undefined;
}

function toUnits(segments: readonly Segment[]): Unit[] {
  const units: Unit[] = [];
  for (const segment of segments) {
    if (segment.kind === 'object') {
      units.push({ kind: 'object', ch: OBJECT_CHAR, object: segment });
      continue;
    }
    for (const ch of segment.text.split('')) {
      units.push(segment.kind === 'equal'
        ? { kind: 'equal', ch }
        : { kind: segment.kind, ch, itemId: segment.itemId, revisionId: segment.revisionId });
    }
  }
  return units;
}

export interface TextEditResult {
  segments: Segment[];
  nextId: number;
  /** Items this edit created (they start as accepted); empty on a change of existing items only. */
  createdItemIds: string[];
}

/**
 * Applies an edit of the block's visible text (`visibleText(segments)` → `newVisible`, NFC
 * normalized here) to its segments:
 * - deleted unchanged text becomes a new deletion; deleted inserted text leaves its insertion;
 * - typed text inside an insertion, or continuing one of its words with no space between, joins
 *   that insertion's item; other typed text is a new insertion;
 * - new pieces widen to whole words, and touching new deletions and insertions form one new item
 *   (a Replaced one when it has both); a new piece never joins an existing item;
 * - a run of changes the edit touched whose Original and Edited text are the same (typed back)
 *   becomes unchanged text again: its items lose those segments, and disappear without any.
 * Objects can't be deleted or typed: such an edit throws.
 */
export function applyTextEdit(
  segments: readonly Segment[],
  newVisible: string,
  ids: { unid: string; nextId: number; caret?: number },
): TextEditResult {
  const before = visibleText(segments);
  const span = editSpan(before, newVisible.normalize('NFC'), ids.caret);
  if (span.start === span.end && span.text === '') return { segments: [...segments], nextId: ids.nextId, createdItemIds: [] };
  if (before.slice(span.start, span.end).includes(OBJECT_CHAR)) throw new Error('An edit cannot delete an inline object');
  if (span.text.includes(OBJECT_CHAR)) throw new Error('An edit cannot insert an inline object');
  const typed = span.text.replace(/\u00a0/g, ' ');

  const units = toUnits(segments);
  const visible = units.filter(isVisible);
  const left = visible[span.start - 1];
  const right = visible[span.end];

  for (const unit of visible.slice(span.start, span.end)) {
    if (unit.kind === 'equal') {
      unit.kind = 'newDel';
      unit.touched = true;
    } else {
      unit.removed = true;
    }
  }
  let previous: Unit | undefined;
  let afterRemoved = false;
  for (const unit of units) {
    if (unit.removed) {
      if (previous && isChange(previous)) previous.touched = true;
      afterRemoved = true;
      continue;
    }
    if (afterRemoved && isChange(unit)) unit.touched = true;
    afterRemoved = false;
    previous = unit;
  }

  // Who owns the typed text.
  let leading = '';
  let middle = typed;
  let trailing = '';
  const leftOwner = insertedBy(left);
  const rightOwner = insertedBy(right);
  if (leftOwner && rightOwner && leftOwner.itemId === rightOwner.itemId) {
    leading = typed;
    middle = '';
  } else {
    const lead = isWordInsert(left) ? /^\S*/u.exec(typed)![0].length : 0;
    const trail = isWordInsert(right) ? Math.min(/\S*$/u.exec(typed)![0].length, typed.length - lead) : 0;
    leading = typed.slice(0, lead);
    middle = typed.slice(lead, typed.length - trail);
    trailing = typed.slice(typed.length - trail);
  }
  const owned = (text: string, owner: { itemId: string; revisionId: string } | undefined): Unit[] =>
    text.split('').map((ch) => ({ kind: 'ins', ch, itemId: owner!.itemId, revisionId: owner!.revisionId, touched: true }));
  const fresh: Unit[] = middle.split('').map((ch) => ({ kind: 'newIns', ch, touched: true }));

  // New text goes after the deleted span, or after the hidden deletions at the cursor; text
  // joining an insertion goes next to it.
  const deletedLast = span.end > span.start ? visible[span.end - 1] : undefined;
  const placed: Unit[] = [];
  for (const unit of units) {
    if (unit === right) {
      if (!deletedLast) placed.push(...fresh);
      placed.push(...owned(trailing, rightOwner));
    }
    if (!unit.removed) placed.push(unit);
    if (unit === left) placed.push(...owned(leading, leftOwner));
    if (unit === deletedLast) placed.push(...fresh);
  }
  if (!deletedLast && !right) placed.push(...fresh);

  const widened = widenToWords(placed);
  const cancelled = cancelTypedBack(widened);
  return toSegments(cancelled, ids.unid, ids.nextId);
}

/**
 * Widens each run of new changes to whole words (FR-7): when the run starts (ends) inside a word
 * of either version, that word's unchanged characters become part of both its deletion and its
 * insertion. A side without text continues with the unchanged neighbour, so a deleted space that
 * joins two words, or a typed one that splits a word, widens too. Then each run lists its deleted
 * characters before its inserted ones.
 */
function widenToWords(units: Unit[]): Unit[] {
  const split = new Set<Unit>();
  for (const [start, end] of runs(units, isNew)) {
    const run = units.slice(start, end);
    const firstOf = (kind: Unit['kind']) => run.find((unit) => unit.kind === kind)?.ch;
    const lastOf = (kind: Unit['kind']) => [...run].reverse().find((unit) => unit.kind === kind)?.ch;
    const wordChar = (ch: string | undefined) => ch !== undefined && !/\s/u.test(ch);
    const before = isWordEqual(units[start - 1]) ? units[start - 1]!.ch : undefined;
    const after = isWordEqual(units[end]) ? units[end]!.ch : undefined;
    if (before && (wordChar(firstOf('newDel') ?? after) || wordChar(firstOf('newIns') ?? after))) {
      for (let i = start - 1; i >= 0 && isWordEqual(units[i]); i--) split.add(units[i]!);
    }
    if (after && (wordChar(lastOf('newDel') ?? before) || wordChar(lastOf('newIns') ?? before))) {
      for (let i = end; i < units.length && isWordEqual(units[i]); i++) split.add(units[i]!);
    }
  }
  const expanded = units.flatMap((unit): Unit[] => split.has(unit)
    ? [{ kind: 'newDel', ch: unit.ch, touched: true }, { kind: 'newIns', ch: unit.ch, touched: true }]
    : [unit]);
  const ordered: Unit[] = [];
  let last = 0;
  for (const [start, end] of runs(expanded, isNew)) {
    ordered.push(...expanded.slice(last, start));
    const run = expanded.slice(start, end);
    ordered.push(...run.filter((unit) => unit.kind === 'newDel'), ...run.filter((unit) => unit.kind === 'newIns'));
    last = end;
  }
  ordered.push(...expanded.slice(last));
  return ordered;
}

/** A touched run of changes whose deleted and inserted text are the same is unchanged text. */
function cancelTypedBack(units: Unit[]): Unit[] {
  for (const [start, end] of runs(units, isChange).reverse()) {
    const run = units.slice(start, end);
    if (!run.some((unit) => unit.touched)) continue;
    const deleted = run.filter((unit) => unit.kind === 'del' || unit.kind === 'newDel');
    const inserted = run.filter((unit) => unit.kind === 'ins' || unit.kind === 'newIns');
    if (deleted.length !== inserted.length || !deleted.every((unit, i) => sameChar(unit.ch, inserted[i]!.ch))) continue;
    units.splice(start, end - start, ...deleted.map((unit): Unit => ({ kind: 'equal', ch: unit.ch })));
  }
  return units;
}

/** `[start, end)` of each maximal run of units matching `test`. */
function runs(units: readonly Unit[], test: (unit: Unit) => boolean): [number, number][] {
  const found: [number, number][] = [];
  for (let i = 0; i < units.length; i++) {
    if (!test(units[i]!)) continue;
    let end = i;
    while (end < units.length && test(units[end]!)) end++;
    found.push([i, end]);
    i = end - 1;
  }
  return found;
}

/** Gives each run of new changes its item (deletion id first) and merges units into segments. */
function toSegments(units: Unit[], unid: string, firstId: number): TextEditResult {
  let nextId = firstId;
  const createdItemIds: string[] = [];
  for (const [start, end] of runs(units, isNew)) {
    const run = units.slice(start, end);
    const delId = run.some((unit) => unit.kind === 'newDel') ? editId(unid, nextId++) : undefined;
    const insId = run.some((unit) => unit.kind === 'newIns') ? editId(unid, nextId++) : undefined;
    const itemId = (delId ?? insId)!;
    createdItemIds.push(itemId);
    for (const unit of run) {
      unit.itemId = itemId;
      unit.revisionId = unit.kind === 'newDel' ? delId : insId;
      unit.kind = unit.kind === 'newDel' ? 'del' : 'ins';
    }
  }

  const segments: Segment[] = [];
  for (const unit of units) {
    const last = segments.at(-1);
    if (unit.kind === 'object') {
      segments.push(unit.object!);
    } else if (unit.kind === 'equal') {
      if (last?.kind === 'equal') last.text += unit.ch;
      else segments.push({ kind: 'equal', text: unit.ch });
    } else if (last?.kind === unit.kind && last.revisionId === unit.revisionId && last.itemId === unit.itemId) {
      last.text += unit.ch;
    } else {
      segments.push({ kind: unit.kind as 'del' | 'ins', text: unit.ch, itemId: unit.itemId!, revisionId: unit.revisionId! });
    }
  }
  return { segments, nextId, createdItemIds };
}

/** The block as the comparison produced it. */
export function revertBlock(edit: BlockEdit): Segment[] {
  return edit.original;
}

export interface RevisionText {
  type: 'insert' | 'delete';
  text: string;
}

/** Each revision's text in the block, in order of appearance (objects add no text). */
export function revisionTexts(segments: readonly Segment[]): Map<string, RevisionText & { itemId: string }> {
  const texts = new Map<string, RevisionText & { itemId: string }>();
  const add = (change: 'del' | 'ins', itemId: string, revisionId: string, text: string) => {
    const entry = texts.get(revisionId);
    if (entry) entry.text += text;
    else texts.set(revisionId, { type: change === 'del' ? 'delete' : 'insert', text, itemId });
  };
  for (const segment of segments) {
    if (segment.kind === 'object') {
      if (segment.owner) add(segment.owner.change, segment.owner.itemId, segment.owner.revisionId, '');
    } else if (segment.kind !== 'equal') {
      add(segment.kind, segment.itemId, segment.revisionId, segment.text);
    }
  }
  return texts;
}

/**
 * Revision list entries for the revisions edits created in the block, as the engine lists its own
 * (without `constituentKeys`: the export's patch gives them, `src/engine/applyEdits.ts`).
 */
export function editRevisions(edit: Pick<BlockEdit, 'unid' | 'scope' | 'current'>): RevisionListEntry[] {
  // Kind `p` for headings too: the model reads only an anchor's `unid` (`src/model/changes.ts`).
  const anchor = { id: `p:${edit.scope}:${edit.unid}`, kind: 'p', scope: edit.scope, unid: edit.unid };
  return [...revisionTexts(edit.current)]
    .filter(([revisionId]) => isEditIdOf(edit.unid, revisionId))
    .map(([id, { type, text }]) => ({
      id,
      type,
      family: type === 'insert' ? 'content_insert' : 'content_delete',
      constituentKeys: [],
      text,
      partUri: PART_OF_SCOPE[edit.scope],
      scope: edit.scope,
      anchorId: anchor.id,
      affectedAnchors: [anchor],
      resolutionStatus: 'supported',
    }));
}

export type BlockItem = Pick<ChangeItem, 'id' | 'kind' | 'revisionIds' | 'removedText' | 'addedText' | 'wordDelta'>;

/**
 * The items of an edited block, in order of appearance, as the parts of a `ChangeItem` its
 * segments decide. An existing item (in `context.items`) keeps its id and the order of its
 * revisions; it loses the revisions the edits removed, and keeps those outside the block (a note's,
 * for an item that inserts a note reference), whose text comes from `context.revisions`. A
 * revision the edits left as it was keeps the engine's text from there too. Kinds are recomputed.
 */
export function blockItems(
  edit: Pick<BlockEdit, 'unid' | 'original' | 'current'>,
  context?: { items: ReadonlyMap<string, ChangeItem>; revisions: ReadonlyMap<string, RevisionText> },
): BlockItem[] {
  const current = revisionTexts(edit.current);
  const original = revisionTexts(edit.original);
  const order: string[] = [];
  const own = new Map<string, string[]>();
  for (const [revisionId, { itemId }] of current) {
    if (!own.has(itemId)) {
      order.push(itemId);
      own.set(itemId, []);
    }
    own.get(itemId)!.push(revisionId);
  }

  const textOf = (revisionId: string): RevisionText | undefined => {
    const engine = context?.revisions.get(revisionId);
    const now = current.get(revisionId);
    if (!now) return engine;
    return engine && original.get(revisionId)?.text === now.text ? engine : now;
  };
  return order.map((id) => {
    const existing = context?.items.get(id);
    const revisionIds = existing
      ? existing.revisionIds.filter((r) => current.has(r) || (!original.has(r) && !isEditIdOf(edit.unid, r)))
      : own.get(id)!;
    const texts = revisionIds.map(textOf).filter((text) => text !== undefined);
    const removedText = texts.filter((t) => t.type === 'delete').map((t) => t.text).join('');
    const addedText = texts.filter((t) => t.type === 'insert').map((t) => t.text).join('');
    return {
      id,
      kind: kindOf(removedText, addedText, texts[0]?.type),
      revisionIds,
      removedText,
      addedText,
      wordDelta: { removed: countWords(removedText), added: countWords(addedText) },
    };
  });
}

/** Replaced when both sides have text (`¶` alone isn't text), else the side that has it. */
function kindOf(removedText: string, addedText: string, firstType: RevisionText['type'] | undefined): BlockItem['kind'] {
  const hasText = (text: string) => !/^¶*$/.test(text);
  if (hasText(removedText) && hasText(addedText)) return 'replaced';
  if (hasText(addedText)) return 'inserted';
  if (hasText(removedText)) return 'deleted';
  return firstType === 'insert' ? 'inserted' : 'deleted';
}

/** One character (a whole code point) or object of a block, for lining up two versions of it. */
export interface AlignUnit {
  object: boolean;
  /** `''` for an object. */
  ch: string;
  side: 'equal' | 'del' | 'ins';
  revisionId?: string;
}

/** An Original-side character in both, or an inserted one only in the old block (removed), only in the new segments (typed), or in both. */
export type AlignStep<L> = { leaf: L; unit: AlignUnit } | { leaf: L; unit?: undefined } | { leaf?: undefined; unit: AlignUnit };

/**
 * Whose formatting the typed unit `steps[i]` takes (PRD-18; the display and the export's patch
 * both use this). Typed text right after deleted text replaces it (a word changed in part becomes
 * a deletion and an insertion of the whole word, which may include unformatted punctuation, e.g.
 * an italic word in plain parentheses): each typed character takes the formatting of the deleted
 * one it matches in their common start or end, and the changed middle that of the deleted
 * character before the change (as typing there would). Other typed text takes the visible
 * character before it, else the one after it. `undefined` when the block has no character.
 */
export function formattingSource<L extends AlignUnit>(steps: readonly AlignStep<L>[], i: number): L | undefined {
  const isChar = (step: AlignStep<L> | undefined): step is { leaf: L; unit: AlignUnit } => !!step?.leaf && !!step.unit && !step.leaf.object;
  // The typed run around the unit (past inserted characters the new segments remove).
  const inRun = (step: AlignStep<L> | undefined) => !!step && !(step.leaf && step.unit);
  let start = i;
  while (inRun(steps[start - 1])) start--;
  let end = i;
  while (inRun(steps[end + 1])) end++;
  const typed = steps.slice(start, end + 1).filter((step) => !step.leaf);
  const replaced: L[] = [];
  for (let j = start - 1; isChar(steps[j]) && steps[j]!.unit!.side === 'del'; j--) replaced.unshift(steps[j]!.leaf!);
  if (replaced.length > 0) {
    const at = typed.indexOf(steps[i]!);
    const shortest = Math.min(replaced.length, typed.length);
    let prefix = 0;
    while (prefix < shortest && replaced[prefix]!.ch === typed[prefix]!.unit!.ch) prefix++;
    let suffix = 0;
    while (suffix < shortest - prefix && replaced[replaced.length - 1 - suffix]!.ch === typed[typed.length - 1 - suffix]!.unit!.ch) suffix++;
    if (at < prefix) return replaced[at];
    if (at >= typed.length - suffix) return replaced[replaced.length - (typed.length - at)];
    return replaced[Math.max(0, prefix - 1)];
  }
  for (let k = start - 1; k >= 0; k--) {
    const step = steps[k];
    if (isChar(step) && step.unit.side !== 'del') return step.leaf;
  }
  for (let k = end + 1; k < steps.length; k++) {
    const step = steps[k];
    if (isChar(step) && step.unit.side !== 'del') return step.leaf;
  }
  return undefined;
}

/** The segments as units. */
export function segmentUnits(segments: readonly Segment[]): AlignUnit[] {
  const units: AlignUnit[] = [];
  for (const segment of segments) {
    if (segment.kind === 'object') {
      units.push({ object: true, ch: '', side: segment.owner?.change ?? 'equal', revisionId: segment.owner?.revisionId });
    } else {
      const revisionId = segment.kind === 'equal' ? undefined : segment.revisionId;
      for (const ch of Array.from(segment.text)) units.push({ object: false, ch, side: segment.kind, revisionId });
    }
  }
  return units;
}

/**
 * Lines up a block's units as it is (`leaves`, e.g. from its markup) with new segments' units, in
 * final order. An edit never changes the Original text, so the Original-side characters (unchanged
 * and deleted) of both correspond one to one (they may only turn from unchanged into deleted or
 * back); per gap between them, the inserted characters are matched up (same character and
 * revision), the others are removed or typed. `fail` makes the error when the Original texts differ.
 */
export function alignUnits<L extends AlignUnit>(leaves: readonly L[], units: readonly AlignUnit[], fail: (detail: string) => Error): AlignStep<L>[] {
  const isOriginal = (item: AlignUnit) => item.side !== 'ins';
  const originalLeaves = leaves.filter(isOriginal);
  const originalUnits = units.filter(isOriginal);
  if (originalLeaves.length !== originalUnits.length) throw fail('its Original text differs from the edit’s');
  originalLeaves.forEach((leaf, i) => {
    const unit = originalUnits[i]!;
    if (leaf.object !== unit.object || (!leaf.object && !sameChar(leaf.ch, unit.ch))) throw fail(`its Original text differs from the edit’s at ${i}`);
  });

  const gaps = <T extends AlignUnit>(items: readonly T[]): T[][] => {
    const found: T[][] = [[]];
    for (const item of items) {
      if (isOriginal(item)) found.push([]);
      else found.at(-1)!.push(item);
    }
    return found;
  };
  const leafGaps = gaps(leaves);
  const unitGaps = gaps(units);
  const steps: AlignStep<L>[] = [];
  leafGaps.forEach((gap, k) => {
    steps.push(...matchInserted(gap, unitGaps[k]!));
    if (k < originalLeaves.length) steps.push({ leaf: originalLeaves[k]!, unit: originalUnits[k]! });
  });
  return steps;
}

/** Matches a gap's inserted characters in the old block with the segments' (same character and revision), keeping their order. */
function matchInserted<L extends AlignUnit>(leaves: L[], units: AlignUnit[]): AlignStep<L>[] {
  const same = (leaf: L, unit: AlignUnit) =>
    leaf.object === unit.object && sameChar(leaf.ch, unit.ch) && leaf.revisionId === unit.revisionId;
  let start = 0;
  while (start < leaves.length && start < units.length && same(leaves[start]!, units[start]!)) start++;
  let end = 0;
  while (end < leaves.length - start && end < units.length - start && same(leaves[leaves.length - 1 - end]!, units[units.length - 1 - end]!)) end++;
  const head: AlignStep<L>[] = leaves.slice(0, start).map((leaf, i) => ({ leaf, unit: units[i]! }));
  const tail: AlignStep<L>[] = leaves.slice(leaves.length - end).map((leaf, i) => ({ leaf, unit: units[units.length - end + i]! }));

  // Longest common subsequence of the rest.
  const a = leaves.slice(start, leaves.length - end);
  const b = units.slice(start, units.length - end);
  const lengths = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i]![j] = same(a[i]!, b[j]!) ? lengths[i + 1]![j + 1]! + 1 : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }
  const middle: AlignStep<L>[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && same(a[i]!, b[j]!)) middle.push({ leaf: a[i++]!, unit: b[j++]! });
    else if (i < a.length && (j === b.length || lengths[i + 1]![j]! >= lengths[i]![j + 1]!)) middle.push({ leaf: a[i++]! });
    else middle.push({ unit: b[j++]! });
  }
  return [...head, ...middle, ...tail];
}
