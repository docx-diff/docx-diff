import { useCallback, useState } from 'react';
import type { UndecidedChoice } from '../model/decisions';

/** The export dialog's choices, as last used; not part of a saved review. */
export interface ExportSettings {
  /** What the export does with undecided changes (FR-38, FR-38b). */
  undecided: UndecidedChoice;
  /** Author of the comments and tracked changes (FR-38c); empty: the default author. */
  author: string;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = { undecided: 'accept', author: '' };

const STORAGE_KEY = 'docx-diff:export-settings';
const CHOICES: readonly UndecidedChoice[] = ['accept', 'reject', 'track'];

function load(): ExportSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<ExportSettings> | null;
    return {
      undecided: stored?.undecided && CHOICES.includes(stored.undecided) ? stored.undecided : DEFAULT_EXPORT_SETTINGS.undecided,
      author: typeof stored?.author === 'string' ? stored.author : DEFAULT_EXPORT_SETTINGS.author,
    };
  } catch {
    return DEFAULT_EXPORT_SETTINGS;
  }
}

/** The export settings, remembered in this browser (a convenience: the app works without storage). */
export function useExportSettings(): [ExportSettings, (settings: ExportSettings) => void] {
  const [settings, setSettings] = useState(load);
  const update = useCallback((next: ExportSettings) => {
    setSettings(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable: the settings last for this visit.
    }
  }, []);
  return [settings, update];
}
