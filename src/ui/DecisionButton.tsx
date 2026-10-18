import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Decision } from '../model/decisions';

interface Props {
  decision: Decision;
  /** Whether the card's item has this decision. */
  pressed: boolean;
  /** Decides the card's item. */
  onThis: () => void;
  /** Decides the card's item and opens its comment (FR-27b). */
  onWithComment: () => void;
  /** Leaves the card's item undecided (resetting its decision) and opens its comment (FR-27b). */
  onUndecidedWithComment: () => void;
  /** Decides every undecided item from the start of the list up to and including the card's. */
  onUntilHere: () => void;
}

const LABELS: Record<Decision, { verb: string; key: string }> = {
  accepted: { verb: 'Accept', key: 'a' },
  rejected: { verb: 'Reject', key: 'r' },
};

/**
 * Accept or Reject on a change card (FR-27), with a joined arrow opening a menu: decide this change
 * (the button's own action), decide it with a comment (FR-27b), leave it undecided with a comment
 * (e.g. for a change exported as a tracked change, FR-38b), or decide every undecided change up to
 * here (FR-27a). The menu items name their shortcut keys, which also pick them while the menu is
 * open.
 *
 * The menu is portalled to `body` with fixed positioning: the list rows are transformed and the
 * list scrolls, which would clip it or let the next row cover it.
 */
export function DecisionButton({ decision, pressed, onThis, onWithComment, onUndecidedWithComment, onUntilHere }: Props) {
  const { verb, key } = LABELS[decision];
  const [open, setOpen] = useState(false);
  const arrowRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) arrowRef.current?.focus();
  };

  // Placed before the first paint, then focused.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!open || !menu || !arrowRef.current) return;
    const rect = arrowRef.current.getBoundingClientRect();
    // Below the arrow, or above it when there is no room below.
    const below = rect.bottom + 2;
    menu.style.top = `${below + menu.offsetHeight > window.innerHeight ? rect.top - 2 - menu.offsetHeight : below}px`;
    menu.style.left = `${Math.min(rect.left, window.innerWidth - menu.offsetWidth - 4)}px`;
    menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !arrowRef.current?.contains(target)) setOpen(false);
    };
    // The menu stays where it opened; scrolling would leave it behind.
    const onScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onResize = () => setOpen(false);
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const choose = (action: () => void) => {
    close(true);
    action();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    let handled = true;
    if (event.key === 'Escape') close(true);
    else if (event.key === 'Tab') close(false);
    else if (event.key === 'ArrowDown') items[(at + 1) % items.length]?.focus();
    else if (event.key === 'ArrowUp') items[(at - 1 + items.length) % items.length]?.focus();
    else if (event.key === 'Home') items[0]?.focus();
    else if (event.key === 'End') items[items.length - 1]?.focus();
    else if (event.key === key) choose(onThis);
    else if (event.key === key.toUpperCase()) choose(onUntilHere);
    else handled = false;
    // Handled keys must not reach the card or the review shortcuts (↓ would go to the next change).
    if (handled && event.key !== 'Tab') event.preventDefault();
    event.stopPropagation();
  };

  const variant = decision === 'accepted' ? 'accept' : 'reject';
  return (
    <span className="split-button">
      <button
        type="button"
        className={`button button--small button--${variant} split-button__main`}
        aria-pressed={pressed}
        onClick={(event) => {
          event.stopPropagation();
          onThis();
        }}
      >
        {verb}
      </button>
      <button
        ref={arrowRef}
        type="button"
        className={`button button--small button--${variant} split-button__arrow`}
        aria-label={`More ${verb} options`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <span aria-hidden="true">▾</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={`${verb} options`}
            className="split-button__menu"
            onKeyDown={onMenuKeyDown}
            // React events bubble through the portal to the card, which would select it.
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" role="menuitem" tabIndex={-1} className="split-button__item" onClick={() => choose(onThis)}>
              {verb} this <kbd>{key}</kbd>
            </button>
            <button type="button" role="menuitem" tabIndex={-1} className="split-button__item" onClick={() => choose(onWithComment)}>
              {verb} this with comment
            </button>
            <button type="button" role="menuitem" tabIndex={-1} className="split-button__item" onClick={() => choose(onUndecidedWithComment)}>
              Undecided with comment
            </button>
            <button type="button" role="menuitem" tabIndex={-1} className="split-button__item" onClick={() => choose(onUntilHere)}>
              {verb} all undecided until here <kbd>{key.toUpperCase()}</kbd>
            </button>
          </div>,
          document.body,
        )}
    </span>
  );
}
