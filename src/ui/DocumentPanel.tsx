import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import panelCss from './panel.css?inline';
import type { ChangeItem } from '../model/changes';
import type { Decision } from '../model/decisions';
import type { CompareSettings } from '../model/equivalence';
import { darkColors } from './darkColors';
import { BUBBLE_SLOT, CONTENT_CHANGED } from './CommentBubbles';
import { CARD_SLOT } from './InlineChangeCard';
import { OverviewBar, measureMarks, measureOffset, type OverviewMark } from './OverviewBar';
import type { ResolvedSide } from '../model/resolved';
import type { Theme } from './theme';
import { markCommon, markItems, mergeJoinedParagraphs, type RenderedDocument } from './renderedDocument';
import {
  applyCommentToggles,
  applyRangeOrder,
  applyResolution,
  applyResolvedDecisions,
  placeCommentToggles,
  prepareResolvedPanel,
  type ResolvedPanel,
} from './resolvedView';

/** The Original, the Edited, or the Resolved column between them (the document as the export resolves it). */
export type PanelSide = 'left' | 'right' | 'resolved';

const SIDE_NAMES: Record<PanelSide, string> = { left: 'Original', right: 'Edited', resolved: 'Resolved' };

interface Props {
  side: PanelSide;
  /** In dark mode the document's own colours are made dark too (darkColors.ts). */
  theme: Theme;
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
}

const NO_BLOCKS: ReadonlySet<string> = new Set();
/** The document's own colours (CSS or a `style` attribute) for the theme (darkColors.ts). */
function themedColors(css: string, theme: Theme): string {
  return theme === 'dark' ? darkColors(css) : css;
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
    // The document's colours for the theme go in with the content: changing its style sheet once
    // the content is in makes the browser restyle the whole document (0.7 s on the ~300-page pair).
    const styled = Array.from(wrapper.querySelectorAll<HTMLElement>('[style]'), (element): [HTMLElement, string] => [element, element.getAttribute('style')!]);
    documentStyle.textContent = themedColors(document.css, themeRef.current);
    if (themeRef.current === 'dark') for (const [element, style] of styled) element.setAttribute('style', darkColors(style));
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
    const css = themedColors(document.css, theme);
    if (documentStyle.textContent !== css) documentStyle.textContent = css;
    for (const [element, style] of styledRef.current) {
      const themed = themedColors(style, theme);
      if (element.getAttribute('style') !== themed) element.setAttribute('style', themed);
    }
  }, [document, side, theme]);

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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') toggleComment(event);
    };
    const onClick = (event: Event) => {
      if (toggleComment(event)) return;
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
    root.addEventListener('keydown', onKeyDown as EventListener);
    return () => {
      root.removeEventListener('click', onClick);
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
    <section className={`document-panel document-panel--${side}`} aria-label={side === 'resolved' ? title : `${SIDE_NAMES[side]}: ${title}`}>
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
