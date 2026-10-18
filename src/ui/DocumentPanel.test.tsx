import { cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { smallComparison } from '../../test/small-comparison';
import { DEFAULT_COMPARE_SETTINGS } from '../model/equivalence';
import type { Decision } from '../model/decisions';
import { DocumentPanel, type PanelControl, type PanelSide } from './DocumentPanel';
import { EditSession, showBlockUpdates } from './useEdits';

/** One panel of the small comparison, and a way to render it again with other decisions. */
function panel(side: PanelSide, session: EditSession, options: { theme?: 'light' | 'dark'; decisions?: Record<string, Decision>; current?: string | null; ignored?: Set<string> } = {}) {
  const control = createRef<PanelControl>();
  const element = (decisions: Record<string, Decision>, current: string | null) => (
    <DocumentPanel
      side={side}
      theme={options.theme ?? 'light'}
      title="t"
      document={session.comparison.document}
      ignored={options.ignored ?? new Set()}
      settings={DEFAULT_COMPARE_SETTINGS}
      decisions={decisions}
      currentItemId={current}
      onChangeClick={() => {}}
      overviewItems={[]}
      outOfRangeItems={new Set()}
      resolved={side === 'resolved' ? { sides: new Map(), positions: new Map(), endPoint: null } : undefined}
      controlRef={control}
    />
  );
  const view = render(element(options.decisions ?? {}, options.current ?? null));
  const root = view.getByTestId(`panel-${side}`).shadowRoot!;
  return { control, root, rerender: (decisions: Record<string, Decision>, current: string | null = null) => view.rerender(element(decisions, current)) };
}

const blockIn = (root: ShadowRoot, unid: string) => root.querySelector<HTMLElement>(`[data-anchor="${unid}"]`)!;

describe('DocumentPanel replaceBlock', () => {
  afterEach(cleanup);

  it('swaps in a copy of the master block, shown with the decisions, the current change and the ignored changes applied', () => {
    const session = new EditSession(smallComparison());
    const { control, root, rerender } = panel('right', session, { decisions: { r1: 'accepted', r2: 'rejected' }, current: 'r2', ignored: new Set(['r2']) });
    const old = blockIn(root, 'p');
    const update = session.update('p', 'the big blue house', 'the big blue'.length)!;
    control.current!.replaceBlock('p', update.block);
    const block = blockIn(root, 'p');
    expect(block).not.toBe(old);
    expect(block).not.toBe(update.block);
    expect(block.textContent).toBe(update.block.textContent);
    expect(block.querySelector('ins[data-change-id="r1"]')!.className).toContain('change-accepted');
    expect(block.querySelector('ins[data-change-id="r1"]')!.className).toContain('change-decided-end');
    expect(block.querySelector('ins[data-change-id="r2"]')!.className).toContain('change-current');
    expect(block.querySelector('ins[data-change-id="r2"]')!.className).toContain('change-ignored');
    // The new item's elements are known to the panel: a decision reaches them.
    rerender({ r1: 'accepted', r2: 'rejected', 'ep.1': 'accepted' }, 'ep.1');
    expect(block.querySelector('ins[data-change-id="ep.1"]')!.className).toContain('change-accepted');
    expect(block.querySelector('del[data-change-id="ep.1"]')!.className).toContain('change-current');
  });

  it('gives the new block’s own colours the dark theme', () => {
    const session = new EditSession(smallComparison());
    const { control, root } = panel('left', session, { theme: 'dark' });
    const themed = blockIn(root, 'p').querySelector('[style]')!.getAttribute('style');
    control.current!.replaceBlock('p', session.update('p', 'the big red old house', 'the big red old'.length)!.block);
    const styled = blockIn(root, 'p').querySelector('[style]')!;
    expect(styled.getAttribute('style')).toBe(themed);
    expect(styled.getAttribute('style')).not.toBe('color: #000000');
  });

  it('replaces the block in the Resolved column with its items shown by their sides', () => {
    const session = new EditSession(smallComparison());
    const { control, root } = panel('resolved', session);
    control.current!.replaceBlock('q', session.update('q', 'The house stood.')!.block);
    expect(blockIn(root, 'q').querySelector('ins[data-change-id="r3"]')!.textContent).toBe('house');
    expect(blockIn(root, 'q').querySelector('del[data-change-id="r3"]')!.className).toContain('resolved-hidden');
  });
});

describe('showBlockUpdates', () => {
  afterEach(cleanup);

  it('shows an update in every panel and accepts the items a live edit created, not those of a revert', () => {
    const session = new EditSession(smallComparison());
    const panels = (['left', 'resolved', 'right'] as const).map((side) => panel(side, session));
    const accepted: string[][] = [];
    const accept = (ids: string[]) => accepted.push(ids);
    showBlockUpdates([session.update('p', 'the big blue house', 'the big blue'.length)!], panels.map((p) => p.control.current), accept);
    for (const { root } of panels) expect(blockIn(root, 'p').querySelectorAll(':is(ins, del)[data-change-id="ep.1"]')).toHaveLength(2);
    expect(accepted).toEqual([['ep.1']]);
    showBlockUpdates(session.revertAll(), panels.map((p) => p.control.current), accept);
    for (const { root } of panels) expect(blockIn(root, 'p').outerHTML).not.toContain('ep.1');
    expect(accepted).toEqual([['ep.1']]);
  });
});
