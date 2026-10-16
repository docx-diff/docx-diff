import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChangeItem } from '../model/changes';
import type { RangeState } from '../model/range';
import { RangeControl } from './RangeControl';

const AUTO: RangeState = { mode: 'auto', endPoint: 168 };

function setup(range: RangeState, extra: { spanning?: ChangeItem[]; picking?: boolean } = {}) {
  const onChange = vi.fn();
  const onPickingChange = vi.fn();
  render(
    <RangeControl
      range={range}
      paragraphCount={747}
      suggestedEndPoint={168}
      onChange={onChange}
      spanning={extra.spanning ?? []}
      picking={extra.picking ?? false}
      onPickingChange={onPickingChange}
    />,
  );
  return { onChange, onPickingChange };
}

describe('RangeControl', () => {
  afterEach(cleanup);

  it('tells where the edited document appears to end and lets the reviewer compare the full documents', () => {
    const { onChange } = setup(AUTO);
    expect(screen.getByTestId('range-control').textContent).toContain(
      'The edited document appears to end at paragraph 168 of the Original. The remaining 579 paragraphs are treated as unedited',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Compare the full documents' }));
    expect(onChange).toHaveBeenCalledWith({ mode: 'off', endPoint: null });
  });

  it('sets the end point by number, checking the number', () => {
    const { onChange } = setup(AUTO);
    fireEvent.click(screen.getByRole('button', { name: /Change the end point/ }));
    const input = screen.getByLabelText(/Compare the Original up to paragraph/) as HTMLInputElement;
    expect(input.value).toBe('168');
    fireEvent.change(input, { target: { value: '747' } });
    expect(screen.getByText('Enter a number from 1 to 746.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onChange).toHaveBeenCalledWith({ mode: 'manual', endPoint: 100 });
  });

  it('starts picking in the left panel, and cancels it', () => {
    const { onPickingChange } = setup(AUTO);
    fireEvent.click(screen.getByRole('button', { name: /Change the end point/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Pick in left panel' }));
    expect(onPickingChange).toHaveBeenCalledWith(true);
    cleanup();
    const picking = setup(AUTO, { picking: true });
    expect(screen.getByTestId('range-control').textContent).toContain('Click the last paragraph to compare');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(picking.onPickingChange).toHaveBeenCalledWith(false);
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
