import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import panelCss from './panel.css?inline';
import type { ChangeItem } from '../model/changes';
import type { Decision } from '../model/decisions';
import type { CompareSettings } from '../model/equivalence';
import { darkColors } from './darkColors';
import { CARD_SLOT } from './InlineChangeCard';
import { OverviewBar, measureMarks, measureOffset, type OverviewMark } from './OverviewBar';
import type { Theme } from './theme';
import { markCommon, markItems, mergeJoinedParagraphs, type RenderedDocument } from './renderedDocument';

export type PanelSide = 'left' | 'right';

interface Props {
  side: PanelSide;
  /** In dark mode the document's own colours are made dark too (darkColors.ts). */
  theme: Theme;
  title: string;
  document: RenderedDocument;
  /** Changes the compare settings ignore: shown as plain text. */
  ignored: ReadonlySet<string>;
  /** Decides which shared edges of replacements are shown as plain text. */
  settings: CompareSettings;
  decisions: Readonly<Record<string, Decision>>;
  currentItemId: string | null;
  /** A click on the panel's text: the ids of the changes around the clicked point, innermost first. */
  onChangeClick: (itemIds: string[]) => void;
  /** The changes the overview bar shows. */
  overviewItems: readonly ChangeItem[];
  /** Changes outside the comparison range: plain text, greyed in the Edited's panel. */
  outOfRangeItems: ReadonlySet<string>;
  /** Blocks outside the comparison range (the Original's panel): greyed, after a divider. */
  outOfRangeBlocks?: ReadonlySet<string>;
  /**
   * Set while the reviewer picks a paragraph: a click on the text gives the `data-anchor` unids
   * around the clicked point, innermost first, instead of selecting a change.
   */
  onPickParagraph?: (unids: string[]) => void;
  /** Shown over the text, scrolling with it (the current change's card, FR-28a). */
  card?: ReactNode;
}

const NO_BLOCKS: ReadonlySet<string> = new Set();
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
function applyDecision(elements: readonly HTMLElement[], decision: Decision | undefined, side: PanelSide): void {
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
 * One document panel. The rendered HTML goes into a shadow root, so the converter's stylesheet
 * (which styles `p`, `span`, `table`, … globally) stays inside the panel. The forwarded ref is the
 * scrolling element, which is also the shadow host.
 */
export const DocumentPanel = forwardRef<HTMLDivElement, Props>(function DocumentPanel(props, ref) {
  const { side, theme, title, document, ignored, settings, decisions, currentItemId, onChangeClick, overviewItems, outOfRangeItems, onPickParagraph } = props;
  const outOfRangeBlocks = props.outOfRangeBlocks ?? NO_BLOCKS;
  const scrollerRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => scrollerRef.current!, []);
  const elementsRef = useRef<ElementMap>(new Map());
  const blocksRef = useRef<HTMLElement[]>([]);
  const documentStyleRef = useRef<HTMLStyleElement | null>(null);
  /** Elements with a `style` attribute, and its value as the converter wrote it. */
  const styledRef = useRef<[HTMLElement, string][]>([]);
  const appliedDecisions = useRef<Readonly<Record<string, Decision>>>({});
  const appliedCurrent = useRef<string | null>(null);
  const [contentVersion, setContentVersion] = useState(0);

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
    mergeJoinedParagraphs(wrapper, side);
    const cardSlot = owner.createElement('slot');
    cardSlot.name = CARD_SLOT;
    root.replaceChildren(documentStyle, panelStyle, wrapper, cardSlot);
    host.scrollTop = 0;
    elementsRef.current = elementMap(wrapper);
    blocksRef.current = [...wrapper.querySelectorAll<HTMLElement>('[data-anchor]')];
    documentStyleRef.current = documentStyle;
    styledRef.current = Array.from(wrapper.querySelectorAll<HTMLElement>('[style]'), (element) => [element, element.getAttribute('style')!]);
    appliedDecisions.current = {};
    appliedCurrent.current = null;
    setContentVersion((version) => version + 1);
  }, [document, side]);

  useLayoutEffect(() => {
    const dark = theme === 'dark';
    documentStyleRef.current!.textContent = dark ? darkColors(document.css) : document.css;
    for (const [element, style] of styledRef.current) element.setAttribute('style', dark ? darkColors(style) : style);
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
  }, [document, outOfRangeItems, outOfRangeBlocks, contentVersion]);

  useLayoutEffect(() => {
    scrollerRef.current?.shadowRoot?.querySelector('.doc')?.classList.toggle('doc--picking', onPickParagraph !== undefined);
  }, [onPickParagraph, contentVersion]);

  // Decisions: only the items whose decision changed are touched.
  useLayoutEffect(() => {
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
  useEffect(() => {
    const root = scrollerRef.current?.shadowRoot;
    if (!root) return;
    const onClick = (event: Event) => {
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
    return () => root.removeEventListener('click', onClick);
  }, [contentVersion]);

  // Overview bar marks: measured after the content or the listed items change, and on resize.
  const [marks, setMarks] = useState<OverviewMark[]>([]);
  const [outsideFrom, setOutsideFrom] = useState<number | null>(null);
  const measure = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    setMarks(measureMarks(scroller, overviewItems, elementsRef.current, side));
    setOutsideFrom(measureOffset(scroller, scroller.shadowRoot?.querySelector('.range-divider') ?? null));
    // `outOfRangeBlocks`: the divider moves with the range.
  }, [overviewItems, side, outOfRangeBlocks]);
  useEffect(() => {
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
  }, [measure, contentVersion]);

  return (
    <section className={`document-panel document-panel--${side}`} aria-label={`${side === 'left' ? 'Original' : 'Edited'}: ${title}`}>
      <h2 className="document-panel__title" title={title}>
        {title}
      </h2>
      <div className="document-panel__body">
        <div ref={scrollerRef} className="document-panel__scroller" data-testid={`panel-${side}`} tabIndex={0}>
          {props.card}
        </div>
        <OverviewBar
          scrollerRef={scrollerRef}
          marks={marks}
          outsideFrom={outsideFrom}
          decisions={decisions}
          currentItemId={currentItemId}
          side={side}
        />
      </div>
    </section>
  );
});
