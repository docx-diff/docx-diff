import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import panelCss from './panel.css?inline';
import type { ChangeItem } from '../model/changes';
import type { Decision } from '../model/decisions';
import type { CompareSettings } from '../model/equivalence';
import { darkColors } from './darkColors';
import { BUBBLE_SLOT, CONTENT_CHANGED } from './CommentBubbles';
import { PanelEditing, type EditingOptions } from './editing';
import { REVERT_LABEL } from './ChangeCard';
import { CARD_SLOT } from './InlineChangeCard';
import { OverviewBar, measureMarks, measureOffset, type OverviewMark } from './OverviewBar';
import type { ResolvedSide } from '../model/resolved';
import type { Theme } from './theme';
import { PARAGRAPH_BLOCK, joinInPanel, joinRun, markCommon, markItems, mergeJoinedParagraphs, within, type RenderedDocument } from './renderedDocument';
import { readBlockSegments } from './blockSegments';
import { visibleText } from '../model/paragraphEdit';
import {
  applyCommentToggles,
  applyRangeOrder,
  applyResolution,
  applyResolvedDecisions,
  placeCommentToggles,
  prepareResolvedPanel,
  replaceResolvedBlock,
  type ResolvedPanel,
} from './resolvedView';

/** The Original, the Edited, or the Resolved column between them (the document as the export resolves it). */
export type PanelSide = 'left' | 'right' | 'resolved';

/** What the App can do to a panel's content without importing the document again. */
export interface PanelControl {
  /**
   * Replaces a paragraph block with new markup of it (an inline edit: the master document's
   * element, which is copied), shown with what the panel shows for its items; the text at the top
   * of the panel stays where it is.
   */
  replaceBlock: (unid: string, block: Element) => void;
  /** The Edited panel while editing: puts the cursor back where it last was (after a revert). */
  restoreCursor: () => void;
}

/**
 * The Edited panel's revert icons: the blocks with changes whose edit can be reverted on their own,
 * those changes per block, and what a click on one does.
 */
export interface RevertIcons {
  blocks: () => Iterable<string>;
  of: (unid: string) => ReadonlySet<string>;
  onRevert: (unid: string, itemId: string) => void;
}

const SIDE_NAMES: Record<PanelSide, string> = { left: 'Original', right: 'Edited', resolved: 'Resolved' };

interface Props {
  side: PanelSide;
  /** In dark mode the document's own colours are made dark too (darkColors.ts). */
  theme: Theme;
  /** Justified paragraphs are shown aligned to the start (the Display setting). */
  leftAligned?: boolean;
  title: string;
  /** The title's tooltip, when not the title itself. */
  titleTooltip?: string;
  /** Controls shown after the title (the Resolved column's Comments button). */
  headerControls?: ReactNode;
  document: RenderedDocument;
  /** Changes the compare settings ignore: shown as plain text. */
  ignored: ReadonlySet<string>;
  /** Decides which shared edges of replacements are shown as plain text. */
  settings: CompareSettings;
  decisions: Readonly<Record<string, Decision>>;
  currentItemId: string | null;
  /** A click on the panel's text: the ids of the changes around the clicked point, innermost first. */
  onChangeClick: (itemIds: string[]) => void;
  /** The changes the overview bar shows (none in the Resolved column, which has no bar). */
  overviewItems: readonly ChangeItem[];
  /** Changes outside the comparison range: plain text, greyed in the Edited's panel. */
  outOfRangeItems: ReadonlySet<string>;
  /** Blocks outside the comparison range (the Original's and the Resolved panel): greyed, after a divider. */
  outOfRangeBlocks?: ReadonlySet<string>;
  /**
   * The Resolved column only: each item's resolved side (`resolvedItemDecisions`), and what the
   * order around the region outside the range needs (`applyRangeOrder`): the blocks' positions and
   * the end point.
   */
  resolved?: { sides: ReadonlyMap<string, ResolvedSide>; positions: ReadonlyMap<string, number>; endPoint: number | null };
  /** Scrolls a panel without the scroll sync following (keeps the Resolved column's text in place). */
  scrollQuietly?: (scroller: HTMLElement, top: number) => void;
  /**
   * Set while the reviewer picks a paragraph: a click on the text gives the `data-anchor` unids
   * around the clicked point, innermost first, instead of selecting a change.
   */
  onPickParagraph?: (unids: string[]) => void;
  /** Shown over the text, scrolling with it (the current change's card, FR-28a). */
  card?: ReactNode;
  /**
   * The Resolved column only: the commented items, each with whether its bubble is open (a comment
   * icon after each, FR-27c), what a click on an icon does, and the bubbles (`CommentBubbles`).
   */
  commentToggles?: ReadonlyMap<string, boolean>;
  onToggleComment?: (itemId: string) => void;
  bubbles?: ReactNode;
  /** Receives the panel's `PanelControl`. */
  controlRef?: Ref<PanelControl>;
  /**
   * The Edited panel while Editable is on: its paragraphs can be edited, and a click doesn't
   * select a change (`editing.ts`).
   */
  editing?: EditingOptions;
  /**
   * The Edited panel: a ↺ after each change whose edit can be reverted on its own
   * (`placeRevertIcons`), while Editable is off.
   */
  revertIcons?: RevertIcons;
}

const NO_BLOCKS: ReadonlySet<string> = new Set();
const JUSTIFIED = /text-align\s*:\s*justify/gi;

/**
 * The document's own look (CSS or a `style` attribute) as the panel shows it: its colours for the
 * theme (darkColors.ts), and justified paragraphs aligned to the start when `leftAligned` (narrow
 * columns read better without justification; centred and right-aligned text stays so).
 */
function documentLook(css: string, theme: Theme, leftAligned: boolean): string {
  const aligned = leftAligned ? css.replace(JUSTIFIED, 'text-align: start') : css;
  return theme === 'dark' ? darkColors(aligned) : aligned;
}

const NO_SIDES: ReadonlyMap<string, ResolvedSide> = new Map();
const NO_POSITIONS: ReadonlyMap<string, number> = new Map();
const NO_TOGGLES: ReadonlyMap<string, boolean> = new Map();
const COMMENT_TOGGLE = '.comment-toggle';
const NOTE = 'li[id^="fn-"], li[id^="en-"]';

/** Elements of each change in one panel, by item id. */
type ElementMap = Map<string, HTMLElement[]>;

function elementMap(root: ParentNode): ElementMap {
  const map: ElementMap = new Map();
  for (const element of root.querySelectorAll<HTMLElement>('[data-change-id]')) {
    const id = element.dataset.changeId!;
    const list = map.get(id);
    if (list) list.push(element);
    else map.set(id, [element]);
  }
  return map;
}

/**
 * Shows an item's decision on its elements (FR-25): `change-accepted` / `change-rejected`, and
 * `change-decided-end` on its last insertion or deletion this panel shows, which carries the ✓ / ✗.
 */
function applyDecision(elements: readonly HTMLElement[], decision: Decision | undefined, side: 'left' | 'right'): void {
  for (const element of elements) {
    element.classList.toggle('change-accepted', decision === 'accepted');
    element.classList.toggle('change-rejected', decision === 'rejected');
    element.classList.remove('change-decided-end');
  }
  if (!decision) return;
  const shownHere = side === 'left' ? 'del' : 'ins';
  for (let i = elements.length - 1; i >= 0; i--) {
    if (elements[i]!.localName !== shownHere) continue;
    elements[i]!.classList.add('change-decided-end');
    break;
  }
}

/**
 * The Edited panel's run of joined paragraphs shown one by one (`joinRun`, while editing): the
 * paragraph they join into is hidden when it has no text of its own (e.g. the empty paragraph left
 * where a blank line was removed), else the paragraphs before it show their deleted ¶. A hidden
 * one lends the paragraphs shown in its place its look (the converter's paragraph classes and
 * style): the Edited gives the joined paragraph its properties, e.g. the spacing that replaced the
 * blank line. The run's blocks are copies of the master's, so joining again restores their own.
 */
function markUnjoined(run: readonly HTMLElement[]): void {
  const target = run.at(-1);
  if (!target || run.length < 2 || target.classList.contains('rev-para-del')) return;
  const empty = visibleText(readBlockSegments(target)) === '';
  target.classList.toggle('unjoined-empty', empty);
  for (const block of run.slice(0, -1)) {
    if (!block.classList.contains('rev-para-del') || block.classList.contains('not-in-edited')) continue;
    block.classList.toggle('unjoined-continues', !empty);
    if (empty) takeParagraphLook(block, target);
  }
}

/**
 * A block of a run shown one by one, swapped alone (an update of it): it shows as the panel's block
 * it replaces (`old`) did; the run's other blocks stay as they are, as one of them may hold the
 * cursor. `run` is the master's run, `panelTarget` the panel's copy of the paragraph it joins into.
 */
function keepUnjoined(block: HTMLElement, old: HTMLElement, run: readonly Element[], panelTarget: HTMLElement | undefined): void {
  for (const name of ['unjoined-empty', 'unjoined-continues']) block.classList.toggle(name, old.classList.contains(name));
  const target = run.at(-1) as HTMLElement | undefined;
  const inPlaceOfTarget = block.classList.contains('rev-para-del') && !block.classList.contains('not-in-edited');
  if (target && target.dataset.anchor !== block.dataset.anchor && inPlaceOfTarget && panelTarget?.classList.contains('unjoined-empty')) {
    takeParagraphLook(block, target);
  }
}

/**
 * The converter's paragraph classes (`docx-…`) and style of `source` in place of the block's own.
 * Not across tags: the converter's rules name them (`p.docx-Normal`), so a heading keeps its look.
 */
function takeParagraphLook(block: HTMLElement, source: HTMLElement): void {
  if (block.localName !== source.localName) return;
  const isLook = (name: string) => name.startsWith('docx-');
  block.classList.remove(...[...block.classList].filter(isLook));
  block.classList.add(...[...source.classList].filter(isLook));
  const style = source.getAttribute('style');
  if (style === null) block.removeAttribute('style');
  else block.setAttribute('style', style);
}

const REVERT_ICON = 'edit-revert';

/**
 * The block's ↺ icons, one after the last piece of each of `itemIds` (its last insertion, else its
 * last deletion, which the Edited panel hides), after the ✓ / ✗ that piece's `::after` shows. Not
 * text (`NOT_TEXT`): the segment reader and the cursor offsets skip them.
 *
 * Only while Editable is off: an icon is an element without text that can't be edited, inside the
 * paragraph's text. In an editable paragraph Chromium's caret stops in front of it (ArrowRight
 * stays there), and Delete or Backspace next to it removes the icon or a hidden deletion (`display:
 * none`, Original text) instead of the character the reviewer sees, so keys seem swallowed, the
 * cursor seems to jump, and the keys pressed after that remove other text. A test sending random
 * keys found it with the icons in the text and nothing without them (`e2e/editingFuzz.spec.ts`;
 * docs/architecture.md, "Inline edits", "Reverts").
 */
export function placeRevertIcons(block: HTMLElement, itemIds: ReadonlySet<string>): void {
  for (const icon of within(block, `.${REVERT_ICON}`)) icon.remove();
  if (itemIds.size === 0) return;
  const last = new Map<string, HTMLElement>();
  for (const element of within(block, 'ins[data-change-id], del[data-change-id]')) {
    const id = element.dataset.changeId!;
    if (!itemIds.has(id)) continue;
    const shown = last.get(id);
    if (!shown || element.localName === 'ins' || shown.localName === 'del') last.set(id, element);
  }
  for (const [id, element] of last) {
    const icon = block.ownerDocument.createElement('span');
    icon.className = REVERT_ICON;
    icon.dataset.revertId = id;
    icon.setAttribute('role', 'button');
    icon.setAttribute('contenteditable', 'false');
    icon.tabIndex = 0;
    icon.title = REVERT_LABEL;
    icon.setAttribute('aria-label', REVERT_LABEL);
    element.after(icon);
  }
}

/** The first block shown at the top of the panel, and its offset from the panel's top. */
function topBlock(scroller: HTMLElement, wrapper: Element): { block: Element; offset: number } | null {
  const top = scroller.getBoundingClientRect().top;
  for (const block of wrapper.querySelectorAll('[data-anchor]')) {
    const box = block.getBoundingClientRect();
    if (box.height === 0 && box.width === 0) continue;
    if (box.bottom > top) return { block, offset: box.top - top };
  }
  return null;
}

/**
 * One document panel. The rendered HTML goes into a shadow root, so the converter's stylesheet
 * (which styles `p`, `span`, `table`, … globally) stays inside the panel. The forwarded ref is the
 * scrolling element, which is also the shadow host.
 */
export const DocumentPanel = forwardRef<HTMLDivElement, Props>(function DocumentPanel(props, ref) {
  const { side, theme, title, document, ignored, settings, decisions, currentItemId, onChangeClick, overviewItems, outOfRangeItems, onPickParagraph } = props;
  const outOfRangeBlocks = props.outOfRangeBlocks ?? NO_BLOCKS;
  const resolvedSides = props.resolved?.sides ?? NO_SIDES;
  const positions = props.resolved?.positions ?? NO_POSITIONS;
  const endPoint = props.resolved?.endPoint ?? null;
  const commentToggles = props.commentToggles ?? NO_TOGGLES;
  const scrollQuietly = useRef(props.scrollQuietly);
  scrollQuietly.current = props.scrollQuietly;
  const scrollerRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => scrollerRef.current!, []);
  const elementsRef = useRef<ElementMap>(new Map());
  const blocksRef = useRef<HTMLElement[]>([]);
  const documentStyleRef = useRef<HTMLStyleElement | null>(null);
  /** Elements with a `style` attribute, and its value as the converter wrote it. */
  const styledRef = useRef<[HTMLElement, string][]>([]);
  const appliedDecisions = useRef<Readonly<Record<string, Decision>>>({});
  const appliedCurrent = useRef<string | null>(null);
  /** The Resolved column's state, and the resolved sides last applied (null: none yet). */
  const resolvedRef = useRef<ResolvedPanel | null>(null);
  const appliedSides = useRef<ReadonlyMap<string, ResolvedSide> | null>(null);
  const appliedToggles = useRef<ReadonlyMap<string, boolean> | null>(null);
  const [contentVersion, setContentVersion] = useState(0);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const leftAligned = props.leftAligned ?? false;
  const leftAlignedRef = useRef(leftAligned);
  leftAlignedRef.current = leftAligned;
  const look = (css: string) => documentLook(css, themeRef.current, leftAlignedRef.current);
  /** The props a block replacement reads (it runs outside rendering). */
  const latest = useRef({ ignored, settings, outOfRangeItems });
  latest.current = { ignored, settings, outOfRangeItems };
  const documentRef = useRef(document);
  documentRef.current = document;
  /** Editing while Editable is on; the options are the last given (turning it off applies the waiting input with them). */
  const editingRef = useRef<PanelEditing | null>(null);
  const editingOptions = useRef(props.editing);
  if (props.editing) editingOptions.current = props.editing;
  const editingOn = props.editing !== undefined;

  const revertIconsRef = useRef(props.revertIcons);
  revertIconsRef.current = props.revertIcons;
  /** Set while Editable is on: no revert icons in the text then (`placeRevertIcons`). */
  const iconsHiddenRef = useRef(false);
  /** Puts the revert icons in every block that has some (Editable turned off). */
  const placeAllRevertIcons = () => {
    const icons = revertIconsRef.current;
    if (!icons || iconsHiddenRef.current) return;
    const shown = new Map(blocksRef.current.map((block) => [block.dataset.anchor!, block]));
    for (const unid of icons.blocks()) {
      const block = shown.get(unid);
      if (block) placeRevertIcons(block, icons.of(unid));
    }
  };

  /** The Edited panel shows the paragraphs it joins one by one (while editing): each can be edited as itself. */
  const unjoinedRef = useRef(false);

  /**
   * Puts copies of master blocks in place of the panel's (runs of siblings, `joinRun`), joined as the
   * panel joins them (unless unjoined), with the panel's classes, decisions and current change.
   * Returns false when the panel has none of them (not shown). With `alone` (a master block of the
   * one run given, while unjoined), only that block is swapped (`keepUnjoined`).
   */
  const swapRuns = (runs: readonly (readonly Element[])[], alone?: Element): boolean => {
    const wrapper = scrollerRef.current?.shadowRoot?.querySelector<HTMLElement>('.doc');
    if (!wrapper || side === 'resolved') return false;
    const shown = new Map(blocksRef.current.map((block) => [block.dataset.anchor!, block]));
    const owner = wrapper.ownerDocument;
    const swapped: HTMLElement[] = [];
    for (const run of runs) {
      const blocks: HTMLElement[] = [];
      for (const source of run) {
        if (alone && source !== alone) continue;
        const old = shown.get((source as HTMLElement).dataset.anchor!);
        if (!old) continue;
        const block = owner.importNode(source, true) as HTMLElement;
        block.classList.toggle('out-of-range', old.classList.contains('out-of-range'));
        styledRef.current = styledRef.current.filter(([element]) => !old.contains(element));
        old.replaceWith(block);
        if (alone) keepUnjoined(block, old, run, shown.get((run.at(-1) as HTMLElement).dataset.anchor!));
        blocks.push(block);
      }
      if (!alone) {
        if (unjoinedRef.current) markUnjoined(blocks);
        else joinInPanel(blocks, side);
      }
      swapped.push(...blocks);
    }
    if (swapped.length === 0) return false;

    const styled = swapped.flatMap((block) => Array.from(within(block, '[style]'), (element): [HTMLElement, string] => [element, element.getAttribute('style')!]));
    for (const [element, style] of styled) element.setAttribute('style', look(style));
    styledRef.current = [...styledRef.current, ...styled];
    const { ignored, settings, outOfRangeItems } = latest.current;
    for (const block of swapped) {
      markItems(block, ignored, 'change-ignored');
      markCommon(block, settings);
      markItems(block, outOfRangeItems, 'change-out-of-range');
    }
    blocksRef.current = [...wrapper.querySelectorAll<HTMLElement>('[data-anchor]')];
    elementsRef.current = elementMap(wrapper);
    const ids = new Set(swapped.flatMap((block) => within(block, '[data-change-id]').map((element) => element.dataset.changeId!)));
    for (const id of ids) applyDecision(elementsRef.current.get(id) ?? [], appliedDecisions.current[id], side);
    const current = appliedCurrent.current;
    if (current !== null && ids.has(current)) for (const element of elementsRef.current.get(current) ?? []) element.classList.add('change-current');
    const icons = iconsHiddenRef.current ? undefined : revertIconsRef.current;
    if (icons) for (const block of swapped) for (const paragraph of within(block, '[data-anchor]')) placeRevertIcons(paragraph, icons.of(paragraph.dataset.anchor!));
    for (const block of swapped) for (const paragraph of within(block, PARAGRAPH_BLOCK)) editingRef.current?.prepareBlock(paragraph);
    return true;
  };

  /** Keeps the text at the top of the panel where it is while `change` changes the content above or in it. */
  const keepingTop = (change: () => boolean) => {
    const scroller = scrollerRef.current;
    const wrapper = scroller?.shadowRoot?.querySelector<HTMLElement>('.doc');
    if (!scroller || !wrapper) return;
    const anchor = scroller.scrollTop > 0 ? topBlock(scroller, wrapper) : null;
    const anchorUnid = (anchor?.block as HTMLElement | undefined)?.dataset.anchor;
    if (!change()) return;
    const kept = anchor && (anchor.block.isConnected ? anchor.block : blocksRef.current.find((block) => block.dataset.anchor === anchorUnid));
    if (anchor && kept && kept.getClientRects().length > 0) {
      const offset = kept.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const top = scroller.scrollTop + offset - anchor.offset;
      if (scrollQuietly.current) scrollQuietly.current(scroller, top);
      else scroller.scrollTop = top;
    }
    scroller.dispatchEvent(new Event(CONTENT_CHANGED));
  };

  /** Joins the Edited panel's joined paragraphs again, or shows them one by one. */
  const setUnjoined = (unjoined: boolean) => {
    if (side !== 'right' || unjoinedRef.current === unjoined) return;
    unjoinedRef.current = unjoined;
    const runs: Element[][] = [];
    const seen = new Set<Element>();
    for (const block of document.body.querySelectorAll('[data-anchor].rev-para-del:not(.not-in-edited)')) {
      if (seen.has(block)) continue;
      const run = joinRun(block, 'right');
      for (const element of run) seen.add(element);
      runs.push(run);
    }
    keepingTop(() => swapRuns(runs));
  };

  useImperativeHandle(
    props.controlRef,
    () => ({
      replaceBlock(unid, source) {
        const scroller = scrollerRef.current;
        const wrapper = scroller?.shadowRoot?.querySelector<HTMLElement>('.doc');
        if (!scroller || !wrapper) return;
        if (side !== 'resolved') {
          // Paragraphs shown one by one (editing) don't depend on each other: the others keep their elements (and the cursor).
          keepingTop(() => swapRuns([joinRun(source, side)], unjoinedRef.current ? source : undefined));
          return;
        }
        const at = blocksRef.current.findIndex((block) => block.dataset.anchor === unid);
        if (at < 0) return;
        const old = blocksRef.current[at]!;
        keepingTop(() => {
          const block = wrapper.ownerDocument.importNode(source, true) as HTMLElement;
          block.classList.toggle('out-of-range', old.classList.contains('out-of-range'));
          const styled = Array.from(within(block, '[style]'), (element): [HTMLElement, string] => [element, element.getAttribute('style')!]);
          for (const [element, style] of styled) element.setAttribute('style', look(style));
          styledRef.current = [...styledRef.current.filter(([element]) => !old.contains(element)), ...styled];
          const { ignored, settings, outOfRangeItems } = latest.current;
          markItems(block, ignored, 'change-ignored');
          markCommon(block, settings);
          markItems(block, outOfRangeItems, 'change-out-of-range');
          replaceResolvedBlock(resolvedRef.current!, old, block);
          blocksRef.current = blocksRef.current.with(at, block);
          elementsRef.current = elementMap(wrapper);
          const current = appliedCurrent.current;
          if (current !== null) for (const element of within(block, '[data-change-id]')) if (element.dataset.changeId === current) element.classList.add('change-current');
          return true;
        });
      },
      restoreCursor() {
        editingRef.current?.restoreCursor();
      },
    }),
    // The helpers read refs only, and the master document's runs.
    [side, document],
  );

  useLayoutEffect(() => {
    const host = scrollerRef.current!;
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    const owner = host.ownerDocument;
    const documentStyle = owner.createElement('style');
    const panelStyle = owner.createElement('style');
    panelStyle.textContent = panelCss;
    const wrapper = owner.createElement('div');
    wrapper.className = 'doc';
    wrapper.dataset.side = side;
    wrapper.append(...Array.from(document.body.childNodes, (node) => owner.importNode(node, true)));
    if (side === 'resolved') resolvedRef.current = prepareResolvedPanel(wrapper);
    else mergeJoinedParagraphs(wrapper, side);
    // The document's look (colours for the theme, alignment) goes in with the content: changing its
    // style sheet once the content is in makes the browser restyle the whole document (0.7 s on the
    // ~300-page pair).
    const styled = Array.from(wrapper.querySelectorAll<HTMLElement>('[style]'), (element): [HTMLElement, string] => [element, element.getAttribute('style')!]);
    documentStyle.textContent = look(document.css);
    for (const [element, style] of styled) {
      const shown = look(style);
      if (shown !== style) element.setAttribute('style', shown);
    }
    const cardSlot = owner.createElement('slot');
    cardSlot.name = CARD_SLOT;
    const bubbleSlot = owner.createElement('slot');
    bubbleSlot.name = BUBBLE_SLOT;
    root.replaceChildren(documentStyle, panelStyle, wrapper, cardSlot, bubbleSlot);
    host.scrollTop = 0;
    elementsRef.current = elementMap(wrapper);
    blocksRef.current = [...wrapper.querySelectorAll<HTMLElement>('[data-anchor]')];
    documentStyleRef.current = documentStyle;
    styledRef.current = styled;
    appliedDecisions.current = {};
    appliedCurrent.current = null;
    appliedSides.current = null;
    appliedToggles.current = null;
    setContentVersion((version) => version + 1);
  }, [document, side]);

  useLayoutEffect(() => {
    const documentStyle = documentStyleRef.current!;
    const css = documentLook(document.css, theme, leftAligned);
    if (documentStyle.textContent !== css) documentStyle.textContent = css;
    for (const [element, style] of styledRef.current) {
      const shown = documentLook(style, theme, leftAligned);
      if (element.getAttribute('style') !== shown) element.setAttribute('style', shown);
    }
  }, [document, side, theme, leftAligned]);

  useLayoutEffect(() => {
    const root = scrollerRef.current?.shadowRoot;
    if (!root) return;
    markItems(root, ignored, 'change-ignored');
    markCommon(root, settings);
  }, [document, ignored, settings]);

  // The comparison range: changes outside it, and in the Original's panel the blocks outside it,
  // with a divider before the first one shown.
  useLayoutEffect(() => {
    const root = scrollerRef.current?.shadowRoot;
    const wrapper = root?.querySelector('.doc');
    if (!root || !wrapper) return;
    markItems(root, outOfRangeItems, 'change-out-of-range');
    wrapper.querySelector('.range-divider')?.remove();
    // In the Resolved column, in-range blocks the engine placed after the region outside the range
    // move before it, as the export places them.
    if (resolvedRef.current) {
      applyRangeOrder(resolvedRef.current, positions, endPoint, outOfRangeItems);
      placeCommentToggles(resolvedRef.current);
    }
    let first: HTMLElement | null = null;
    for (const block of blocksRef.current) {
      const out = outOfRangeBlocks.has(block.dataset.anchor!);
      block.classList.toggle('out-of-range', out);
      if (out && !first && !block.closest(`.not-in-original, .merged-into-next, ${NOTE}`)) first = block;
    }
    for (const note of wrapper.querySelectorAll(NOTE)) {
      const blocks = [...note.querySelectorAll('[data-anchor]')];
      note.classList.toggle('out-of-range', blocks.length > 0 && blocks.every((block) => block.classList.contains('out-of-range')));
    }
    if (first) {
      const divider = root.ownerDocument.createElement('div');
      divider.className = 'range-divider';
      divider.setAttribute('role', 'separator');
      divider.textContent = 'End of the comparison · the rest is treated as unedited';
      first.before(divider);
    }
    scrollerRef.current!.dispatchEvent(new Event(CONTENT_CHANGED));
  }, [document, outOfRangeItems, outOfRangeBlocks, positions, endPoint, contentVersion]);

  useLayoutEffect(() => {
    scrollerRef.current?.shadowRoot?.querySelector('.doc')?.classList.toggle('doc--picking', onPickParagraph !== undefined);
  }, [onPickParagraph, contentVersion]);

  useLayoutEffect(() => {
    const root = scrollerRef.current?.shadowRoot;
    const wrapper = root?.querySelector<HTMLElement>('.doc');
    if (!editingOn || !root || !wrapper) return;
    const findBlock = (unid: string) => blocksRef.current.find((block) => block.dataset.anchor === unid);
    iconsHiddenRef.current = true;
    for (const icon of wrapper.querySelectorAll(`.${REVERT_ICON}`)) icon.remove();
    setUnjoined(true);
    const editing = new PanelEditing(root, wrapper, () => editingOptions.current!, findBlock);
    editing.attach();
    editingRef.current = editing;
    const attachedTo = documentRef.current;
    return () => {
      editingRef.current = null;
      // A new document is a new review: what was typed in the old one is dropped (and the panel is filled anew).
      const same = documentRef.current === attachedTo;
      iconsHiddenRef.current = false;
      editing.detach(same);
      if (same) {
        setUnjoined(false);
        placeAllRevertIcons();
      } else {
        unjoinedRef.current = false;
      }
    };
  }, [editingOn, contentVersion]);

  // Which blocks can be edited changes with the comparison range.
  const reasonOf = props.editing?.reasonOf;
  useLayoutEffect(() => {
    if (reasonOf) editingRef.current?.refresh();
  }, [reasonOf]);

  // The Resolved column's content, marks and comment icons: only the items whose resolved side or
  // decision changed are touched. The text at the top of the panel stays where it is when text
  // above it appears or disappears (or a ✓ / ✗ or an icon rewraps a line).
  useLayoutEffect(() => {
    const handle = resolvedRef.current;
    const scroller = scrollerRef.current;
    if (!handle || !scroller) return;
    const previous = appliedSides.current;
    const sidesChanged = previous
      ? [...new Set([...previous.keys(), ...resolvedSides.keys()])].filter((id) => (previous.get(id) ?? 'accept') !== (resolvedSides.get(id) ?? 'accept'))
      : undefined;
    const previousDecisions = appliedDecisions.current;
    const decisionsChanged = [...new Set([...Object.keys(previousDecisions), ...Object.keys(decisions)])].filter((id) => previousDecisions[id] !== decisions[id]);
    const appliedComments = appliedToggles.current;
    const togglesChanged =
      appliedComments?.size !== commentToggles.size || [...commentToggles].some(([id, open]) => appliedComments.get(id) !== open);
    appliedSides.current = resolvedSides;
    appliedDecisions.current = decisions;
    appliedToggles.current = commentToggles;
    if (sidesChanged?.length === 0 && decisionsChanged.length === 0 && !togglesChanged) return;
    const anchor = previous && scroller.scrollTop > 0 ? topBlock(scroller, handle.wrapper) : null;
    if (!sidesChanged || sidesChanged.length > 0) applyResolution(handle, resolvedSides, sidesChanged);
    applyResolvedDecisions(handle, decisions, decisionsChanged);
    applyCommentToggles(handle, commentToggles);
    if (anchor && anchor.block.getClientRects().length > 0) {
      const offset = anchor.block.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const top = scroller.scrollTop + offset - anchor.offset;
      if (scrollQuietly.current) scrollQuietly.current(scroller, top);
      else scroller.scrollTop = top;
    }
    scroller.dispatchEvent(new Event(CONTENT_CHANGED));
  }, [resolvedSides, decisions, commentToggles, contentVersion]);

  // Decisions in the side panels: only the items whose decision changed are touched.
  useLayoutEffect(() => {
    if (side === 'resolved') return;
    const previous = appliedDecisions.current;
    for (const id of new Set([...Object.keys(previous), ...Object.keys(decisions)])) {
      if (previous[id] !== decisions[id]) applyDecision(elementsRef.current.get(id) ?? [], decisions[id], side);
    }
    appliedDecisions.current = decisions;
  }, [decisions, side, contentVersion]);

  useLayoutEffect(() => {
    const previous = appliedCurrent.current;
    if (previous === currentItemId) return;
    for (const element of elementsRef.current.get(previous ?? '') ?? []) element.classList.remove('change-current');
    for (const element of elementsRef.current.get(currentItemId ?? '') ?? []) element.classList.add('change-current');
    appliedCurrent.current = currentItemId;
  }, [currentItemId, contentVersion]);

  const clickHandler = useRef(onChangeClick);
  clickHandler.current = onChangeClick;
  const pickHandler = useRef(onPickParagraph);
  pickHandler.current = onPickParagraph;
  const toggleHandler = useRef(props.onToggleComment);
  toggleHandler.current = props.onToggleComment;
  useEffect(() => {
    const root = scrollerRef.current?.shadowRoot;
    if (!root) return;
    /** A comment icon shows or hides its bubble, and doesn't select the change (FR-27c). */
    const toggleComment = (event: Event) => {
      const toggle = event.target instanceof Element ? event.target.closest<HTMLElement>(COMMENT_TOGGLE) : null;
      if (!toggle) return false;
      event.preventDefault();
      toggleHandler.current?.(toggle.dataset.commentFor!);
      return true;
    };
    /** A revert icon reverts its change (after a confirmation); it doesn't select it or move the cursor. */
    const revert = (event: Event) => {
      const icon = event.target instanceof Element ? event.target.closest<HTMLElement>(`.${REVERT_ICON}`) : null;
      const block = icon?.closest<HTMLElement>('[data-anchor]');
      if (!icon || !block) return false;
      event.preventDefault();
      revertIconsRef.current?.onRevert(block.dataset.anchor!, icon.dataset.revertId!);
      return true;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        if (!revert(event)) toggleComment(event);
      }
    };
    const onMouseDown = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(`.${REVERT_ICON}`)) event.preventDefault();
    };
    const onClick = (event: Event) => {
      if (toggleComment(event) || revert(event)) return;
      // While editing, a click places the cursor (or says why the paragraph can't be edited).
      if (editingRef.current) {
        editingRef.current.click(event);
        return;
      }
      const pick = pickHandler.current;
      if (pick) {
        event.preventDefault();
        const unids: string[] = [];
        for (let element = event.target instanceof Element ? event.target.closest('[data-anchor]') : null; element; element = element.parentElement?.closest('[data-anchor]') ?? null) {
          unids.push((element as HTMLElement).dataset.anchor!);
        }
        pick(unids);
        return;
      }
      const ids: string[] = [];
      for (let element = event.target instanceof Element ? event.target : null; element; element = element.parentElement) {
        const id = (element as HTMLElement).dataset?.changeId;
        if (id !== undefined && !ids.includes(id)) ids.push(id);
      }
      if (ids.length > 0) clickHandler.current(ids);
    };
    root.addEventListener('click', onClick);
    root.addEventListener('mousedown', onMouseDown);
    root.addEventListener('keydown', onKeyDown as EventListener);
    return () => {
      root.removeEventListener('click', onClick);
      root.removeEventListener('mousedown', onMouseDown);
      root.removeEventListener('keydown', onKeyDown as EventListener);
    };
  }, [contentVersion]);

  // Overview bar marks: measured after the content or the listed items change, and on resize.
  const [marks, setMarks] = useState<OverviewMark[]>([]);
  const [outsideFrom, setOutsideFrom] = useState<number | null>(null);
  const measure = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller || side === 'resolved') return;
    setMarks(measureMarks(scroller, overviewItems, elementsRef.current, side));
    setOutsideFrom(measureOffset(scroller, scroller.shadowRoot?.querySelector('.range-divider') ?? null));
    // `outOfRangeBlocks`: the divider moves with the range.
  }, [overviewItems, side, outOfRangeBlocks]);
  useEffect(() => {
    if (side === 'resolved') return;
    measure();
    const content = scrollerRef.current?.shadowRoot?.querySelector('.doc');
    if (!content || typeof ResizeObserver === 'undefined') return;
    // Debounced: a decision's ✓ / ✗ can rewrap a line, and measuring every change is not needed
    // in the same frame.
    let timer = 0;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = window.setTimeout(measure, 200);
    });
    observer.observe(content);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [measure, side, contentVersion]);

  return (
    <section className={`document-panel document-panel--${side}${editingOn ? ' document-panel--editing' : ''}`} aria-label={side === 'resolved' ? title : `${SIDE_NAMES[side]}: ${title}`}>
      <div className="document-panel__header">
        <h2 className="document-panel__title" title={props.titleTooltip ?? title}>
          {title}
        </h2>
        {props.headerControls}
      </div>
      <div className="document-panel__body">
        <div ref={scrollerRef} className="document-panel__scroller" data-testid={`panel-${side}`} tabIndex={0}>
          {props.card}
          {props.bubbles}
        </div>
        {side !== 'resolved' && (
          <OverviewBar
            scrollerRef={scrollerRef}
            marks={marks}
            outsideFrom={outsideFrom}
            decisions={decisions}
            currentItemId={currentItemId}
            side={side}
          />
        )}
      </div>
    </section>
  );
});
