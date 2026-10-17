import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutlineEntry } from '../model/outline';
import { Outline } from './Outline';

const entries: OutlineEntry[] = [
  { unid: 'a', level: 2, text: 'Introduction', inOriginal: true, inEdited: true },
  { unid: 'b', level: 3, text: 'Background', inOriginal: true, inEdited: false },
  { unid: 'c', level: 3, text: 'Scope', inOriginal: false, inEdited: true },
];

function renderOutline(overrides: Partial<Parameters<typeof Outline>[0]> = {}) {
  const props = { entries, outOfRangeBlocks: new Set<string>(), onSelect: vi.fn(), onHide: vi.fn(), ...overrides };
  render(<Outline {...props} />);
  return props;
}

describe('Outline', () => {
  afterEach(cleanup);

  it('lists the headings indented from the top level, marking those only one version has', () => {
    renderOutline({ outOfRangeBlocks: new Set(['c']) });
    const intro = screen.getByRole('button', { name: 'Introduction' });
    const background = screen.getByRole('button', { name: 'Background' });
    const scope = screen.getByRole('button', { name: 'Scope' });
    expect(intro.style.paddingLeft).toBe('0.5rem');
    expect(background.style.paddingLeft).toBe('1.375rem');
    expect(background.className).toContain('outline__entry--deleted');
    expect(background.title).toBe('Background (Only in the Original)');
    expect(scope.className).toContain('outline__entry--inserted');
    expect(scope.className).toContain('outline__entry--out-of-range');
  });

  it('selects a heading on click and hides itself with the « button', () => {
    const props = renderOutline();
    fireEvent.click(screen.getByRole('button', { name: 'Background' }));
    expect(props.onSelect).toHaveBeenCalledWith('b');
    fireEvent.click(screen.getByRole('button', { name: 'Hide the outline' }));
    expect(props.onHide).toHaveBeenCalledOnce();
  });

  it('says so when there are no headings', () => {
    renderOutline({ entries: [] });
    expect(screen.getByText('The documents have no headings.')).toBeTruthy();
  });
});
