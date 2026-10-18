import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_EXPORT_SETTINGS, useExportSettings } from './useExportSettings';

const KEY = 'docx-diff:export-settings';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('useExportSettings', () => {
  it('starts by accepting undecided changes, with no author', () => {
    const { result } = renderHook(() => useExportSettings());
    expect(result.current[0]).toEqual({ undecided: 'accept', author: '' });
    expect(result.current[0]).toEqual(DEFAULT_EXPORT_SETTINGS);
  });

  it('stores and restores the settings', () => {
    const { result } = renderHook(() => useExportSettings());
    act(() => result.current[1]({ undecided: 'track', author: 'Ann' }));
    expect(result.current[0]).toEqual({ undecided: 'track', author: 'Ann' });
    expect(renderHook(() => useExportSettings()).result.current[0]).toEqual({ undecided: 'track', author: 'Ann' });
  });

  it('defaults stored values that are not valid', () => {
    localStorage.setItem(KEY, JSON.stringify({ undecided: 'maybe', author: 3 }));
    expect(renderHook(() => useExportSettings()).result.current[0]).toEqual(DEFAULT_EXPORT_SETTINGS);
    localStorage.setItem(KEY, '{');
    expect(renderHook(() => useExportSettings()).result.current[0]).toEqual(DEFAULT_EXPORT_SETTINGS);
  });
});
