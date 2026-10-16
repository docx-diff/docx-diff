import { describe, expect, it } from 'vitest';
import { mapScrollTop, pairOffsets, type BlockOffset } from './scrollSync';

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
