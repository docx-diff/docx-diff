import { useEffect, useRef } from 'react';

export type ShortcutAction = 'next' | 'previous' | 'accept' | 'reject' | 'acceptUntil' | 'rejectUntil' | 'reset' | 'help';

/** The shortcuts (FR-34), as listed in the help popover. */
export const SHORTCUTS: { keys: string[]; action: ShortcutAction; label: string }[] = [
  { keys: ['j', 'ArrowDown'], action: 'next', label: 'Next change' },
  { keys: ['k', 'ArrowUp'], action: 'previous', label: 'Previous change' },
  { keys: ['a'], action: 'accept', label: 'Accept the current change and go to the next undecided one' },
  { keys: ['r'], action: 'reject', label: 'Reject the current change and go to the next undecided one' },
  { keys: ['A'], action: 'acceptUntil', label: 'Accept all undecided changes up to and including the current one' },
  { keys: ['R'], action: 'rejectUntil', label: 'Reject all undecided changes up to and including the current one' },
  { keys: ['u'], action: 'reset', label: 'Reset the current change to undecided' },
  { keys: ['?'], action: 'help', label: 'Show or hide this help' },
];

const ACTION_BY_KEY = new Map(SHORTCUTS.flatMap(({ keys, action }) => keys.map((key) => [key, action] as const)));

/**
 * Fields that take typed keys. Buttons, checkboxes, radio buttons and file inputs are not among
 * them: the shortcuts work while they have focus, and the arrow keys don't step through a radio
 * group (↓ on the formatting choice would otherwise change it instead of going to the next change).
 */
const TYPING_FIELDS =
  'input:not([type="button"], [type="checkbox"], [type="file"], [type="image"], [type="radio"], [type="reset"], [type="submit"]), textarea, select, [contenteditable=""], [contenteditable="true"]';

/** Focus is where typing or the key's own meaning must win. */
function isTypingTarget(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(TYPING_FIELDS)) return true;
  // Arrow keys scroll a focused document panel (not from the change card shown in it).
  return key.startsWith('Arrow') && target.closest('.document-panel__scroller') !== null && target.closest('.inline-card') === null;
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
      // A key from inside a panel's shadow root reaches `window` retargeted to the panel: its own
      // target (e.g. an editable paragraph) is the first of the composed path.
      if (!action || isTypingTarget(event.composedPath()[0] ?? event.target, event.key)) return;
      // A modal dialog (e.g. a confirmation) has its own keys.
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      handler.current(action);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
