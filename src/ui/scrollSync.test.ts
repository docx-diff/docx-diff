import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mapScrollTop, pairOffsets, useScrollSync, type BlockOffset } from './scrollSync';

const blocks = (entries: [string, number][]): BlockOffset[] => entries.map(([anchor, top]) => ({ anchor, top }));

describe('pairOffsets', () => {
  it('pairs blocks present in both panels, in source order', () => {
    const left = blocks([['a', 0], ['deleted', 100], ['b', 200], ['c', 300]]);
    const right = blocks([['a', 0], ['b', 100], ['inserted', 150], ['c', 250]]);
    expect(pairOffsets(left, right)).toEqual([
      { source: 0, target: 0 },
      { source: 200, target: 100 },
      { source: 300, target: 250 },
    ]);
  });

  it('drops pairs that would go backwards in the target, and duplicate source offsets', () => {
    const left = blocks([['a', 0], ['b', 100], ['c', 200], ['d', 200]]);
    const right = blocks([['a', 0], ['c', 50], ['b', 300], ['d', 400]]);
    expect(pairOffsets(left, right)).toEqual([
      { source: 0, target: 0 },
      { source: 100, target: 300 },
      { source: 200, target: 400 },
    ]);
  });
});

describe('mapScrollTop', () => {
  const pairs = [
    { source: 100, target: 50 },
    { source: 300, target: 450 },
    { source: 500, target: 470 },
  ];

  it('aligns a paired block exactly', () => {
    expect(mapScrollTop(pairs, 300)).toBe(450);
  });

  it('interpolates between two paired blocks', () => {
    expect(mapScrollTop(pairs, 200)).toBe(250);
    // A long passage shown on one side only barely moves the other panel.
    expect(mapScrollTop(pairs, 400)).toBe(460);
  });

  it('keeps the offset to the nearest pair before the first and after the last', () => {
    expect(mapScrollTop(pairs, 40)).toBe(-10);
    expect(mapScrollTop(pairs, 700)).toBe(670);
  });

  it('is null without pairs', () => {
    expect(mapScrollTop([], 100)).toBeNull();
  });
});

describe('useScrollSync', () => {
  /** A panel whose blocks sit at the given offsets (absent: hidden in it). */
  function panel(offsets: Record<string, number>): HTMLElement {
    const scroller = document.createElement('div');
    Object.defineProperty(scroller, 'scrollHeight', { value: 2000 });
    Object.defineProperty(scroller, 'clientHeight', { value: 500 });
    scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    const root = scroller.attachShadow({ mode: 'open' });
    const doc = document.createElement('div');
    doc.className = 'doc';
    for (const anchor of ['a', 'b', 'c']) {
      const block = document.createElement('p');
      block.dataset.anchor = anchor;
      const top = offsets[anchor];
      block.getClientRects = () => (top === undefined ? [] : [{}]) as unknown as DOMRectList;
      block.getBoundingClientRect = () => ({ top: (top ?? 0) - scroller.scrollTop }) as DOMRect;
      doc.append(block);
    }
    root.append(doc);
    document.body.append(scroller);
    return scroller;
  }

  const scrollTo = (scroller: HTMLElement, top: number) => {
    scroller.scrollTop = top;
    scroller.dispatchEvent(new Event('scroll'));
  };

  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('moves the other two panels when any of three is scrolled, each by its own pairs', () => {
    const left = panel({ a: 0, b: 100, c: 300 });
    const middle = panel({ a: 0, c: 200 });
    const right = panel({ a: 0, b: 400, c: 600 });
    const refs = [{ current: left }, { current: middle }, { current: right }];
    renderHook(() => useScrollSync(refs, true, 1));

    scrollTo(left, 300);
    expect(middle.scrollTop).toBe(200);
    expect(right.scrollTop).toBe(600);

    // The middle panel lacks `b`: between `a` and `c` it maps proportionally.
    scrollTo(middle, 100);
    expect(left.scrollTop).toBe(150);
    expect(right.scrollTop).toBe(300);

    // The positions it set itself are not synced back.
    middle.dispatchEvent(new Event('scroll'));
    right.dispatchEvent(new Event('scroll'));
    expect(left.scrollTop).toBe(150);
  });

  it('does nothing while disabled, and aligns the others with the first panel when enabled', () => {
    const left = panel({ a: 0, b: 100, c: 300 });
    const right = panel({ a: 0, b: 400, c: 600 });
    const refs = [{ current: left }, { current: right }];
    left.scrollTop = 100;
    const { rerender } = renderHook(({ enabled }) => useScrollSync(refs, enabled, 1), { initialProps: { enabled: false } });
    scrollTo(left, 100);
    expect(right.scrollTop).toBe(0);
    rerender({ enabled: true });
    expect(right.scrollTop).toBe(400);
  });
});
