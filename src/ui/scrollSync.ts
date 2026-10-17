// Anchor-based scroll synchronization between the two panels (FR-22, docs/architecture.md). Both
// panels show the same HTML, so a block has the same `data-anchor` in both. Blocks visible in both
// panels are paired by their offsets; a scroll position between two paired blocks maps
// proportionally to the same place between them in the other panel, so regions shown on one side
// only (an inserted passage, a deleted tail) don't make the other panel jump.
import { useEffect, useMemo, useRef, type RefObject } from 'react';

export interface BlockOffset {
  anchor: string;
  /** Offset of the block's top from the top of the panel's scrollable content, in pixels. */
  top: number;
}

export interface OffsetPair {
  source: number;
  target: number;
}

/**
 * Pairs the source blocks with the same anchors in the target, ordered by source offset. Pairs
 * that would make the target offset go backwards (e.g. reordered content) are dropped, so the
 * mapping stays monotonic.
 */
export function pairOffsets(source: readonly BlockOffset[], target: readonly BlockOffset[]): OffsetPair[] {
  const targetTop = new Map(target.map((block) => [block.anchor, block.top]));
  const pairs: OffsetPair[] = [];
  for (const block of [...source].sort((a, b) => a.top - b.top)) {
    const top = targetTop.get(block.anchor);
    if (top === undefined) continue;
    const last = pairs.at(-1);
    if (last && (top < last.target || block.top === last.source)) continue;
    pairs.push({ source: block.top, target: top });
  }
  return pairs;
}

/** The target scroll offset for a source scroll offset; `null` when nothing is paired. */
export function mapScrollTop(pairs: readonly OffsetPair[], scrollTop: number): number | null {
  if (pairs.length === 0) return null;
  // The last pair at or above the scroll position.
  let low = 0;
  let high = pairs.length - 1;
  let before = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (pairs[middle]!.source <= scrollTop) {
      before = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (before === -1) {
    const first = pairs[0]!;
    return first.target - (first.source - scrollTop);
  }
  const a = pairs[before]!;
  const b = pairs[before + 1];
  if (!b) return a.target + (scrollTop - a.source);
  return a.target + ((scrollTop - a.source) / (b.source - a.source)) * (b.target - a.target);
}

/** Offsets of the visible `data-anchor` blocks in a panel (hidden blocks have no layout box). */
export function measureBlocks(scroller: HTMLElement): BlockOffset[] {
  const root = scroller.shadowRoot ?? scroller;
  const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
  const blocks: BlockOffset[] = [];
  for (const element of root.querySelectorAll<HTMLElement>('[data-anchor]')) {
    if (element.getClientRects().length === 0) continue;
    blocks.push({ anchor: element.dataset.anchor!, top: element.getBoundingClientRect().top - origin });
  }
  return blocks;
}

/** Scrolling the panels from code, without the sync undoing it. */
export interface ScrollController {
  /** Sets a panel's scroll position; the scroll event it causes is not synced to the other panel. */
  scrollQuietly(scroller: HTMLElement, top: number): void;
  /** Aligns `target` with `source`'s current position (also while the sync is off). */
  align(source: HTMLElement, target: HTMLElement): void;
}

function clampTop(scroller: HTMLElement, top: number): number {
  return Math.round(Math.max(0, Math.min(top, scroller.scrollHeight - scroller.clientHeight)));
}

/**
 * Keeps the two panels aligned while `enabled`. `contentKey` changes whenever the panels get new
 * content. Offsets are measured lazily and again after any size change of either panel's content.
 */
export function useScrollSync(
  left: RefObject<HTMLElement | null>,
  right: RefObject<HTMLElement | null>,
  enabled: boolean,
  contentKey: unknown,
): ScrollController {
  // Scroll positions we set ourselves; the scroll event they cause must not sync back.
  const expectedRef = useRef(new Map<HTMLElement, number>());
  const controller = useMemo<ScrollController>(() => {
    const scrollQuietly = (scroller: HTMLElement, top: number) => {
      const clamped = clampTop(scroller, top);
      if (Math.abs(clamped - scroller.scrollTop) < 1) return;
      expectedRef.current.set(scroller, clamped);
      scroller.scrollTop = clamped;
    };
    return {
      scrollQuietly,
      align(source, target) {
        const top = mapScrollTop(pairOffsets(measureBlocks(source), measureBlocks(target)), source.scrollTop);
        if (top !== null) scrollQuietly(target, top);
      },
    };
  }, []);

  useEffect(() => {
    const leftScroller = left.current;
    const rightScroller = right.current;
    if (!enabled || !leftScroller || !rightScroller) return;

    let pairs: { leftToRight: OffsetPair[]; rightToLeft: OffsetPair[] } | null = null;
    const measure = () => {
      const leftBlocks = measureBlocks(leftScroller);
      const rightBlocks = measureBlocks(rightScroller);
      return { leftToRight: pairOffsets(leftBlocks, rightBlocks), rightToLeft: pairOffsets(rightBlocks, leftBlocks) };
    };

    const expected = expectedRef.current;
    expected.clear();
    const sync = (source: HTMLElement, target: HTMLElement, direction: 'leftToRight' | 'rightToLeft') => {
      const seen = expected.get(source);
      if (seen !== undefined && Math.abs(source.scrollTop - seen) <= 1) {
        expected.delete(source);
        return;
      }
      expected.delete(source);
      pairs ??= measure();
      const top = mapScrollTop(pairs[direction], source.scrollTop);
      if (top === null) return;
      controller.scrollQuietly(target, top);
    };
    const onLeftScroll = () => sync(leftScroller, rightScroller, 'leftToRight');
    const onRightScroll = () => sync(rightScroller, leftScroller, 'rightToLeft');
    leftScroller.addEventListener('scroll', onLeftScroll, { passive: true });
    rightScroller.addEventListener('scroll', onRightScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => {
      pairs = null;
    });
    for (const scroller of [leftScroller, rightScroller]) {
      resizeObserver.observe(scroller);
      const content = scroller.shadowRoot?.querySelector('.doc');
      if (content) resizeObserver.observe(content);
    }
    // Turning sync back on aligns the right panel with the left one.
    onLeftScroll();

    return () => {
      leftScroller.removeEventListener('scroll', onLeftScroll);
      rightScroller.removeEventListener('scroll', onRightScroll);
      resizeObserver.disconnect();
    };
  }, [left, right, enabled, contentKey, controller]);

  return controller;
}
