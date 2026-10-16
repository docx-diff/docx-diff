import { useEffect, useState, type MouseEvent, type RefObject } from 'react';
import type { ChangeItem } from '../model/changes';
import type { Decision } from '../model/decisions';

export interface OverviewMark {
  itemId: string;
  /** Position of the change's first shown element, as a fraction of the panel's content height. */
  position: number;
  /** Colour: `del`, `ins`, `move` or `para`. */
  tone: 'del' | 'ins' | 'move' | 'para';
}

/**
 * Marks for the changes a panel shows: one at the first element of each change that has a layout
 * box in this panel (an insertion has none in the Original's panel, so it gets no mark there).
 */
export function measureMarks(
  scroller: HTMLElement,
  items: readonly ChangeItem[],
  elements: ReadonlyMap<string, readonly HTMLElement[]>,
  side: 'left' | 'right',
): OverviewMark[] {
  const height = scroller.scrollHeight;
  if (height === 0) return [];
  const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
  const marks: OverviewMark[] = [];
  for (const item of items) {
    const element = elements.get(item.id)?.find((candidate) => candidate.getClientRects().length > 0);
    if (!element) continue;
    const tone = item.kind === 'moved' ? 'move' : item.kind === 'paragraph' ? 'para' : side === 'left' ? 'del' : 'ins';
    marks.push({ itemId: item.id, position: (element.getBoundingClientRect().top - origin) / height, tone });
  }
  return marks;
}

/** The element's top as a fraction of the panel's content height; `null` without a laid-out element. */
export function measureOffset(scroller: HTMLElement, element: Element | null): number | null {
  const height = scroller.scrollHeight;
  if (!element || height === 0 || element.getClientRects().length === 0) return null;
  const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
  return (element.getBoundingClientRect().top - origin) / height;
}

interface Props {
  scrollerRef: RefObject<HTMLElement | null>;
  marks: readonly OverviewMark[];
  /** Where the part outside the comparison range starts (fraction of the content height), if any. */
  outsideFrom?: number | null;
  decisions: Readonly<Record<string, Decision>>;
  currentItemId: string | null;
  side: 'left' | 'right';
}

/**
 * A narrow strip along the panel showing where the changes are in the whole document, with the
 * visible part of the document as a box (FR-24). Clicking scrolls the panel there.
 */
export function OverviewBar({ scrollerRef, marks, outsideFrom = null, decisions, currentItemId, side }: Props) {
  const [viewport, setViewport] = useState({ top: 0, height: 1 });

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const height = scroller.scrollHeight || 1;
      setViewport({ top: scroller.scrollTop / height, height: Math.min(1, scroller.clientHeight / height) });
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', onScroll);
    };
  }, [scrollerRef, marks]);

  const scrollTo = (event: MouseEvent<HTMLDivElement>) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const box = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientY - box.top) / box.height;
    scroller.scrollTop = fraction * scroller.scrollHeight - scroller.clientHeight / 2;
  };

  return (
    <div
      className="overview-bar"
      data-testid={`overview-${side}`}
      onClick={scrollTo}
      title="Changes in the whole document; click to scroll there"
      aria-hidden="true"
    >
      {outsideFrom !== null && <div className="overview-bar__outside" style={{ top: `${outsideFrom * 100}%` }} />}
      <div className="overview-bar__viewport" style={{ top: `${viewport.top * 100}%`, height: `${viewport.height * 100}%` }} />
      {marks.map((mark) => (
        <div
          key={mark.itemId}
          className={`overview-bar__mark overview-bar__mark--${mark.tone}${decisions[mark.itemId] ? ' overview-bar__mark--decided' : ''}${
            mark.itemId === currentItemId ? ' overview-bar__mark--current' : ''
          }`}
          style={{ top: `${mark.position * 100}%` }}
        />
      ))}
    </div>
  );
}
