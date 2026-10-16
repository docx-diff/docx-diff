import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useKeyboardShortcuts, type ShortcutAction } from './useKeyboardShortcuts';

function Harness({ onAction, enabled = true }: { onAction: (action: ShortcutAction) => void; enabled?: boolean }) {
  useKeyboardShortcuts(onAction, enabled);
  return (
    <div>
      <input aria-label="field" />
      <input type="radio" aria-label="choice" />
      <div className="document-panel__scroller" data-testid="panel" tabIndex={0} />
    </div>
  );
}

describe('useKeyboardShortcuts', () => {
  afterEach(cleanup);

  it('maps the keys to actions', () => {
    const onAction = vi.fn();
    render(<Harness onAction={onAction} />);
    for (const key of ['j', 'ArrowDown', 'k', 'ArrowUp', 'a', 'r', 'u', '?']) fireEvent.keyDown(document.body, { key });
    expect(onAction.mock.calls.map(([action]) => action)).toEqual(['next', 'next', 'previous', 'previous', 'accept', 'reject', 'reset', 'help']);
  });

  it('leaves alone typing, modified keys, arrows in a panel, open modals and the disabled state', () => {
    const onAction = vi.fn();
    const { getByLabelText, getByTestId, rerender } = render(<Harness onAction={onAction} />);
    fireEvent.keyDown(getByLabelText('field'), { key: 'a' });
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(getByTestId('panel'), { key: 'ArrowDown' });
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.append(modal);
    fireEvent.keyDown(document.body, { key: 'j' });
    modal.remove();
    rerender(<Harness onAction={onAction} enabled={false} />);
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(onAction).not.toHaveBeenCalled();
    // `j` in a panel still navigates.
    rerender(<Harness onAction={onAction} />);
    fireEvent.keyDown(getByTestId('panel'), { key: 'j' });
    expect(onAction).toHaveBeenCalledWith('next');
  });

  it('works while a radio button has focus, and keeps the arrow keys from changing it', () => {
    const onAction = vi.fn();
    const { getByLabelText } = render(<Harness onAction={onAction} />);
    fireEvent.keyDown(getByLabelText('choice'), { key: 'a' });
    const arrow = fireEvent.keyDown(getByLabelText('choice'), { key: 'ArrowDown' });
    expect(onAction.mock.calls.map(([action]) => action)).toEqual(['accept', 'next']);
    // `fireEvent` returns false when the default action (moving the radio selection) was prevented.
    expect(arrow).toBe(false);
  });
});
