import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTheme } from './theme';

const KEY = 'docx-diff:theme';

/** A `matchMedia` whose dark preference the test sets. */
function preferDark(initial: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: initial,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', () => query);
  return (dark: boolean) => {
    query.matches = dark;
    act(() => listeners.forEach((listener) => listener()));
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
});

describe('useTheme', () => {
  it("follows the browser's preference, also when it changes", () => {
    const setPreference = preferDark(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current[0]).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    setPreference(false);
    expect(result.current[0]).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('remembers a choice against the preference, and forgets one that matches it', () => {
    const setPreference = preferDark(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current[1]());
    expect(result.current[0]).toBe('dark');
    expect(localStorage.getItem(KEY)).toBe('dark');
    setPreference(true);
    setPreference(false);
    expect(result.current[0]).toBe('dark');
    act(() => result.current[1]());
    expect(result.current[0]).toBe('light');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('starts from a stored choice', () => {
    preferDark(false);
    localStorage.setItem(KEY, 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current[0]).toBe('dark');
  });

  it('is light without matchMedia', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current[0]).toBe('light');
  });
});
