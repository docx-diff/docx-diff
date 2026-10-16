import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileDropZones, validateDocx } from './FileDropZones';

const zip = (name: string) => new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])], name);

describe('validateDocx', () => {
  it('accepts a zip with a .docx extension, in any case', async () => {
    expect(await validateDocx(zip('a.docx'))).toBeNull();
    expect(await validateDocx(zip('B.DOCX'))).toBeNull();
  });

  it('rejects other extensions, and .docx files that are not zips', async () => {
    expect(await validateDocx(zip('a.doc'))).toMatch(/not a Word document/);
    expect(await validateDocx(new File(['hello'], 'a.docx'))).toMatch(/damaged/);
    expect(await validateDocx(new File([], 'empty.docx'))).toMatch(/damaged/);
  });
});

describe('FileDropZones', () => {
  afterEach(cleanup);

  it('passes valid files on, shows an error for invalid ones, and swaps', async () => {
    const onFile = vi.fn();
    const onSwap = vi.fn();
    const { rerender } = render(<FileDropZones original={null} edited={null} onFile={onFile} onSwap={onSwap} />);
    expect(screen.getByText(/never uploaded/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Swap/ })).toHaveProperty('disabled', true);

    const original = zip('original.docx');
    fireEvent.change(screen.getByLabelText('Original document'), { target: { files: [original] } });
    await waitFor(() => expect(onFile).toHaveBeenCalledWith('original', original));

    fireEvent.drop(screen.getByTestId('drop-edited'), { dataTransfer: { files: [new File(['x'], 'notes.txt')] } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/“notes\.txt” is not a Word document/));
    expect(onFile).toHaveBeenCalledTimes(1);

    rerender(<FileDropZones original={original} edited={null} onFile={onFile} onSwap={onSwap} />);
    expect(screen.getByText('original.docx')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Swap/ }));
    expect(onSwap).toHaveBeenCalled();
  });
});
