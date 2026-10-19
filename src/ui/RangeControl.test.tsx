import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChangeItem } from '../model/changes';
import type { RangeState } from '../model/range';
import { RangeDialog, RangePickingBar } from './RangeControl';

const AUTO: RangeState = { mode: 'auto', endPoint: 168 };

function setup(range: RangeState, extra: { spanning?: ChangeItem[] } = {}) {
  const onChange = vi.fn();
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <RangeDialog
      range={range}
      paragraphCount={747}
      suggestedEndPoint={168}
      onChange={onChange}
      spanning={extra.spanning ?? []}
      onPick={onPick}
      onClose={onClose}
    />,
  );
  return { onChange, onPick, onClose };
}

describe('RangeDialog', () => {
  afterEach(cleanup);

  it('tells where the edited document appears to end and lets the reviewer compare the full documents', () => {
    const { onChange, onClose } = setup(AUTO);
    expect(screen.getByRole('dialog', { name: 'Comparison range' }).textContent).toContain(
      'The edited document appears to end at paragraph 168 of the Original. The remaining 579 paragraphs are treated as unedited',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Compare the full documents' }));
    expect(onChange).toHaveBeenCalledWith({ mode: 'off', endPoint: null });
    expect(onClose).toHaveBeenCalled();
  });

  it('sets the end point by number, checking the number', () => {
    const { onChange, onClose } = setup(AUTO);
    fireEvent.click(screen.getByRole('button', { name: /Change the end point/ }));
    const input = screen.getByLabelText(/Compare the Original up to paragraph/) as HTMLInputElement;
    expect(input.value).toBe('168');
    fireEvent.change(input, { target: { value: '747' } });
    expect(screen.getByText('Enter a number from 1 to 746.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onChange).toHaveBeenCalledWith({ mode: 'manual', endPoint: 100 });
    expect(onClose).toHaveBeenCalled();
  });

  it('starts picking in the left panel; the picking bar cancels it', () => {
    const { onPick } = setup(AUTO);
    fireEvent.click(screen.getByRole('button', { name: /Change the end point/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Pick in left panel' }));
    expect(onPick).toHaveBeenCalled();
    cleanup();
    const onCancel = vi.fn();
    render(<RangePickingBar onCancel={onCancel} />);
    expect(screen.getByTestId('range-picking').textContent).toContain('Click the last paragraph to compare');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('closes with Close, Escape or a click outside', () => {
    const { onClose } = setup(AUTO);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('offers the detected end point again after the range was turned off or changed', () => {
    const { onChange } = setup({ mode: 'off', endPoint: null });
    expect(screen.getByTestId('range-control').textContent).toContain('Comparing the full documents.');
    fireEvent.click(screen.getByRole('button', { name: 'Use the detected end point (paragraph 168)' }));
    expect(onChange).toHaveBeenCalledWith(AUTO);
    cleanup();
    setup({ mode: 'manual', endPoint: 100 });
    expect(screen.getByTestId('range-control').textContent).toContain('Comparing the Original up to paragraph 100. The remaining 647 paragraphs');
    expect(screen.getByRole('button', { name: /Use the detected end point/ })).toBeTruthy();
  });

  it('says when a deletion spans the end point', () => {
    const spanning = { id: 'x', kind: 'deleted', removedText: 'The end of one paragraph¶and the whole next one', addedText: '' } as ChangeItem;
    setup({ mode: 'manual', endPoint: 100 }, { spanning: [spanning] });
    expect(screen.getByTestId('range-spanning').textContent).toBe(
      'A deletion starts before the end point and continues after it (“The end of one paragraph and the whole n…”). It is treated as outside the comparison as a whole, so the download keeps its text.',
    );
  });
});
