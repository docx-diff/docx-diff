import { cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { smallComparison } from '../../test/small-comparison';
import { DEFAULT_COMPARE_SETTINGS } from '../model/equivalence';
import type { Decision } from '../model/decisions';
import { DocumentPanel, type PanelControl, type PanelSide } from './DocumentPanel';
import type { EditingOptions } from './editing';
import type { RenderedDocument } from './renderedDocument';
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

describe('DocumentPanel editing', () => {
  afterEach(cleanup);

  function editablePanel(session: EditSession) {
    const control = createRef<PanelControl>();
    const onChangeClick = vi.fn();
    const options: EditingOptions = {
      reasonOf: (unid) => (unid === 'p' ? undefined : 'move'),
      textOf: (unid) => session.visibleText(unid),
      onEdit: vi.fn(() => 'unchanged' as const),
      onMessage: vi.fn(),
    };
    const element = (editing: EditingOptions | undefined, document: RenderedDocument = session.comparison.document) => (
      <DocumentPanel
        side="right"
        theme="light"
        title="t"
        document={document}
        ignored={new Set()}
        settings={DEFAULT_COMPARE_SETTINGS}
        decisions={{}}
        currentItemId={null}
        onChangeClick={onChangeClick}
        overviewItems={[]}
        outOfRangeItems={new Set()}
        controlRef={control}
        editing={editing}
      />
    );
    const view = render(element(options));
    const root = view.getByTestId('panel-right').shadowRoot!;
    return { control, root, options, onChangeClick, view, rerender: (editing: EditingOptions | undefined, document?: RenderedDocument) => view.rerender(element(editing, document)) };
  }

  /** Text typed into the block, and its `input` event. */
  const type = (block: HTMLElement, text: string) => {
    block.querySelector('ins')!.append(text);
    block.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: text, bubbles: true, composed: true }));
  };

  it('makes the editable blocks editable, and a click there doesn’t select a change', () => {
    const session = new EditSession(smallComparison());
    const { root, onChangeClick, options, view, rerender } = editablePanel(session);
    expect(view.container.querySelector('.document-panel--editing')).not.toBeNull();
    expect(root.querySelector('.doc')!.classList.contains('doc--editing')).toBe(true);
    expect(blockIn(root, 'p').getAttribute('contenteditable')).toBe('true');
    expect(blockIn(root, 'q').hasAttribute('contenteditable')).toBe(false);
    blockIn(root, 'p').querySelector('ins')!.click();
    expect(onChangeClick).not.toHaveBeenCalled();
    blockIn(root, 'q').querySelector('ins')!.click();
    expect(options.onMessage).toHaveBeenCalledWith('This paragraph can’t be edited here: it contains a moved passage.');
    expect(onChangeClick).not.toHaveBeenCalled();

    rerender(undefined);
    expect(root.querySelector('[contenteditable]')).toBeNull();
    expect(view.container.querySelector('.document-panel--editing')).toBeNull();
    blockIn(root, 'p').querySelector('ins')!.click();
    expect(onChangeClick).toHaveBeenCalled();
  });

  it('makes a replaced block editable again', () => {
    const session = new EditSession(smallComparison());
    const { control, root } = editablePanel(session);
    control.current!.replaceBlock('p', session.update('p', 'the big blue house', 'the big blue'.length)!.block);
    expect(blockIn(root, 'p').getAttribute('contenteditable')).toBe('true');
  });

  it('applies what was typed when editing is turned off, not when the document changes', () => {
    const session = new EditSession(smallComparison());
    const { root, options, rerender } = editablePanel(session);
    type(blockIn(root, 'p'), 'x');
    rerender(undefined);
    expect(options.onEdit).toHaveBeenCalledOnce();
    expect(vi.mocked(options.onEdit).mock.calls[0]![1]).toContain('x');

    rerender(options);
    type(blockIn(root, 'p'), 'y');
    rerender(undefined, smallComparison().document);
    expect(options.onEdit).toHaveBeenCalledOnce();
  });
});

describe('DocumentPanel alignment', () => {
  afterEach(cleanup);

  it('shows justified paragraphs aligned to the start while leftAligned, keeping centred ones', () => {
    const comparison = smallComparison();
    const body = comparison.document.body.cloneNode(true) as HTMLElement;
    body.querySelector('[data-anchor="p"]')!.setAttribute('style', 'text-align: justify; color: #000000');
    body.querySelector('[data-anchor="q"]')!.setAttribute('style', 'text-align:center');
    const document: RenderedDocument = { ...comparison.document, body, css: '.docx-Normal { text-align: justify; }' };
    const element = (leftAligned: boolean) => (
      <DocumentPanel
        side="left"
        theme="light"
        leftAligned={leftAligned}
        title="t"
        document={document}
        ignored={new Set()}
        settings={DEFAULT_COMPARE_SETTINGS}
        decisions={{}}
        currentItemId={null}
        onChangeClick={() => {}}
        overviewItems={[]}
        outOfRangeItems={new Set()}
      />
    );
    const view = render(element(true));
    const root = view.getByTestId('panel-left').shadowRoot!;
    expect(root.querySelector('style')!.textContent).toBe('.docx-Normal { text-align: start; }');
    expect(blockIn(root, 'p').getAttribute('style')).toBe('text-align: start; color: #000000');
    expect(blockIn(root, 'q').getAttribute('style')).toBe('text-align:center');
    view.rerender(element(false));
    expect(root.querySelector('style')!.textContent).toBe('.docx-Normal { text-align: justify; }');
    expect(blockIn(root, 'p').getAttribute('style')).toBe('text-align: justify; color: #000000');
  });
});
