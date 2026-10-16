import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import panelCss from './panel.css?inline';
import type { CompareSettings } from '../model/equivalence';
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
}

/**
 * One document panel. The rendered HTML goes into a shadow root, so the converter's stylesheet
 * (which styles `p`, `span`, `table`, … globally) stays inside the panel. The forwarded ref is the
 * scrolling element, which is also the shadow host.
 */
export const DocumentPanel = forwardRef<HTMLDivElement, Props>(function DocumentPanel({ side, title, document, ignored, settings }, ref) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => scrollerRef.current!, []);

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
  }, [document, side]);

  useLayoutEffect(() => {
    const root = scrollerRef.current?.shadowRoot;
    if (!root) return;
    markItems(root, ignored, 'change-ignored');
    markCommon(root, settings);
  }, [document, ignored, settings]);

  return (
    <section className={`document-panel document-panel--${side}`} aria-label={`${side === 'left' ? 'Original' : 'Edited'}: ${title}`}>
      <h2 className="document-panel__title" title={title}>
        {title}
      </h2>
      <div ref={scrollerRef} className="document-panel__scroller" data-testid={`panel-${side}`} tabIndex={0} />
    </section>
  );
});
