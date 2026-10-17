import { useCallback, useEffect, useState } from 'react';

/** Light or dark colours (FR-25a; `data-theme` on the root element, read by index.css). */
export type Theme = 'light' | 'dark';

// index.html repeats this key and the resolution below, to set the theme before the first paint.
const STORAGE_KEY = 'docx-diff:theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function systemTheme(): Theme {
  return typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

/** The reviewer's choice in this browser, or null to follow the browser's preference. */
function storedTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    return null;
  }
}

function store(theme: Theme | null): void {
  try {
    if (theme) localStorage.setItem(STORAGE_KEY, theme);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: the choice lasts for this visit.
  }
}

/**
 * The current theme and a toggle. It follows the browser's preference, also when it changes, until
 * the reviewer picks the other theme; picking the one the browser prefers follows the browser again.
 */
export function useTheme(): [Theme, () => void] {
  const [choice, setChoice] = useState(storedTheme);
  const [system, setSystem] = useState(systemTheme);
  const theme = choice ?? system;

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia(DARK_QUERY);
    const onChange = () => setSystem(query.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    const nextChoice = next === system ? null : next;
    store(nextChoice);
    setChoice(nextChoice);
  }, [theme, system]);

  return [theme, toggle];
}
