import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditingHelp, EditingHelpButton } from './EditingHelp';
import { HelpPopover } from './HelpPopover';

describe('EditingHelpButton', () => {
  afterEach(cleanup);

  it('opens the editing help, closed by the button again, Escape or a press outside', () => {
    const { getByRole, queryByRole } = render(<EditingHelpButton />);
    const button = getByRole('button', { name: 'About editing' });
    expect(button.title).toBe('About editing');
    fireEvent.click(button);
    const popover = getByRole('dialog', { name: 'About editing' });
    expect(popover.textContent).toContain('There is no undo.');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    // A press inside leaves it open.
    fireEvent.pointerDown(popover);
    expect(queryByRole('dialog')).not.toBeNull();
    fireEvent.click(button);
    expect(queryByRole('dialog')).toBeNull();
    fireEvent.click(button);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(queryByRole('dialog')).toBeNull();
    fireEvent.click(button);
    fireEvent.pointerDown(document.body);
    expect(queryByRole('dialog')).toBeNull();
  });

  it('says the same as the general Help', () => {
    const editing = render(<EditingHelp />).container.textContent!;
    cleanup();
    const onOpenChange = vi.fn();
    const { getByRole } = render(<HelpPopover open onOpenChange={onOpenChange} threeColumns={false} />);
    expect(getByRole('dialog', { name: 'Help' }).textContent).toContain(editing);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
