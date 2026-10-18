// Inline edits in the Edited panel (docs/architecture.md, "Inline edits"): which blocks take the
// cursor, what typing may do there, and when the typed text becomes an update of the block. The
// browser edits the panel's copy of the block; an update reads its visible text, and the App
// replaces the block (in every panel) with the markup rendered from the edit model. Where the
// browser put the typed characters doesn't matter: only the text does.
import { NOT_TEXT } from '../model/docIndex';
import { OBJECT_CHAR, editSpan, visibleText } from '../model/paragraphEdit';
import { UNEDITABLE_MESSAGES, readBlockSegments, visibleOffset, visiblePoint, type UneditableReason } from './blockSegments';
import { PARAGRAPH_BLOCK } from './renderedDocument';

/** How an update went: the panel's block has been replaced in each case. */
export type EditOutcome = 'updated' | 'unchanged' | 'refused';

export interface EditingOptions {
  /** Why the block can't be edited; `undefined` when it can. */
  reasonOf: (unid: string) => UneditableReason | undefined;
  /** The block's visible text as last updated (before the typing in the panel). */
  textOf: (unid: string) => string;
  /** Applies the block's new visible text (`caret`: the cursor's offset in it) and replaces the panel's block. */
  onEdit: (unid: string, text: string, caret: number | undefined) => EditOutcome;
  /** Shows a short message (a blocked action). */
  onMessage: (message: string) => void;
}

const SIMPLE = 'Only simple edits within a paragraph are supported, to keep the comparison fast.';

/** The messages for blocked actions. */
export const EDIT_MESSAGES = {
  paragraphBreak: `${SIMPLE} Paragraph breaks can’t be added here.`,
  join: `${SIMPLE} Paragraphs can’t be joined here.`,
  crossBlock: `${SIMPLE} Edits must stay within one paragraph.`,
  object: 'Footnote references and other objects can’t be deleted here.',
} as const;

/** The update runs this long after the last input in a block. */
export const UPDATE_DELAY_MS = 400;

/** Inline objects of an editable block: the cursor goes around them, never into them. */
const OBJECTS = `a.footnote-ref, a.endnote-ref, [data-docx-tab], ${NOT_TEXT}`;
const BREAK_MARK = '\u200e';

/** Pasted text as typed text: line breaks and tabs as spaces, no other control characters or object placeholders. */
export function plainText(text: string): string {
  return text
    .replace(/\r\n|[\r\n\t\v\f\u2028\u2029]/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\ufffc]/g, '');
}

/** The visible text a delete removes, for a collapsed cursor at `at` (`null`: it would join paragraphs). */
export function deletedSpan(text: string, at: number, inputType: string): [number, number] | null {
  const backward = inputType.includes('Backward');
  if (backward ? at === 0 : at >= text.length) return null;
  if (inputType.includes('Line')) return backward ? [0, at] : [at, text.length];
  if (inputType.includes('Word')) {
    if (backward) {
      let from = at;
      while (from > 0 && /\s/u.test(text[from - 1]!)) from--;
      while (from > 0 && !/\s/u.test(text[from - 1]!) && text[from - 1] !== OBJECT_CHAR) from--;
      return [from === at ? at - 1 : from, at];
    }
    let to = at;
    while (to < text.length && /\s/u.test(text[to]!)) to++;
    while (to < text.length && !/\s/u.test(text[to]!) && text[to] !== OBJECT_CHAR) to++;
    return [at, to === at ? at + 1 : to];
  }
  const surrogate = (code: number) => code >= 0xd800 && code <= 0xdfff;
  if (backward) return [surrogate(text.charCodeAt(at - 1)) && at >= 2 ? at - 2 : at - 1, at];
  return [at, surrogate(text.charCodeAt(at)) && at + 2 <= text.length ? at + 2 : at + 1];
}

/** The selection as DOM points (inside the shadow root), and whether it was made backwards. */
interface Points {
  startContainer: Node;
  startOffset: number;
  endContainer: Node;
  endOffset: number;
  backward: boolean;
}

/** A selection within one block, as offsets in its visible text. */
export interface TextSelection {
  start: number;
  end: number;
  backward: boolean;
}

/**
 * The selection inside the shadow root. `document.getSelection()` reports a cursor in a shadow root
 * at its host in Chromium; `getComposedRanges` gives the real nodes (Chromium, Firefox, Safari),
 * `ShadowRoot.getSelection` is Chromium's older call.
 */
function selectionPoints(root: ShadowRoot): Points | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection) return null;
  const backward = (selection as Selection & { direction?: string }).direction === 'backward';
  const composed = (selection as Selection & { getComposedRanges?: (options: { shadowRoots: ShadowRoot[] }) => StaticRange[] }).getComposedRanges;
  if (composed) {
    const [range] = composed.call(selection, { shadowRoots: [root] });
    return range ? { ...rangePoints(range), backward } : null;
  }
  const own = (root as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.() ?? selection;
  return own.rangeCount > 0 ? { ...rangePoints(own.getRangeAt(0)), backward } : null;
}

function rangePoints(range: AbstractRange) {
  return { startContainer: range.startContainer, startOffset: range.startOffset, endContainer: range.endContainer, endOffset: range.endOffset };
}

/** The selection's offsets in the block, when the selection is all inside it. */
export function blockSelection(root: ShadowRoot, block: Element): TextSelection | null {
  const points = selectionPoints(root);
  if (!points || !block.contains(points.startContainer) || !block.contains(points.endContainer)) return null;
  return {
    start: visibleOffset(block, points.startContainer, points.startOffset),
    end: visibleOffset(block, points.endContainer, points.endOffset),
    backward: points.backward,
  };
}

/** Selects the offsets of the block's visible text. */
export function selectInBlock(block: Element, { start, end, backward }: TextSelection): void {
  const selection = block.ownerDocument.getSelection();
  if (!selection) return;
  const from = visiblePoint(block, start);
  const to = start === end ? from : visiblePoint(block, end);
  const [anchor, focus] = backward ? [to, from] : [from, to];
  selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
}

/** A block's visible text as `textOf` gives it, read from the panel's copy the browser edited. */
function typedText(block: Element, before: string): string {
  let text = visibleText(readBlockSegments(block));
  // The browser may type before the mark the converter writes after a line break.
  if (!before.includes(BREAK_MARK)) text = text.replaceAll(BREAK_MARK, '');
  // An empty paragraph's filler (a no-break space) stays next to the typed text.
  if (before === '' && text !== '') text = /[\u00a0 ]$/.test(text) ? text.slice(0, -1) : text.replace(/^[\u00a0 ]/, '');
  return text;
}

/**
 * The editing behaviour of one panel while Editable is on: `contenteditable` on the editable
 * blocks, the rules for typing (FR: simple edits within a paragraph), and the updates. `options`
 * gives the App's current callbacks; `findBlock` the panel's block of a unid.
 */
export class PanelEditing {
  /**
   * The block typed in since its last update: its text then, the span the typing changed, and the
   * cursor after the last input (which places the edit; the cursor may have moved on since).
   */
  private pending: { unid: string; before: string; span: [number, number]; caret: number | undefined } | null = null;
  private timer = 0;
  private composing = false;
  /** Set while the App replaces the block: its removal is not the reviewer leaving it. */
  private updating = false;
  private readonly listeners: [EventTarget, string, (event: Event) => void][];

  constructor(
    private readonly root: ShadowRoot,
    private readonly wrapper: HTMLElement,
    private readonly options: () => EditingOptions,
    private readonly findBlock: (unid: string) => HTMLElement | undefined,
  ) {
    this.listeners = [
      [root, 'beforeinput', (event) => this.onBeforeInput(event as InputEvent)],
      [root, 'input', (event) => this.onInput(event as InputEvent)],
      [root, 'keydown', (event) => this.onKeyDown(event as KeyboardEvent)],
      [root, 'compositionstart', () => this.onCompositionStart()],
      [root, 'compositionend', () => this.onCompositionEnd()],
      [root, 'focusout', (event) => this.onFocusOut(event)],
      [root, 'paste', (event) => this.onPaste(event as ClipboardEvent)],
      [root, 'dragstart', (event) => event.preventDefault()],
      [root, 'drop', (event) => event.preventDefault()],
      [root.ownerDocument, 'selectionchange', () => this.onSelectionChange()],
    ];
  }

  attach(): void {
    this.wrapper.classList.add('doc--editing');
    this.refresh();
    for (const [target, type, listener] of this.listeners) target.addEventListener(type, listener);
  }

  /** Stops editing; `flush` applies the input still waiting for its update first. */
  detach(flush: boolean): void {
    if (flush) this.flush(false);
    clearTimeout(this.timer);
    this.pending = null;
    for (const [target, type, listener] of this.listeners) target.removeEventListener(type, listener);
    const active = this.root.activeElement;
    if (active instanceof HTMLElement && this.wrapper.contains(active)) active.blur();
    for (const element of this.wrapper.querySelectorAll('[contenteditable]')) {
      element.removeAttribute('contenteditable');
      element.removeAttribute('spellcheck');
    }
    this.wrapper.classList.remove('doc--editing');
  }

  /** Sets which blocks take the cursor (again: e.g. after the comparison range changed). */
  refresh(): void {
    for (const block of this.wrapper.querySelectorAll<HTMLElement>(PARAGRAPH_BLOCK)) this.prepareBlock(block);
  }

  /** A block new in the panel (or one whose editability may have changed). */
  prepareBlock(block: HTMLElement): void {
    const editable = this.options().reasonOf(block.dataset.anchor!) === undefined;
    if (editable === (block.getAttribute('contenteditable') === 'true')) return;
    if (editable) {
      block.setAttribute('contenteditable', 'true');
      // The documents are in any language; the browser's dictionary would mark most words.
      block.setAttribute('spellcheck', 'false');
      for (const object of block.querySelectorAll(OBJECTS)) object.setAttribute('contenteditable', 'false');
    } else {
      for (const element of [block, ...block.querySelectorAll('[contenteditable]')]) {
        element.removeAttribute('contenteditable');
        element.removeAttribute('spellcheck');
      }
    }
  }

  /** A click in the panel: in a block that can't be edited, says why. */
  click(event: Event): void {
    const block = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-anchor]') : null;
    if (!block || !block.matches(PARAGRAPH_BLOCK)) return;
    const reason = this.options().reasonOf(block.dataset.anchor!);
    if (reason && reason !== 'not-a-paragraph') this.options().onMessage(UNEDITABLE_MESSAGES[reason]);
  }

  /** Applies the input waiting for its update; `restore` puts the cursor back where it was (when it is in the block). */
  flush(restore = true): EditOutcome | undefined {
    clearTimeout(this.timer);
    const pending = this.pending;
    if (!pending || this.updating) return undefined;
    this.pending = null;
    const block = this.findBlock(pending.unid);
    if (!block) return undefined;
    const selection = restore ? blockSelection(this.root, block) : null;
    return this.update(pending.unid, typedText(block, pending.before), pending.caret, selection);
  }

  private update(unid: string, text: string, caret: number | undefined, selection: TextSelection | null): EditOutcome {
    this.updating = true;
    let outcome: EditOutcome;
    try {
      outcome = this.options().onEdit(unid, text, caret);
    } finally {
      this.updating = false;
    }
    if (outcome === 'refused') this.options().onMessage(EDIT_MESSAGES.object);
    const block = this.findBlock(unid);
    if (block && selection) {
      block.focus({ preventScroll: true });
      selectInBlock(block, selection);
    }
    return outcome;
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.flush(), UPDATE_DELAY_MS);
  }

  /** The editable block an event comes from. */
  private blockOf(event: Event): HTMLElement | null {
    const target = event.composedPath()[0] ?? event.target;
    const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    const block = element?.closest<HTMLElement>(PARAGRAPH_BLOCK);
    return block && this.wrapper.contains(block) && block.getAttribute('contenteditable') === 'true' ? block : null;
  }

  /** Cancels the input, with a message saying why (none for what is blocked silently). */
  private refuse(event: Event, message: string | null): void {
    event.preventDefault();
    if (message) this.options().onMessage(message);
  }

  private onBeforeInput(event: InputEvent): void {
    const block = this.blockOf(event);
    const type = event.inputType;
    if (!block) return this.refuse(event, null);
    // Undo and redo of the browser don't know about the updates; formatting isn't an edit here.
    if (type.startsWith('history') || type.startsWith('format') || type === 'insertFromDrop' || type === 'deleteByDrag') return this.refuse(event, null);
    if (type === 'insertParagraph' || type === 'insertLineBreak') return this.refuse(event, EDIT_MESSAGES.paragraphBreak);
    if (type === 'insertFromPaste' || type === 'insertFromPasteAsQuotation') return this.refuse(event, null);
    const selection = blockSelection(this.root, block);
    if (!selection) return this.refuse(event, EDIT_MESSAGES.crossBlock);
    const text = visibleText(readBlockSegments(block));
    let { start, end } = selection;
    if (type.startsWith('delete') && start === end) {
      const span = deletedSpan(text, start, type);
      if (!span) return this.refuse(event, EDIT_MESSAGES.join);
      [start, end] = span;
    }
    if (text.slice(start, end).includes(OBJECT_CHAR)) return this.refuse(event, EDIT_MESSAGES.object);
    const data = type.startsWith('insert') ? (event.data ?? event.dataTransfer?.getData('text/plain') ?? '') : '';
    // Input away from the text typed since the last update (the cursor moved before `selectionchange`
    // came): that text is updated first, and this input goes through the model too, as it would
    // otherwise land in the DOM the update replaces.
    const pending = this.pending;
    const elsewhere = pending !== null && (pending.unid !== block.dataset.anchor || selection.start < pending.span[0] || selection.end > pending.span[1]);
    if (event.cancelable && (elsewhere || plainText(data) !== data)) {
      event.preventDefault();
      this.applyNow(block, plainText(data), [start, end]);
    }
  }

  private onInput(event: InputEvent): void {
    const block = this.blockOf(event);
    if (!block) return;
    const unid = block.dataset.anchor!;
    if (this.pending && this.pending.unid !== unid) this.flush(false);
    this.pending ??= { unid, before: this.options().textOf(unid), span: [0, 0], caret: undefined };
    const text = typedText(block, this.pending.before);
    const caret = blockSelection(this.root, block)?.end;
    const span = editSpan(this.pending.before, text, caret);
    this.pending.span = [span.start, span.start + span.text.length];
    this.pending.caret = caret;
    if (this.composing || event.isComposing) clearTimeout(this.timer);
    else this.schedule();
  }

  /**
   * An input applied through the model at once, after the input waiting for its update (which
   * leaves the visible text, and so the offsets, as they are): `typed` replaces the visible text
   * from `span[0]` to `span[1]` (default: the selection). For text the browser can't be left to
   * insert (it needs cleaning) or input that would land in a block the update replaces.
   */
  private applyNow(block: HTMLElement, typed: string, span?: [number, number]): void {
    const unid = block.dataset.anchor!;
    if (this.flush() === 'refused') return;
    const current = this.findBlock(unid);
    if (!current) return;
    const selection = blockSelection(this.root, current);
    if (!selection) return;
    const [start, end] = span ?? [selection.start, selection.end];
    const text = visibleText(readBlockSegments(current));
    if (text.slice(start, end).includes(OBJECT_CHAR)) return this.options().onMessage(EDIT_MESSAGES.object);
    const caret = start + typed.length;
    this.update(unid, text.slice(0, start) + typed + text.slice(end), caret, { start: caret, end: caret, backward: false });
  }

  private onPaste(event: ClipboardEvent): void {
    const block = this.blockOf(event);
    event.preventDefault();
    if (!block) return;
    if (!blockSelection(this.root, block)) return this.options().onMessage(EDIT_MESSAGES.crossBlock);
    this.applyNow(block, plainText(event.clipboardData?.getData('text/plain') ?? ''));
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.isComposing) return;
    const block = this.blockOf(event);
    if (!block) return;
    // Out of the text: the review's shortcuts work again. The panel keeps the focus (its arrow keys scroll it).
    event.preventDefault();
    this.flush(false);
    const host = this.root.host as HTMLElement;
    host.focus({ preventScroll: true });
  }

  private onCompositionStart(): void {
    this.composing = true;
    clearTimeout(this.timer);
  }

  private onCompositionEnd(): void {
    this.composing = false;
    if (this.pending) this.schedule();
  }

  private onFocusOut(event: Event): void {
    if (this.updating || !this.pending) return;
    const block = this.blockOf(event);
    if (block?.dataset.anchor === this.pending.unid) this.flush(false);
  }

  /**
   * The cursor left the text changed since the last update: update first, as an edit is one
   * contiguous span of the paragraph (typing elsewhere would replace the text between).
   */
  private onSelectionChange(): void {
    const pending = this.pending;
    if (!pending || this.composing || this.updating) return;
    const block = this.findBlock(pending.unid);
    if (!block) return;
    const selection = blockSelection(this.root, block);
    if (!selection) return;
    if (selection.start < pending.span[0] || selection.end > pending.span[1]) this.flush();
  }
}
