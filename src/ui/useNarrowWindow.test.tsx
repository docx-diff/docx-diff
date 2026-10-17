import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNarrowWindow } from './useNarrowWindow';

/** A `matchMedia` whose match the test sets; records the queries asked. */
function stubWidth(initial: boolean) {
  const listeners = new Set<() => void>();
  const queries: string[] = [];
  const query = {
    matches: initial,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', (text: string) => {
    queries.push(text);
    return query;
  });
  return {
    queries,
    listeners,
    setNarrow(narrow: boolean) {
      query.matches = narrow;
      act(() => listeners.forEach((listener) => listener()));
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useNarrowWindow', () => {
  it('asks for windows up to 1024 px and follows changes', () => {
    const width = stubWidth(false);
    const { result } = renderHook(() => useNarrowWindow());
    expect(width.queries[0]).toBe('(max-width: 1024px)');
    expect(result.current).toBe(false);
    width.setNarrow(true);
    expect(result.current).toBe(true);
    width.setNarrow(false);
    expect(result.current).toBe(false);
  });

  it('starts narrow, and stops listening when unmounted', () => {
    const width = stubWidth(true);
    const { result, unmount } = renderHook(() => useNarrowWindow());
    expect(result.current).toBe(true);
    unmount();
    expect(width.listeners.size).toBe(0);
  });

  it('is not narrow without matchMedia', () => {
    const { result } = renderHook(() => useNarrowWindow());
    expect(result.current).toBe(false);
  });
});
