import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_COMPARE_SETTINGS } from '../model/equivalence';
import { CompareSettingsDialog } from './CompareSettingsDialog';
import { DEFAULT_VIEW_SETTINGS } from './useViewSettings';

describe('CompareSettingsDialog', () => {
  afterEach(cleanup);

  it('shows the three settings and the card setting, reports changes, and closes with Close or Escape', () => {
    const onChange = vi.fn();
    const onViewChange = vi.fn();
    const onClose = vi.fn();
    render(
      <CompareSettingsDialog
        settings={DEFAULT_COMPARE_SETTINGS}
        onChange={onChange}
        view={DEFAULT_VIEW_SETTINGS}
        onViewChange={onViewChange}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Compare settings' })).toBeTruthy();
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((box) => box.checked)).toEqual([true, true, true, true]);

    fireEvent.click(screen.getByLabelText(/Ignore dash changes/));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_COMPARE_SETTINGS, ignoreDashes: false });
    fireEvent.click(screen.getByLabelText(/Show the change card/));
    expect(onViewChange).toHaveBeenCalledWith({ inlineCard: false });

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
