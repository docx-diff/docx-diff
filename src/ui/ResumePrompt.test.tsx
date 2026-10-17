import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResumePrompt } from './ResumePrompt';

function setup(disabled = false) {
  const props = {
    originalName: 'a.docx',
    editedName: 'b.docx',
    savedAt: '2026-10-17T09:00:00.000Z',
    disabled,
    onResume: vi.fn(),
    onStartNew: vi.fn(),
    onDiscard: vi.fn(),
  };
  render(<ResumePrompt {...props} />);
  return props;
}

describe('ResumePrompt', () => {
  afterEach(cleanup);

  it('asks to resume the saved review, with Resume focused', () => {
    const props = setup();
    expect(screen.getByRole('dialog', { name: 'Resume review of a.docx → b.docx?' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Resume' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(props.onResume).toHaveBeenCalled();
  });

  it('starts new (also on Escape) or discards', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Start new' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onStartNew).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(props.onDiscard).toHaveBeenCalled();
  });

  it('disables the buttons while resuming', () => {
    setup(true);
    for (const name of ['Resume', 'Start new', 'Discard']) expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
  });
});
