import { useLayoutEffect, useRef, useState } from 'react';
import type { ChangeItem } from '../model/changes';
import type { Decision } from '../model/decisions';
import { ChangeCard } from './ChangeCard';
import { changeBox } from './reveal';

/** The slot of the panel's shadow root that shows the card (`DocumentPanel`). */
export const CARD_SLOT = 'change-card';

/** Space between the change and the card, so the lines around the change stay readable. */
export const GAP = 40;
/** Space kept between the card and the panel's edges. */
export const MARGIN = 8;

interface Props {
  item: ChangeItem;
  label: string;
  decision: Decision | undefined;
  onDecide: (itemId: string, decision: Decision | null) => void;
  onDecideUntil: (itemId: string, decision: Decision) => void;
  comment: string | undefined;
  onComment: (itemId: string, text: string | null) => void;
  onClose: () => void;
}

/**
 * The current change's card in the Edited's panel (FR-28a), below the change. Rendered as a child of
 * the panel's scroller (the shadow host), shown through a slot: it scrolls with the text and gets the
 * page's styles.
 */
export function InlineChangeCard({ item, onClose, ...card }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    const scroller = element?.parentElement;
    if (!element || !scroller) return;
    const place = () => {
      const box = changeBox(scroller, item.id, item.anchors);
      if (!box) {
        setPosition(null);
        return;
      }
      const maxLeft = scroller.clientWidth - element.offsetWidth - MARGIN;
      setPosition({ top: box.bottom + GAP, left: Math.max(MARGIN, Math.min(box.left - MARGIN, maxLeft)) });
    };
    place();
    // The text rewraps when the panel is resized (e.g. the changes list hidden) or a decision adds its ✓ / ✗.
    if (typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    });
    observer.observe(scroller);
    const content = scroller.shadowRoot?.querySelector('.doc');
    if (content) observer.observe(content);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [item]);

  return (
    <div
      ref={ref}
      slot={CARD_SLOT}
      className="inline-card"
      style={position ? { top: position.top, left: position.left } : { visibility: 'hidden' }}
    >
      <ChangeCard item={item} current={false} onClose={onClose} testId="inline-change-card" {...card} />
    </div>
  );
}
