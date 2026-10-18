import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CompareProgress, estimatePercent } from './Progress';

describe('estimatePercent', () => {
  it('rises within a stage without reaching its end, and never goes back at the next stage', () => {
    expect(estimatePercent('comparing', 0)).toBe(0);
    const comparing = [1000, 3000, 10_000, 600_000].map((ms) => estimatePercent('comparing', ms));
    expect(comparing).toEqual([...comparing].sort((a, b) => a - b));
    expect(Math.max(...comparing)).toBeLessThanOrEqual(40);
    expect(estimatePercent('listing', 0)).toBeGreaterThanOrEqual(Math.max(...comparing));
    expect(estimatePercent('rendering', 0)).toBeGreaterThanOrEqual(estimatePercent('listing', 600_000));
    expect(estimatePercent('rendering', 600_000)).toBeLessThan(100);
  });
});

describe('CompareProgress', () => {
  afterEach(cleanup);

  it('shows the percentage in a progress bar, the stage and the seconds', () => {
    render(<CompareProgress startedAt={performance.now()} stage="listing" />);
    const bar = screen.getByRole('progressbar', { name: 'Listing the changes' });
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    expect(bar.textContent).toBe('40%');
    expect(screen.getByTestId('compare-progress').textContent).toMatch(/Listing the changes….*\d\.\d s/);
  });
});
