import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import panelCss from './panel.css?inline';
import type { ChangeItem } from '../model/changes';
import type { Decision } from '../model/decisions';
import type { CompareSettings } from '../model/equivalence';
import { OverviewBar, measureMarks, type OverviewMark } from './OverviewBar';
import { markCommon, markItems, mergeJoinedParagraphs, type RenderedDocument } from './renderedDocument';

export type PanelSide = 'left' | 'right';

interface Props {
  side: PanelSide;
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
}

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
  const { side, title, document, ignored, settings, decisions, currentItemId, onChangeClick, overviewItems } = props;
  const scrollerRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => scrollerRef.current!, []);
  const elementsRef = useRef<ElementMap>(new Map());
  const appliedDecisions = useRef<Readonly<Record<string, Decision>>>({});
  const appliedCurrent = useRef<string | null>(null);
  const [contentVersion, setContentVersion] = useState(0);

  useLayoutEffect(() => {
    const host = scrollerRef.current!;
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    const owner = host.ownerDocument;
    const documentStyle = owner.createElement('style');
    documentStyle.textContent = document.css;
    const panelStyle = owner.createElement('style');
    panelStyle.textContent = panelCss;
    const wrapper = owner.createElement('div');
    wrapper.className = 'doc';
    wrapper.dataset.side = side;
    wrapper.append(...Array.from(document.body.childNodes, (node) => owner.importNode(node, true)));
    mergeJoinedParagraphs(wrapper, side);
    root.replaceChildren(documentStyle, panelStyle, wrapper);
    host.scrollTop = 0;
    elementsRef.current = elementMap(wrapper);
    appliedDecisions.current = {};
    appliedCurrent.current = null;
    setContentVersion((version) => version + 1);
  }, [document, side]);

  useLayoutEffect(() => {
    const root = scrollerRef.current?.shadowRoot;
    if (!root) return;
    markItems(root, ignored, 'change-ignored');
    markCommon(root, settings);
  }, [document, ignored, settings]);

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
  useEffect(() => {
    const root = scrollerRef.current?.shadowRoot;
    if (!root) return;
    const onClick = (event: Event) => {
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
  const measure = useCallback(() => {
    const scroller = scrollerRef.current;
    if (scroller) setMarks(measureMarks(scroller, overviewItems, elementsRef.current, side));
  }, [overviewItems, side]);
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
        <div ref={scrollerRef} className="document-panel__scroller" data-testid={`panel-${side}`} tabIndex={0} />
        <OverviewBar scrollerRef={scrollerRef} marks={marks} decisions={decisions} currentItemId={currentItemId} side={side} />
      </div>
    </section>
  );
});
