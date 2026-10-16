import { useCallback, useState } from 'react';
import { DEFAULT_COMPARE_SETTINGS, type CompareSettings } from '../model/equivalence';

const STORAGE_KEY = 'docx-diff:compare-settings';

function load(): CompareSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<CompareSettings> | null;
    return { ...DEFAULT_COMPARE_SETTINGS, ...stored };
  } catch {
    return DEFAULT_COMPARE_SETTINGS;
  }
}

/** The compare settings, remembered in this browser (a convenience: the app works without storage). */
export function useCompareSettings(): [CompareSettings, (settings: CompareSettings) => void] {
  const [settings, setSettings] = useState(load);
  const update = useCallback((next: CompareSettings) => {
    setSettings(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable: the settings last for this visit.
    }
  }, []);
  return [settings, update];
}
