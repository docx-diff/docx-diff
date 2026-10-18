import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { GAP, MARGIN } from './InlineChangeCard';
import { changeBox } from './reveal';

/** The slot of the Resolved column's shadow root that shows the bubbles (`DocumentPanel`). */
export const BUBBLE_SLOT = 'comment-bubbles';

/**
 * Dispatched on a panel's scroller after `DocumentPanel` changed its text (decisions, the range,
 * comment icons): the bubbles follow the text, which can move without changing size.
 */
export const CONTENT_CHANGED = 'docx-diff:content-changed';

/** A comment to show: the reviewer's text, under the change it is on. */
export interface BubbleComment {
  itemId: string;
  anchors: readonly string[];
  text: string;
}

interface Props {
  comments: readonly BubbleComment[];
  /** The items whose bubble the reviewer closed. */
  closed: ReadonlySet<string>;
  onClose: (itemId: string) => void;
  /** The Resolved column's scroller, whose children the bubbles are. */
  scrollerRef: RefObject<HTMLElement | null>;
}

/** A bubble's place and size, in the scroller's content coordinates. */
export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Space kept between stacked bubbles. */
const SPACING = 4;
/** How far below its comment icon's line a bubble starts, in lines: it covers part of the next line only. */
const ICON_GAP_LINES = 0.6;

/**
 * Where a bubble goes below its comment icon (in the scroller's content coordinates): its left
 * edge at the icon, its top a little more than half a line below the icon's line. Null when the
 * icon isn't shown.
 */
function belowIcon(scroller: HTMLElement, itemId: string): { top: number; left: number } | null {
  const icon = scroller.shadowRoot?.querySelector(`.comment-toggle[data-comment-for="${CSS.escape(itemId)}"]`);
  const rect = icon?.getClientRects()[0];
  if (!icon || !rect) return null;
  const style = getComputedStyle(icon.parentElement ?? icon);
  const lineHeight = parseFloat(style.lineHeight) || 1.2 * parseFloat(style.fontSize) || 20;
  const origin = scroller.getBoundingClientRect();
  return {
    top: rect.bottom - origin.top + scroller.scrollTop + ICON_GAP_LINES * lineHeight,
    left: rect.left - origin.left + scroller.scrollLeft,
  };
}

/**
 * Stacks the bubbles (FR-27c): in the order of their tops, a box that would overlap one placed
 * before it (with `spacing` around it) is pushed down below that one, until it overlaps none.
 * Returns the tops, in the boxes' order.
 */
export function stackBoxes(boxes: readonly Box[], spacing = SPACING): number[] {
  const tops = boxes.map((box) => box.top);
  const order = boxes.map((_, i) => i).sort((a, b) => tops[a]! - tops[b]! || a - b);
  const placed: number[] = [];
  for (const i of order) {
    const box = boxes[i]!;
    for (let moved = true; moved; ) {
      moved = false;
      for (const j of placed) {
        const other = boxes[j]!;
        const across = box.left < other.left + other.width && other.left < box.left + box.width;
        const below = tops[j]! + other.height + spacing;
        if (across && tops[i]! < below && tops[i]! + box.height + spacing > tops[j]!) {
          tops[i] = below;
          moved = true;
        }
      }
    }
    placed.push(i);
  }
  return tops;
}

/**
 * The reviewer's comments in the Resolved column (FR-27c), each in a bubble below its comment icon,
 * open until closed with its ×. Rendered as children of the panel's scroller (the shadow host),
 * shown through a slot, like the inline card: they scroll with the text and get the page's styles.
 * Their places are written to the elements directly, after every change of the text.
 */
export function CommentBubbles({ comments, closed, onClose, scrollerRef }: Props) {
  const open = comments.filter((comment) => !closed.has(comment.itemId));
  const latest = useRef(open);
  latest.current = open;

  const place = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const bubbles = new Map(
      Array.from(scroller.querySelectorAll<HTMLElement>(':scope > .comment-bubble'), (element) => [element.dataset.itemId!, element]),
    );
    // Measured at the left edge: an absolute box shrinks to the room on its right.
    for (const element of bubbles.values()) {
      element.style.left = '0px';
      element.style.top = '0px';
    }
    const shown: { element: HTMLElement; box: Box }[] = [];
    for (const { itemId, anchors } of latest.current) {
      const element = bubbles.get(itemId);
      if (!element) continue;
      // Below the comment icon; without one, below the change, like the inline card.
      const change = changeBox(scroller, itemId, anchors);
      const at = belowIcon(scroller, itemId) ?? (change && { top: change.bottom + GAP, left: change.left - MARGIN });
      if (!at) {
        delete element.dataset.placed;
        continue;
      }
      const width = element.offsetWidth;
      const maxLeft = scroller.clientWidth - width - MARGIN;
      shown.push({
        element,
        box: { top: at.top, left: Math.max(MARGIN, Math.min(at.left, maxLeft)), width, height: element.offsetHeight },
      });
    }
    const tops = stackBoxes(shown.map(({ box }) => box));
    shown.forEach(({ element, box }, i) => {
      element.style.top = `${tops[i]}px`;
      element.style.left = `${box.left}px`;
      element.dataset.placed = '';
    });
  }, [scrollerRef]);

  // A bubble opened, closed or edited.
  useLayoutEffect(place, [place, comments, closed]);

  // The text changed, or rewrapped. On mount the scroller's ref is set only after the layout
  // effects of its children (these), and the panel has already shown its text: placed once here.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let frame = 0;
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(place);
          });
    observer?.observe(scroller);
    const onContent = () => {
      const content = scroller.shadowRoot?.querySelector('.doc');
      if (content) observer?.observe(content);
      place();
    };
    scroller.addEventListener(CONTENT_CHANGED, onContent);
    onContent();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      scroller.removeEventListener(CONTENT_CHANGED, onContent);
    };
  }, [scrollerRef, place]);

  return (
    <>
      {open.map(({ itemId, text }) => (
        <div key={itemId} slot={BUBBLE_SLOT} className="comment-bubble" data-item-id={itemId} data-testid="comment-bubble" role="note" aria-label="Comment">
          <button type="button" className="comment-bubble__close" aria-label="Hide comment" title="Hide comment" onClick={() => onClose(itemId)}>
            ×
          </button>
          <p className="comment-bubble__text">{text.trim()}</p>
        </div>
      ))}
    </>
  );
}
