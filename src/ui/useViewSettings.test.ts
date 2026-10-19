import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_VIEW_SETTINGS, useViewSettings } from './useViewSettings';

const KEY = 'docx-diff:view-settings';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('useViewSettings', () => {
  it('starts with three columns and both sidebars collapsed', () => {
    const { result } = renderHook(() => useViewSettings());
    expect(result.current[0]).toEqual({ inlineCard: true, changesList: false, outline: false, threeColumns: true, leftAligned: true, hideBlankParagraphs: true });
    expect(result.current[0]).toEqual(DEFAULT_VIEW_SETTINGS);
  });

  it('keeps stored settings and defaults the ones not stored', () => {
    localStorage.setItem(KEY, JSON.stringify({ inlineCard: false, changesList: true, outline: true }));
    const { result } = renderHook(() => useViewSettings());
    expect(result.current[0]).toEqual({ inlineCard: false, changesList: true, outline: true, threeColumns: true, leftAligned: true, hideBlankParagraphs: true });
  });

  it('stores a change with the other settings', () => {
    const { result } = renderHook(() => useViewSettings());
    act(() => result.current[1]({ threeColumns: false }));
    expect(result.current[0].threeColumns).toBe(false);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ ...DEFAULT_VIEW_SETTINGS, threeColumns: false });
  });

  it('uses the defaults when the stored value is not JSON', () => {
    localStorage.setItem(KEY, '{');
    const { result } = renderHook(() => useViewSettings());
    expect(result.current[0]).toEqual(DEFAULT_VIEW_SETTINGS);
  });
});
