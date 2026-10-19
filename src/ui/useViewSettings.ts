import { useCallback, useState } from 'react';

/** How the review is shown; unlike the compare settings, not part of a saved review. */
export interface ViewSettings {
  /** The current change's card is shown under it in the Edited's panel (FR-28a). */
  inlineCard: boolean;
  /** The changes list is shown (FR-26b). */
  changesList: boolean;
  /** The outline sidebar is shown (FR-24a). */
  outline: boolean;
  /** The Resolved column is shown between the Original and the Edited (FR-25c). */
  threeColumns: boolean;
  /** Justified paragraphs are shown aligned to the start, in every panel (FR-20a). */
  leftAligned: boolean;
  /** Paragraphs with no text are not shown, in any panel (FR-20b). */
  hideBlankParagraphs: boolean;
}

export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  inlineCard: true,
  changesList: false,
  outline: false,
  threeColumns: true,
  leftAligned: true,
  hideBlankParagraphs: true,
};

const STORAGE_KEY = 'docx-diff:view-settings';

function load(): ViewSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<ViewSettings> | null;
    return { ...DEFAULT_VIEW_SETTINGS, ...stored };
  } catch {
    return DEFAULT_VIEW_SETTINGS;
  }
}

/** The view settings, remembered in this browser (a convenience: the app works without storage). */
export function useViewSettings(): [ViewSettings, (change: Partial<ViewSettings>) => void] {
  const [settings, setSettings] = useState(load);
  const update = useCallback((change: Partial<ViewSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...change };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage unavailable: the settings last for this visit.
      }
      return next;
    });
  }, []);
  return [settings, update];
}
