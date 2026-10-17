import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EngineError } from '../engine/client';
import type { ChangeItem } from '../model/changes';
import { ExportDialog, exportFailure, type ExportStatus } from './ExportDialog';

function setup(overrides: Partial<Parameters<typeof ExportDialog>[0]> = {}) {
  const props = {
    undecided: 3,
    formattingCount: 2,
    formattingChoice: 'edited' as const,
    onFormattingChoice: vi.fn(),
    ignored: { count: 0, decided: 0 },
    outOfRange: null,
    status: { status: 'idle' } as ExportStatus,
    onDownload: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<ExportDialog {...props} />);
  return props;
}

function item(id: string, revisionIds: string[], fields: Partial<ChangeItem> = {}): ChangeItem {
  return {
    id,
    kind: 'replaced',
    revisionIds,
    removedText: 'the old words of a rather long sentence that goes on',
    addedText: 'new words',
    location: { scope: 'body' },
    wordDelta: { removed: 1, added: 1 },
    order: 0,
    anchors: [],
    ...fields,
  };
}

describe('ExportDialog', () => {
  afterEach(cleanup);

  it('shows the undecided count, accepts undecided changes by default, and downloads with the chosen rule', () => {
    const props = setup();
    expect(screen.getByRole('dialog', { name: 'Download the reviewed document' })).toBeTruthy();
    expect(screen.getByText('3 text changes are undecided.')).toBeTruthy();
    expect((screen.getByLabelText(/Accept undecided changes/) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(props.onDownload).toHaveBeenLastCalledWith('accept');

    fireEvent.click(screen.getByLabelText(/Reject undecided changes/));
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(props.onDownload).toHaveBeenLastCalledWith('reject');
  });

  it('offers the formatting choice, and leaves it out without formatting changes', () => {
    const props = setup();
    expect(screen.getByText(/Formatting \(2 changes\)/)).toBeTruthy();
    expect((screen.getByLabelText("Use the Edited's formatting") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText("Keep the Original's formatting"));
    expect(props.onFormattingChoice).toHaveBeenCalledWith('original');
    cleanup();

    setup({ formattingCount: 0 });
    expect(screen.queryByText(/Formatting/)).toBeNull();
  });

  it('disables the undecided choice when everything is decided', () => {
    setup({ undecided: 0 });
    expect(screen.getByText('All text changes are decided.')).toBeTruthy();
    expect(screen.getByLabelText(/Reject undecided changes/).matches(':disabled')).toBe(true);
  });

  it('notes the ignored changes, the decided ones among them, and the comparison range', () => {
    setup({ ignored: { count: 4, decided: 1 }, outOfRange: { endPoint: 168, count: 1 } });
    expect(screen.getByTestId('export-ignored').textContent).toBe(
      '4 changes are ignored by the compare settings and take the Edited text, except 1 that you decided before the setting was turned on: it keeps its decision.',
    );
    expect(screen.getByTestId('export-out-of-range').textContent).toBe(
      "The document after paragraph 168 is outside the comparison range and keeps the Original's text (1 change not applied).",
    );
    cleanup();

    setup();
    expect(screen.queryByTestId('export-ignored')).toBeNull();
    expect(screen.queryByTestId('export-out-of-range')).toBeNull();
  });

  it('shows progress and disables the buttons while exporting', () => {
    const props = setup({ status: { status: 'running', startedAt: performance.now() } });
    expect(screen.getByText(/Preparing the download/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Download' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it('shows an error with its details and stays open; Cancel and Escape close it', () => {
    const props = setup({ status: { status: 'error', failure: { message: 'Change 2 cannot be exported yet.', details: 'Revision 7 (move)' } } });
    expect(screen.getByRole('alert').textContent).toContain('Change 2 cannot be exported yet.');
    expect(screen.getByText('Revision 7 (move)')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Download' }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onCancel).toHaveBeenCalledTimes(2);
  });
});

describe('exportFailure', () => {
  const items = [item('a', ['1', '2']), item('b', ['3'], { kind: 'deleted', removedText: 'tail', addedText: '' })];
  const labels = new Map([['a', '12']]);

  it('names a revision the export cannot handle by its change number, kind and text', () => {
    const failure = exportFailure(new EngineError('Revision 2 (move) cannot be exported.', 'UnsupportedRevisionError', '2'), items, labels);
    expect(failure.message).toBe(
      'Change 12 (Replaced: “the old words of a rather long sentence …”) cannot be exported yet. Please report this problem, with the two documents if you can share them.',
    );
    expect(failure.details).toBe('Revision 2 (move) cannot be exported.');
  });

  it('describes a change without a number, and markup errors alike', () => {
    expect(exportFailure(new EngineError('not found', 'RevisionMarkupError', '3'), items, labels).message).toMatch(
      /^A change outside the comparison range \(Deleted: “tail”\) cannot be exported yet\./,
    );
    expect(exportFailure(new EngineError('not found', 'RevisionMarkupError', '99'), items, labels).message).toMatch(/^One of the changes cannot/);
  });

  it('falls back to a generic message with the details', () => {
    expect(exportFailure(new Error('boom'), items, labels)).toEqual({ message: 'The reviewed document could not be prepared.', details: 'boom' });
    expect(exportFailure(new EngineError('worker crashed', 'worker_error'), items, labels).message).toBe('The reviewed document could not be prepared.');
  });
});
