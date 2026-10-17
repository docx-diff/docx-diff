// Anchor-based scroll synchronization between the panels (FR-22, docs/architecture.md). All
// panels show the same HTML, so a block has the same `data-anchor` in each. Blocks visible in two
// panels are paired by their offsets; a scroll position between two paired blocks maps
// proportionally to the same place between them in the other panel, so regions shown in one panel
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
  /** Sets a panel's scroll position; the scroll event it causes is not synced to the other panels. */
  scrollQuietly(scroller: HTMLElement, top: number): void;
  /** Aligns `target` with `source`'s current position (also while the sync is off). */
  align(source: HTMLElement, target: HTMLElement): void;
}

function clampTop(scroller: HTMLElement, top: number): number {
  return Math.round(Math.max(0, Math.min(top, scroller.scrollHeight - scroller.clientHeight)));
}

/**
 * Keeps the panels aligned while `enabled`: a scroll of any of them moves the others. `contentKey`
 * changes whenever the panels get new content; `panels` is a new array when the panels shown
 * change. Each panel's offsets are measured lazily, and again after any size change of its content.
 */
export function useScrollSync(
  panels: readonly RefObject<HTMLElement | null>[],
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
    const scrollers = panels.map((panel) => panel.current);
    if (!enabled || scrollers.length < 2 || scrollers.some((scroller) => !scroller)) return;
    const shown = scrollers as HTMLElement[];

    // Measured once per panel and kept until its size changes; the pairs of each direction likewise.
    const blocks = new Map<HTMLElement, BlockOffset[]>();
    const pairs = new Map<HTMLElement, Map<HTMLElement, OffsetPair[]>>();
    const blocksOf = (scroller: HTMLElement) => {
      let measured = blocks.get(scroller);
      if (!measured) blocks.set(scroller, (measured = measureBlocks(scroller)));
      return measured;
    };
    const pairsOf = (source: HTMLElement, target: HTMLElement) => {
      let bySource = pairs.get(source);
      if (!bySource) pairs.set(source, (bySource = new Map()));
      let found = bySource.get(target);
      if (!found) bySource.set(target, (found = pairOffsets(blocksOf(source), blocksOf(target))));
      return found;
    };
    const invalidate = (scroller: HTMLElement) => {
      blocks.delete(scroller);
      pairs.delete(scroller);
      for (const bySource of pairs.values()) bySource.delete(scroller);
    };

    const expected = expectedRef.current;
    expected.clear();
    const sync = (source: HTMLElement) => {
      const seen = expected.get(source);
      if (seen !== undefined && Math.abs(source.scrollTop - seen) <= 1) {
        expected.delete(source);
        return;
      }
      expected.delete(source);
      for (const target of shown) {
        if (target === source) continue;
        const top = mapScrollTop(pairsOf(source, target), source.scrollTop);
        if (top !== null) controller.scrollQuietly(target, top);
      }
    };
    const listeners = shown.map((scroller) => {
      const onScroll = () => sync(scroller);
      scroller.addEventListener('scroll', onScroll, { passive: true });
      return onScroll;
    });

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const scroller = shown.find((candidate) => candidate === entry.target || candidate.shadowRoot?.contains(entry.target));
        if (scroller) invalidate(scroller);
      }
    });
    for (const scroller of shown) {
      resizeObserver.observe(scroller);
      const content = scroller.shadowRoot?.querySelector('.doc');
      if (content) resizeObserver.observe(content);
    }
    // Turning sync back on (or showing another panel) aligns the others with the first panel.
    listeners[0]!();

    return () => {
      shown.forEach((scroller, i) => scroller.removeEventListener('scroll', listeners[i]!));
      resizeObserver.disconnect();
    };
  }, [panels, enabled, contentKey, controller]);

  return controller;
}
