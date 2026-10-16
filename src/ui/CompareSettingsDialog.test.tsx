import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_COMPARE_SETTINGS } from '../model/equivalence';
import { CompareSettingsDialog } from './CompareSettingsDialog';

describe('CompareSettingsDialog', () => {
  afterEach(cleanup);

  it('shows the three settings, reports changes, and closes with Close or Escape', () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(<CompareSettingsDialog settings={DEFAULT_COMPARE_SETTINGS} onChange={onChange} onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Compare settings' })).toBeTruthy();
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((box) => box.checked)).toEqual([true, true, true]);

    fireEvent.click(screen.getByLabelText(/Ignore dash changes/));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_COMPARE_SETTINGS, ignoreDashes: false });

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
