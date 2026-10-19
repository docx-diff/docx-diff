import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditableToggle, RevertButtons } from './EditableToggle';
import { Toast } from './Toast';

describe('EditableToggle', () => {
  afterEach(cleanup);

  it('is pressed while editing, with a tooltip for each state', () => {
    const onToggle = vi.fn();
    const { getByRole, rerender } = render(<EditableToggle editing={false} onToggle={onToggle} />);
    const button = getByRole('button', { name: 'Editable' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.title).toBe('Edit the Edited text (simple edits within a paragraph)');
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
    rerender(<EditableToggle editing onToggle={onToggle} />);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.title).toBe('Stop editing');
  });
});

describe('RevertButtons', () => {
  afterEach(cleanup);

  it('reverts the paragraph or all edits, each disabled only when there is nothing to revert', () => {
    const onRevertParagraph = vi.fn();
    const onRevertAll = vi.fn();
    const element = (paragraphEdited: boolean, anyEdits: boolean) => (
      <RevertButtons paragraphEdited={paragraphEdited} anyEdits={anyEdits} onRevertParagraph={onRevertParagraph} onRevertAll={onRevertAll} />
    );
    const { getByRole, rerender } = render(element(false, false));
    const paragraph = getByRole('button', { name: 'Revert my edits in this paragraph' }) as HTMLButtonElement;
    const all = getByRole('button', { name: 'Revert all my edits' }) as HTMLButtonElement;
    expect([paragraph.disabled, all.disabled]).toEqual([true, true]);
    expect([paragraph.textContent, all.textContent]).toEqual(['↺ ¶', '↺ all']);
    rerender(element(false, true));
    expect([paragraph.disabled, all.disabled]).toEqual([true, false]);
    rerender(element(true, true));
    fireEvent.click(paragraph);
    fireEvent.click(all);
    expect(onRevertParagraph).toHaveBeenCalledOnce();
    expect(onRevertAll).toHaveBeenCalledOnce();
  });
});

describe('Toast', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows a message for 4 s; the same message again starts the time again', () => {
    vi.useFakeTimers();
    const onHide = vi.fn();
    const { getByRole, rerender } = render(<Toast message={null} onHide={onHide} />);
    expect(getByRole('status').textContent).toBe('');
    rerender(<Toast message={{ text: 'Not here.', id: 1 }} onHide={onHide} />);
    expect(getByRole('status').textContent).toBe('Not here.');
    act(() => vi.advanceTimersByTime(3000));
    rerender(<Toast message={{ text: 'Not here.', id: 2 }} onHide={onHide} />);
    act(() => vi.advanceTimersByTime(3000));
    expect(onHide).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000));
    expect(onHide).toHaveBeenCalledOnce();
  });
});
