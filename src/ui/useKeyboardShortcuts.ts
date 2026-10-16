import { useEffect, useRef } from 'react';

export type ShortcutAction = 'next' | 'previous' | 'accept' | 'reject' | 'reset' | 'help';

/** The shortcuts (FR-34, PRD open question 3), as listed in the help popover. */
export const SHORTCUTS: { keys: string[]; action: ShortcutAction; label: string }[] = [
  { keys: ['j', 'ArrowDown'], action: 'next', label: 'Next change' },
  { keys: ['k', 'ArrowUp'], action: 'previous', label: 'Previous change' },
  { keys: ['a'], action: 'accept', label: 'Accept the current change and go to the next undecided one' },
  { keys: ['r'], action: 'reject', label: 'Reject the current change and go to the next undecided one' },
  { keys: ['u'], action: 'reset', label: 'Reset the current change to undecided' },
  { keys: ['?'], action: 'help', label: 'Show or hide this help' },
];

const ACTION_BY_KEY = new Map(SHORTCUTS.flatMap(({ keys, action }) => keys.map((key) => [key, action] as const)));

/** Focus is where typing or the key's own meaning must win. */
function isTypingTarget(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return true;
  // Arrow keys scroll a focused document panel.
  return key.startsWith('Arrow') && target.closest('.document-panel__scroller') !== null;
}

/**
 * Calls `onAction` for the review shortcuts while `enabled` and no modal dialog is open. Keys
 * typed into form fields and keys with Ctrl, Alt or Meta are left alone.
 */
export function useKeyboardShortcuts(onAction: (action: ShortcutAction) => void, enabled: boolean): void {
  const handler = useRef(onAction);
  handler.current = onAction;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
      const action = ACTION_BY_KEY.get(event.key);
      if (!action || isTypingTarget(event.target, event.key)) return;
      // A modal dialog (e.g. a confirmation) has its own keys.
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      handler.current(action);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
