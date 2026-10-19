// The Resolved column (docs/architecture.md, "Resolved column"): a copy of the redline HTML that
// shows the document as the export resolves it. Each element is shown or hidden by the resolved
// side of its own item (`resolvedItemDecisions`), set as classes so that tests can read it, and
// paragraphs whose mark the result lacks are joined into the next one, undoably, since decisions
// change.
//
// The HTML shapes this relies on (checked on every fixture and the sample, 2026-10-17):
// - Every `ins`/`del` (also `ins.rev-move-to`, `del.rev-move-from`) has its item's `data-change-id`,
//   also when the item was relabelled as formatting (`change-as-formatting`: typed list numbers,
//   identical text). Formatting spans (`span.rev-format-change`, `rev-format-marker`) carry a
//   formatting item's id, and can sit inside an `ins` of a text item.
// - A paragraph-mark revision puts its id on the block (`p.rev-para-ins`/`rev-para-del`, also
//   `h1`–`h6`), and that item can differ from the item of the block's text (`paragraph-join`: an
//   inserted item owns a `rev-para-del` block; the sample: deleted items own `rev-para-ins` blocks,
//   typed list numbers own `rev-para-del` blocks). The rule follows the element's class, never the
//   item's kind.
// - A block carries one id. The sample's closing paragraph is `rev-para-ins` and
//   `rev-section-format-change`, with the section change's id; the mark's revision is the one of
//   its inline `ins`. So its mark follows the formatting item (kept), which shows the same text: a
//   rejected insertion leaves an empty paragraph.
// - `span.rev-para-mark-del` (the ¶ glyph) has no id: a left-panel aid, always hidden here.
// - Table rows: `tr.rev-row-ins/del` carries the id, its cells don't, the cells' paragraphs carry
//   paragraph-mark ids of the same item. Formatting rows and cells (`rev-row-format-change`, …) are
//   never hidden.
// - A note's `li` has no id; its paragraphs and the reference number (`ins`/`del` around the
//   `a.footnote-ref`) have. A whole-note deletion shares one id between the reference and the note.
// - The body is `div[data-section-index]` elements whose children are the blocks; a table is
//   wrapped in a `div` without `data-anchor`. Notes follow in `section.footnotes` and
//   `section.endnotes`.
// - `.rev-del-marker`/`.rev-move-from-marker` appear on no fixture nor the sample.
//
// Marks (FR-25b): decided items get `change-accepted`/`change-rejected` (yellow in panel.css) and
// `change-decided-end` (✓/✗) on their last shown insertion or deletion and on their shown markers. A marker
// (`span.resolved-marker`, no text) follows each item's last deletion and last insertion; it is shown
// where the result drops that side and nothing of the item is left to see, and for moves at the end
// the decision removed.
//
// Comment icons (FR-27c): `span.comment-toggle` (no text) after each commented item as shown,
// placed again after every change, since joins and decisions move the item's text.
import type { Decision } from '../model/decisions';
import type { ResolvedSide } from '../model/resolved';
import { JOINED_TEXT, PARAGRAPH_BLOCK, joinParagraphs, within } from './renderedDocument';

export const RESOLVED_HIDDEN = 'resolved-hidden';
const MERGED = 'merged-into-next';
const NOTE = 'li[id^="fn-"], li[id^="en-"]';
const NOTES = 'section.footnotes, section.endnotes';
const MARKER = 'resolved-marker';
export const MARKER_SHOWN = 'resolved-marker--shown';
const DECIDED_END = 'change-decided-end';
const COMMENT_TOGGLE = 'comment-toggle';
const DIVIDER = 'range-divider';
const DEL_MARKER = '.rev-del-marker, .rev-move-from-marker';
/** Not text of the document: list labels, back links, Word's reference marks (no `w:t`), our own additions. */
const NOT_TEXT = '[data-list-marker], .fn-backref, .en-backref, a.footnote-ref, a.endnote-ref, .resolved-marker, .comment-toggle';
const NOTE_REFERENCE = 'a.footnote-ref, a.endnote-ref';
/** A note's copy for a second reference to it. */
const NOTE_COPY = 'resolved-note-copy';
const COPIED_PARAGRAPH = `.${NOTE_COPY} :is(p, h1, h2, h3, h4, h5, h6)[data-copy-of]`;
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

export interface ResolvedPanel {
  wrapper: HTMLElement;
  /** Elements of each change, by item id (without the markers). */
  elements: Map<string, HTMLElement[]>;
  /** Each item's markers: after its last deletion and its last insertion. */
  markers: Map<string, HTMLElement[]>;
  /** The items that are moves. */
  moves: Set<string>;
  /** The decisions last applied (`applyResolvedDecisions`). */
  decisions: Readonly<Record<string, Decision>>;
  /** Each paragraph block's own children, to undo joins. */
  children: Map<HTMLElement, Node[]>;
  /** The resolved sides last applied (an absent item is accepted). */
  sides: ReadonlyMap<string, ResolvedSide>;
  /** Blocks moved before the region outside the range, with where they were, in the order moved. */
  moved: { block: Element; parent: Node; next: Node | null }[];
  /**
   * Moved blocks whose mark an outside revision inserted, with the in-range items in them: the
   * mark is kept when all those are accepted (as the export does, `planRangeOrder`).
   */
  pulledMarks: Map<HTMLElement, string[]>;
  /** The references to each note (by the note's `li`). */
  noteReferences: Map<Element, Element[]>;
  /** The notes an item's decision can show or hide: those it is in, and those it references. */
  itemNotes: Map<string, Set<Element>>;
  /** The comment icons, by item id. */
  commentToggles: Map<string, HTMLElement>;
}

const isChange = (element: Element) => element.localName === 'ins' || element.localName === 'del';

/**
 * Puts a marker after the item's element; for a row insertion or deletion after its table, since
 * the row itself is hidden when the marker is needed.
 */
function placeMarker(element: HTMLElement, marker: HTMLElement, itemId: string): void {
  const row = element.closest<HTMLElement>('tr.rev-row-ins, tr.rev-row-del');
  if (row?.dataset.changeId !== itemId) {
    element.after(marker);
    return;
  }
  const table = row.closest('table')!;
  const wrapper = table.parentElement;
  if (wrapper?.localName === 'div' && !wrapper.hasAttribute('data-anchor')) wrapper.append(marker);
  else table.after(marker);
}

/**
 * The markers of each item that has insertions or deletions. An item in the body and a note (a
 * whole-note deletion) gets them in the body: the note is hidden when it goes.
 */
function insertMarkers(elements: ReadonlyMap<string, HTMLElement[]>): Map<string, HTMLElement[]> {
  const markers = new Map<string, HTMLElement[]>();
  for (const [id, list] of elements) {
    const changes = list.filter(isChange);
    const inBody = changes.filter((element) => !element.closest(NOTES));
    const where = inBody.length > 0 ? inBody : changes;
    const own: HTMLElement[] = [];
    for (const kind of ['del', 'ins'] as const) {
      const last = where.filter((element) => element.localName === kind).pop();
      if (!last) continue;
      const marker = last.ownerDocument.createElement('span');
      marker.className = MARKER;
      marker.dataset.changeId = id;
      marker.dataset.for = kind;
      placeMarker(last, marker, id);
      own.push(marker);
    }
    if (own.length > 0) markers.set(id, own);
  }
  return markers;
}

/**
 * Prepares a panel copy of the rendered document: indexes the elements by item, inserts the
 * markers and saves each paragraph's children (with the markers, so that they move with joins and
 * come back with them). The ¶ glyphs are hidden for good.
 */
export function prepareResolvedPanel(wrapper: HTMLElement): ResolvedPanel {
  const elements = new Map<string, HTMLElement[]>();
  for (const element of wrapper.querySelectorAll<HTMLElement>('[data-change-id]')) {
    const id = element.dataset.changeId!;
    const list = elements.get(id);
    if (list) list.push(element);
    else elements.set(id, [element]);
  }
  addMarksWithoutIds(wrapper, elements);
  const markers = insertMarkers(elements);
  const moves = new Set<string>();
  for (const [id, list] of elements) if (list.some((element) => element.matches('.rev-move-from, .rev-move-to'))) moves.add(id);
  const children = new Map<HTMLElement, Node[]>();
  for (const block of wrapper.querySelectorAll<HTMLElement>(PARAGRAPH_BLOCK)) children.set(block, [...block.childNodes]);
  const noteReferences = new Map<Element, Element[]>();
  const itemNotes = new Map<string, Set<Element>>();
  const addNote = (element: Element | null, note: Element) => {
    const id = element?.closest<HTMLElement>('[data-change-id]')?.dataset.changeId;
    if (id === undefined) return;
    const notes = itemNotes.get(id);
    if (notes) notes.add(note);
    else itemNotes.set(id, new Set([note]));
  };
  const notes = new Map([...wrapper.querySelectorAll(NOTE)].map((note) => [note.id, note]));
  for (const note of notes.values()) for (const element of note.querySelectorAll('[data-change-id]')) addNote(element, note);
  for (const reference of wrapper.querySelectorAll(NOTE_REFERENCE)) {
    const note = notes.get(reference.getAttribute('href')?.replace(/^#/, '') ?? '');
    if (!note) continue;
    noteReferences.set(note, [...(noteReferences.get(note) ?? []), reference]);
    // Every change around the reference.
    for (let around = reference.parentElement?.closest('[data-change-id]'); around; around = around.parentElement?.closest('[data-change-id]')) addNote(around, note);
  }
  return { wrapper, elements, markers, moves, decisions: {}, children, sides: new Map(), moved: [], pulledMarks: new Map(), noteReferences, itemNotes, commentToggles: new Map() };
}

/**
 * The ¶ glyphs and deletion markers without an id of their own: a deletion marker goes with the
 * closest change around it, the rest is always hidden.
 */
function addMarksWithoutIds(root: Element, elements: Map<string, HTMLElement[]>): void {
  for (const element of within(root, `.rev-para-mark-del, ${DEL_MARKER}`)) {
    if (element.dataset.changeId !== undefined) continue;
    const owner = element.matches(DEL_MARKER) ? element.parentElement?.closest<HTMLElement>('[data-change-id]') : null;
    const list = owner ? elements.get(owner.dataset.changeId!) : undefined;
    if (list) list.push(element);
    else element.classList.add(RESOLVED_HIDDEN);
  }
}

/**
 * Replaces a paragraph block with new markup of it (an inline edit, `block`: imported into the
 * panel's document) and shows it for the sides and decisions last applied. The run of joined
 * paragraphs around it is restored first (earlier blocks' content can be joined into it) and joined
 * again after; the maps of the items in the old or the new block are rebuilt.
 */
export function replaceResolvedBlock(handle: ResolvedPanel, old: HTMLElement, block: HTMLElement): void {
  restore(handle, [runOf(handle, old)]);
  const affected = new Set([old, ...old.querySelectorAll<HTMLElement>('[data-change-id]')].flatMap((element) => element.dataset.changeId ?? []));
  for (const element of [block, ...block.querySelectorAll<HTMLElement>('[data-change-id]')]) if (element.dataset.changeId !== undefined) affected.add(element.dataset.changeId);
  for (const id of affected) {
    for (const marker of handle.markers.get(id) ?? []) marker.remove();
    handle.markers.delete(id);
  }
  old.replaceWith(block);
  handle.children.delete(old);
  for (const entry of handle.moved) {
    if (entry.block === old) entry.block = block;
    if (entry.next === old) entry.next = block;
  }

  // The items' elements, in document order, and their markers.
  const elements = new Map<string, HTMLElement[]>();
  for (const id of affected) {
    const list = [...(handle.elements.get(id) ?? []).filter((element) => handle.wrapper.contains(element)), ...within(block, `[data-change-id="${id}"]`)];
    list.sort(inDocumentOrder);
    if (list.length > 0) elements.set(id, list);
    else handle.elements.delete(id);
  }
  addMarksWithoutIds(block, elements);
  for (const [id, list] of elements) handle.elements.set(id, list);
  for (const [id, markers] of insertMarkers(elements)) handle.markers.set(id, markers);
  handle.children.set(block, [...block.childNodes]);

  // Note references in the block, and the notes of the items (as `prepareResolvedPanel` finds them).
  const notes = new Map([...handle.wrapper.querySelectorAll(NOTE)].map((note) => [note.id, note]));
  const noteOf = (reference: Element) => notes.get(reference.getAttribute('href')?.replace(/^#/, '') ?? '');
  for (const [note, references] of handle.noteReferences) {
    const kept = references.filter((reference) => handle.wrapper.contains(reference));
    if (kept.length !== references.length) handle.noteReferences.set(note, kept);
  }
  for (const reference of block.querySelectorAll(NOTE_REFERENCE)) {
    const note = noteOf(reference);
    if (note) handle.noteReferences.set(note, [...(handle.noteReferences.get(note) ?? []), reference].sort(inDocumentOrder));
  }
  for (const id of affected) {
    const itemNotes = new Set<Element>();
    for (const element of handle.elements.get(id) ?? []) {
      const note = element.closest(NOTE);
      if (note) itemNotes.add(note);
      for (const reference of element.querySelectorAll(NOTE_REFERENCE)) {
        const referenced = noteOf(reference);
        if (referenced) itemNotes.add(referenced);
      }
    }
    if (itemNotes.size > 0) handle.itemNotes.set(id, itemNotes);
    else handle.itemNotes.delete(id);
  }

  join(handle, [runOf(handle, block)]);
  applyResolution(handle, handle.sides, affected);
  placeCommentToggles(handle);
}

/** Whether the element is hidden when its item resolves to `side`; decided by the element alone. */
function hiddenBy(element: HTMLElement, side: ResolvedSide): boolean {
  if (element.localName === 'del' || element.matches(DEL_MARKER)) return side === 'accept';
  if (element.localName === 'ins') return side === 'reject';
  if (element.localName === 'tr') {
    if (element.classList.contains('rev-row-ins')) return side === 'reject';
    if (element.classList.contains('rev-row-del')) return side === 'accept';
  }
  return false;
}

function sideOf(handle: ResolvedPanel, itemId: string | undefined): ResolvedSide {
  return (itemId !== undefined && handle.sides.get(itemId)) || 'accept';
}

/** Whether the result lacks the block's paragraph mark. */
function losesMark(handle: ResolvedPanel, block: HTMLElement): boolean {
  const pulled = handle.pulledMarks.get(block);
  if (pulled) return pulled.some((id) => sideOf(handle, id) === 'reject');
  if (block.dataset.changeId === undefined) return false;
  const side = sideOf(handle, block.dataset.changeId);
  if (block.classList.contains('rev-para-ins')) return side === 'reject';
  if (block.classList.contains('rev-para-del')) return side === 'accept';
  return false;
}

/** A block whose mark depends on a decision (its content can move into the next paragraph). */
function canLoseMark(handle: ResolvedPanel, block: Element): boolean {
  return block.classList.contains('rev-para-ins') || block.classList.contains('rev-para-del') || handle.pulledMarks.has(block as HTMLElement);
}

const isDivider = (element: Element | null) => element?.classList.contains(DIVIDER) === true;

function previousBlock(element: Element): Element | null {
  let previous = element.previousElementSibling;
  while (isDivider(previous)) previous = previous!.previousElementSibling;
  return previous;
}

function nextBlock(element: Element): Element | null {
  let next = element.nextElementSibling;
  while (isDivider(next)) next = next!.nextElementSibling;
  return next;
}

/**
 * The run of sibling paragraphs that a join can connect to the block: content flows from a block
 * into the next paragraph only when the block can lose its mark, so the run ends at the first
 * paragraph that can't, or before anything that isn't a paragraph.
 */
function runOf(handle: ResolvedPanel, block: HTMLElement): HTMLElement[] {
  const run = [block];
  for (let previous = previousBlock(block); previous?.matches(PARAGRAPH_BLOCK) && canLoseMark(handle, previous); previous = previousBlock(previous)) {
    run.push(previous as HTMLElement);
  }
  run.reverse();
  for (let last = block; canLoseMark(handle, last); ) {
    const next = nextBlock(last);
    if (!next?.matches(PARAGRAPH_BLOCK)) break;
    run.push(next as HTMLElement);
    last = next as HTMLElement;
  }
  return run;
}

/** The runs of the blocks, each once. */
function runsOf(handle: ResolvedPanel, blocks: Iterable<HTMLElement>): HTMLElement[][] {
  const seen = new Set<HTMLElement>();
  const runs: HTMLElement[][] = [];
  for (const block of blocks) {
    if (seen.has(block)) continue;
    const run = runOf(handle, block);
    for (const member of run) seen.add(member);
    runs.push(run);
  }
  return runs;
}

function restore(handle: ResolvedPanel, runs: readonly HTMLElement[][]): void {
  for (const run of runs) {
    for (const block of run) {
      const children = handle.children.get(block);
      if (children) block.replaceChildren(...children);
      block.classList.remove(MERGED, JOINED_TEXT);
    }
  }
}

function join(handle: ResolvedPanel, runs: readonly HTMLElement[][]): void {
  for (const run of runs) joinParagraphs(run, { losesMark: (block) => losesMark(handle, block), skipped: isDivider });
}

/** Every block whose mark can depend on a decision. */
function markBlocks(handle: ResolvedPanel): HTMLElement[] {
  return [...handle.wrapper.querySelectorAll<HTMLElement>(`${PARAGRAPH_BLOCK}:is(.rev-para-ins, .rev-para-del)`), ...handle.pulledMarks.keys()];
}

/**
 * Shows the resolved sides: `resolved-hidden` on what the result drops, paragraphs whose mark it
 * drops joined into the next paragraph, notes as the export keeps them (`showNote`). With `changed`, only those
 * items are updated (the others must be as in the last call); without, all.
 */
export function applyResolution(handle: ResolvedPanel, sides: ReadonlyMap<string, ResolvedSide>, changed?: Iterable<string>): void {
  handle.sides = sides;
  const ids = changed ? [...changed] : [...handle.elements.keys()];
  const blocks = new Set<HTMLElement>();
  const notes = new Set<Element>();
  for (const id of ids) {
    const side = sideOf(handle, id);
    for (const element of handle.elements.get(id) ?? []) {
      element.classList.toggle(RESOLVED_HIDDEN, hiddenBy(element, side));
      if (element.hasAttribute('data-anchor') && canLoseMark(handle, element) && element.matches(PARAGRAPH_BLOCK)) blocks.add(element);
    }
    for (const note of handle.itemNotes.get(id) ?? []) notes.add(note);
  }
  if (changed) {
    const changedIds = new Set(ids);
    for (const [block, inRange] of handle.pulledMarks) if (inRange.some((id) => changedIds.has(id))) blocks.add(block);
  } else {
    for (const block of markBlocks(handle)) blocks.add(block);
    for (const note of handle.wrapper.querySelectorAll(NOTE)) notes.add(note);
  }
  const runs = runsOf(handle, blocks);
  restore(handle, runs);
  join(handle, runs);
  updateMarks(handle, ids);
  for (const run of runs) for (const block of run) {
    const note = block.closest(NOTE);
    if (note) notes.add(note);
  }
  for (const note of notes) showNote(handle, note);
}

/**
 * Shows the decisions (FR-25b): `change-accepted`/`change-rejected` on the items' elements and
 * markers, and `change-decided-end` (✓/✗) on the last insertion or deletion shown and on the shown
 * markers. With `changed`, only those
 * items are updated; without, all. `applyResolution` keeps the marks of the items it changes.
 */
export function applyResolvedDecisions(handle: ResolvedPanel, decisions: Readonly<Record<string, Decision>>, changed?: Iterable<string>): void {
  handle.decisions = decisions;
  const ids = changed ? [...changed] : [...handle.elements.keys()];
  updateMarks(handle, ids);
  // A note's copy shows the note's marks as they were copied.
  const notes = new Set<Element>();
  for (const id of ids) for (const note of handle.itemNotes.get(id) ?? []) if (note.nextElementSibling?.classList.contains(NOTE_COPY)) notes.add(note);
  for (const note of notes) showNote(handle, note);
}

/**
 * Whether the element is shown, as far as its item's marks go: a hidden note doesn't count (its
 * marks are hidden with it, and the note's visibility comes after the marks).
 */
function shownForMarks(element: Element): boolean {
  const hidden = element.closest(`.${RESOLVED_HIDDEN}`);
  return !hidden || hidden.matches(NOTE);
}

/** `Node.DOCUMENT_POSITION_FOLLOWING` (`Node` is not a global with jsdom in Node). */
const DOCUMENT_POSITION_FOLLOWING = 4;
const follows = (element: Node, other: Node) => (other.compareDocumentPosition(element) & DOCUMENT_POSITION_FOLLOWING) !== 0;
const inDocumentOrder = (a: Node, b: Node) => (follows(b, a) ? -1 : 1);

/** The items' markers and decision marks, for the sides and decisions last applied. */
function updateMarks(handle: ResolvedPanel, ids: Iterable<string>): void {
  for (const id of ids) {
    const elements = handle.elements.get(id) ?? [];
    const markers = handle.markers.get(id) ?? [];
    const side = sideOf(handle, id);
    const changes = elements.filter((element) => isChange(element) && shownForMarks(element));
    for (const marker of markers) {
      const sideHidden = marker.dataset.for === 'del' ? side === 'accept' : side === 'reject';
      marker.classList.toggle(MARKER_SHOWN, sideHidden && (handle.moves.has(id) || changes.length === 0));
    }
    const decision = handle.decisions[id];
    for (const element of [...elements, ...markers]) {
      element.classList.toggle('change-accepted', decision === 'accepted');
      element.classList.toggle('change-rejected', decision === 'rejected');
      element.classList.remove(DECIDED_END);
    }
    if (!decision) continue;
    // The ✓/✗ after the item's text, and on each shown marker (a move shows both: its text at one
    // end, a marker at the other).
    let last: HTMLElement | null = null;
    for (const element of changes) if (!last || follows(element, last)) last = element;
    last?.classList.add(DECIDED_END);
    for (const marker of markers) if (marker.classList.contains(MARKER_SHOWN)) marker.classList.add(DECIDED_END);
  }
}

/**
 * Shows a note as the export has it (`reconcileNotes`): hidden when it has no text left, or when
 * the redline references it and no reference is left; and when two references to it are left (a
 * moved reference decided differently at its two ends), followed by a copy for the second one.
 */
function showNote(handle: ResolvedPanel, note: Element): void {
  while (note.nextElementSibling?.classList.contains(NOTE_COPY)) note.nextElementSibling.remove();
  const references = handle.noteReferences.get(note);
  const shownReferences = references?.filter((reference) => !reference.closest(`.${RESOLVED_HIDDEN}`)).length;
  const hasText = [...note.querySelectorAll(PARAGRAPH_BLOCK)].some((block) => !block.classList.contains(MERGED) && shownText(block).trim() !== '');
  const shown = hasText && shownReferences !== 0;
  note.classList.toggle(RESOLVED_HIDDEN, !shown);
  if (!shown || shownReferences === undefined) return;
  for (let i = 1; i < shownReferences; i++) {
    const copy = note.cloneNode(true) as Element;
    copy.removeAttribute('id');
    copy.classList.add(NOTE_COPY);
    for (const toggle of copy.querySelectorAll(`.${COMMENT_TOGGLE}`)) toggle.remove();
    // Anchors stay unique (the scroll sync and the range look blocks up by them).
    for (const block of copy.querySelectorAll<HTMLElement>('[data-anchor]')) {
      block.dataset.copyOf = block.dataset.anchor;
      delete block.dataset.anchor;
    }
    note.after(copy);
  }
}

/**
 * The comment icons (FR-27c): one for each item in `toggles`, whose value says whether its bubble
 * is open; the others' icons are removed. Each is placed by `placeCommentToggles`.
 */
export function applyCommentToggles(handle: ResolvedPanel, toggles: ReadonlyMap<string, boolean>): void {
  for (const [id, toggle] of handle.commentToggles) {
    if (toggles.has(id)) continue;
    toggle.remove();
    handle.commentToggles.delete(id);
  }
  for (const [id, open] of toggles) {
    let toggle = handle.commentToggles.get(id);
    if (!toggle) {
      toggle = handle.wrapper.ownerDocument.createElement('span');
      toggle.className = COMMENT_TOGGLE;
      toggle.dataset.commentFor = id;
      toggle.setAttribute('role', 'button');
      toggle.tabIndex = 0;
      handle.commentToggles.set(id, toggle);
    }
    const label = open ? 'Hide comment' : 'Show comment';
    toggle.title = label;
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('aria-expanded', String(open));
  }
  placeCommentToggles(handle);
}

/**
 * Puts each comment icon after its item as shown: after the last of its insertions, deletions and
 * shown markers (so after its ✓/✗); for an item that is only a paragraph mark, at the end of its
 * paragraph's text. An icon already in place isn't moved (it keeps the focus); one with no place
 * (nothing of the item is shown) is taken out.
 */
export function placeCommentToggles(handle: ResolvedPanel): void {
  const shown = (element: Element) => !element.closest(`.${RESOLVED_HIDDEN}, .${MERGED}`);
  for (const [id, toggle] of handle.commentToggles) {
    const elements = handle.elements.get(id) ?? [];
    const markers = (handle.markers.get(id) ?? []).filter((marker) => marker.classList.contains(MARKER_SHOWN));
    let last: Node | null = null;
    for (const element of [...elements.filter(isChange), ...markers]) if (shown(element) && (!last || follows(element, last))) last = element;
    let block: Element | null = null;
    if (!last) {
      // The last paragraph of the item; when joined into the next one, where its text went.
      const blocks = elements.filter((element) => element.matches(PARAGRAPH_BLOCK) && !element.closest(`.${RESOLVED_HIDDEN}`));
      const lastBlock = blocks[blocks.length - 1];
      if (lastBlock?.classList.contains(MERGED)) last = [...(handle.children.get(lastBlock) ?? [])].reverse().find((child) => child.isConnected) ?? null;
      else block = lastBlock ?? null;
    }
    if (last) {
      if (last.nextSibling !== toggle) last.parentNode!.insertBefore(toggle, last.nextSibling);
    } else if (block) {
      if (block.lastChild !== toggle) block.append(toggle);
    } else toggle.remove();
  }
}

/** The top-level blocks of the body: the children of its sections, without the range divider. */
function bodyBlocks(wrapper: HTMLElement): HTMLElement[] {
  return [...wrapper.querySelectorAll<HTMLElement>(':scope > div[data-section-index] > *')].filter((element) => !isDivider(element));
}

/** A top-level block's anchor: its own, or its table's for a table's wrapper. */
function anchorOf(element: HTMLElement): string | undefined {
  return element.dataset.anchor ?? element.querySelector<HTMLElement>(':scope > table[data-anchor]')?.dataset.anchor;
}

/**
 * The order around the region outside the range (FR-25b), the counterpart of the export's
 * `planRangeOrder`: the top-level blocks placed before the end point (`positions`, from
 * `blockPositions(index, suggestedEndPoint)`) that come after the first block outside the range
 * are moved, in order, to just before it (and before the range divider, if there is one). The
 * previous placement is undone first; `endPoint` `null` only undoes it. A moved block whose mark an
 * outside item (`outOfRange`) inserted keeps it when every in-range change in it is accepted.
 * Joins are redone for the sides last applied.
 */
export function applyRangeOrder(
  handle: ResolvedPanel,
  positions: ReadonlyMap<string, number>,
  endPoint: number | null,
  outOfRange: ReadonlySet<string>,
): void {
  const runs = runsOf(handle, markBlocks(handle));
  restore(handle, runs);
  for (const { block, parent, next } of handle.moved.reverse()) parent.insertBefore(block, next);
  handle.moved = [];
  handle.pulledMarks = new Map();

  if (endPoint !== null) {
    const blocks = bodyBlocks(handle.wrapper);
    const position = (block: HTMLElement) => {
      const anchor = anchorOf(block);
      return anchor === undefined ? undefined : positions.get(anchor);
    };
    const start = blocks.findIndex((block) => (position(block) ?? -1) >= endPoint);
    if (start >= 0) {
      const first = blocks[start]!;
      const before = isDivider(first.previousElementSibling) ? first.previousElementSibling! : first;
      for (const block of blocks.slice(start + 1)) {
        const at = position(block);
        if (at === undefined || at >= endPoint) continue;
        handle.moved.push({ block, parent: block.parentNode!, next: block.nextSibling });
        before.parentNode!.insertBefore(block, before);
        if (block.matches(PARAGRAPH_BLOCK) && block.classList.contains('rev-para-ins') && outOfRange.has(block.dataset.changeId ?? '')) {
          const inRange = [...block.querySelectorAll<HTMLElement>('ins[data-change-id], del[data-change-id]')]
            .map((element) => element.dataset.changeId!)
            .filter((id) => !outOfRange.has(id));
          handle.pulledMarks.set(block, [...new Set(inRange)]);
        }
      }
    }
  }
  join(handle, runsOf(handle, markBlocks(handle)));
}

/** The text a reader sees in a paragraph (whitespace as in the HTML). */
function shownText(element: Element): string {
  let text = '';
  const walk = (node: Element) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === TEXT_NODE) text += child.textContent ?? '';
      if (child.nodeType !== ELEMENT_NODE) continue;
      const childElement = child as Element;
      if (childElement.classList.contains(RESOLVED_HIDDEN) || childElement.matches(NOT_TEXT)) continue;
      if (childElement.localName === 'br' || childElement.matches('[data-docx-tab]')) text += ' ';
      // A nested paragraph (text box) is a line of its own.
      else if (!childElement.matches(PARAGRAPH_BLOCK)) walk(childElement);
    }
  };
  walk(element);
  return text;
}

/**
 * The column's text, for tests, in the form of `docxText` (test/text.ts): one line per shown
 * paragraph, body then notes (document order), whitespace-normalised, empty lines dropped.
 */
export function resolvedText(wrapper: Element): string[] {
  const lines: string[] = [];
  for (const block of wrapper.querySelectorAll(`${PARAGRAPH_BLOCK}, ${COPIED_PARAGRAPH}`)) {
    if (block.classList.contains(MERGED) || block.closest(`.${RESOLVED_HIDDEN}`)) continue;
    // The converter writes a left-to-right mark after each line break.
    const line = shownText(block).replace(/\u200e/g, '').replace(/\s+/g, ' ').trim();
    if (line) lines.push(line);
  }
  return lines;
}
