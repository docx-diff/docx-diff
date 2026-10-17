import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChangeItem, ChangeKind } from '../model/changes';
import { buildReviewList } from '../model/reviewList';
import { ChangesList, type ListTotals } from './ChangesList';

function item(id: string, kind: ChangeKind, order: number, fields: Partial<ChangeItem> = {}): ChangeItem {
  return {
    id,
    kind,
    revisionIds: [id],
    removedText: '',
    addedText: '',
    location: { scope: 'body' },
    wordDelta: { removed: 0, added: 0 },
    order,
    anchors: [],
    ...fields,
  };
}

const text = [
  item('a', 'replaced', 0, { removedText: 'brown', addedText: 'red', wordDelta: { removed: 1, added: 1 } }),
  item('b', 'deleted', 3, { removedText: 'x'.repeat(500), location: { scope: 'footnote', noteId: '2' } }),
];
const formatting = [item('f', 'formatting', 1, { text: 'Bold words', description: 'Bold added' }), item('g', 'formatting', 2, { text: 'More' })];
const totals: ListTotals = { text: { total: 2, accepted: 0, rejected: 1, undecided: 1 }, formatting: 2, ignored: 3 };

function renderList(expanded: boolean, overrides: Partial<Parameters<typeof ChangesList>[0]> = {}) {
  const props = {
    entries: buildReviewList(text, formatting, expanded),
    decisions: { b: 'rejected' as const },
    comments: {} as Record<string, string>,
    currentItemId: 'a',
    onSelect: vi.fn(),
    onDecide: vi.fn(),
    onDecideUntil: vi.fn(),
    onComment: vi.fn(),
    onDecideAllUndecided: vi.fn(),
    formattingChoice: 'edited' as const,
    onFormattingChoice: vi.fn(),
    formattingExpanded: expanded,
    onFormattingExpanded: vi.fn(),
    totals,
    ...overrides,
  };
  render(<ChangesList {...props} />);
  return props;
}

describe('ChangesList', () => {
  afterEach(cleanup);

  // jsdom has no layout; the virtualizer reads sizes from `offsetHeight`/`offsetWidth`.
  const descriptors = ['offsetHeight', 'offsetWidth'].map((name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const);
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('changes__scroller') ? 800 : 100;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 320 });
  });
  afterAll(() => {
    for (const [name, descriptor] of descriptors) if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
  });

  it('shows the text changes with their details, the collapsed formatting group and the totals', () => {
    const props = renderList(false);
    const cards = screen.getAllByTestId('change-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toMatch(/^1Replaced\s*Body−1 \+1Undecidedbrown red/);
    expect(cards[0]!.getAttribute('aria-current')).toBe('true');
    // Long text is truncated; the location names the note.
    expect(cards[1]!.textContent).toContain('Footnote 2');
    expect(cards[1]!.textContent).toContain('✗ Rejected');
    expect(cards[1]!.querySelector('del')!.textContent!.length).toBeLessThan(200);
    expect(screen.getByTestId('formatting-group').textContent).toContain('Formatting changes (2)');
    expect(screen.getByTestId('changes-totals').textContent).toContain('2 text changes: 0 accepted, 1 rejected, 1 undecided');
    expect(screen.getByTestId('changes-totals').textContent).toContain('3 ignored');

    fireEvent.click(within(cards[0]!).getByRole('button', { name: 'Accept' }));
    expect(props.onDecide).toHaveBeenCalledWith('a', 'accepted');
    expect(props.onSelect).not.toHaveBeenCalled();
    fireEvent.click(within(cards[1]!).getByRole('button', { name: 'Reset' }));
    expect(props.onDecide).toHaveBeenCalledWith('b', null);
    fireEvent.click(cards[1]!);
    expect(props.onSelect).toHaveBeenCalledWith('b');

    fireEvent.click(screen.getByRole('button', { name: /Formatting changes/ }));
    expect(props.onFormattingExpanded).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('radio', { name: "Keep the Original's formatting" }));
    expect(props.onFormattingChoice).toHaveBeenCalledWith('original');
  });

  it('shows formatting items without Accept/Reject when expanded', () => {
    renderList(true);
    const cards = screen.getAllByTestId('change-card');
    expect(cards.map((card) => card.dataset.itemId)).toEqual(['a', 'f', 'g', 'b']);
    expect(cards[1]!.textContent).toContain('Bold added');
    expect(cards[2]!.textContent).toContain('Formatting changed');
    expect(within(cards[1]!).queryByRole('button', { name: 'Accept' })).toBeNull();
  });

  it('asks before deciding all undecided changes', () => {
    const props = renderList(false);
    fireEvent.click(screen.getByRole('button', { name: 'Reject all' }));
    const dialog = screen.getByRole('dialog', { name: 'Reject all changes?' });
    expect(dialog.textContent).toContain('rejects the 1 undecided text change.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(props.onDecideAllUndecided).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Accept all' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Accept all' }));
    expect(props.onDecideAllUndecided).toHaveBeenCalledWith('accepted');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the wording at both ends of a move that carries edits, and selects a focused card with Enter', () => {
    const moves = [
      item('m', 'moved', 0, { text: 'their daily alms food' }),
      item('n', 'moved', 1, { text: 'their daily alms food', moveEdit: { from: 'their daily alms food', to: 'their alms food' } }),
    ];
    const props = renderList(false, { entries: buildReviewList(moves, [], false) });
    const [plain, edited] = screen.getAllByTestId('change-card');
    expect(plain!.querySelector('.change-card__moved')!.textContent).toBe('their daily alms food');
    expect(edited!.querySelector('del')!.textContent).toBe('their daily alms food');
    expect(edited!.querySelector('ins')!.textContent).toBe('their alms food');

    expect(edited!.tabIndex).toBe(0);
    fireEvent.keyDown(edited!, { key: 'Enter' });
    expect(props.onSelect).toHaveBeenCalledWith('n');
    // Enter on the card's own buttons is theirs.
    fireEvent.keyDown(within(plain!).getByRole('button', { name: 'Accept' }), { key: 'Enter' });
    expect(props.onSelect).toHaveBeenCalledTimes(1);
  });

  it('opens a menu from the arrow joined to Accept/Reject: this, or all undecided until here', () => {
    const props = renderList(false);
    const [first, second] = screen.getAllByTestId('change-card');
    fireEvent.click(within(second!).getByRole('button', { name: 'More Accept options' }));
    const menu = screen.getByRole('menu', { name: 'Accept options' });
    const [thisItem, withComment, untilItem] = within(menu).getAllByRole('menuitem');
    expect(thisItem!.textContent).toBe('Accept this a');
    expect(withComment!.textContent).toBe('Accept this with comment');
    expect(untilItem!.textContent).toBe('Accept all undecided until here A');
    expect(document.activeElement).toBe(thisItem);
    fireEvent.click(untilItem!);
    expect(props.onDecideUntil).toHaveBeenCalledWith('b', 'accepted');
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();

    // Keys: ↓ moves within the menu (not to the next change), the shortcut letters pick, Escape closes.
    const arrow = within(first!).getByRole('button', { name: 'More Reject options' });
    fireEvent.click(arrow);
    const reject = screen.getByRole('menu', { name: 'Reject options' });
    fireEvent.keyDown(reject, { key: 'End' });
    expect(document.activeElement!.textContent).toContain('until here');
    fireEvent.keyDown(reject, { key: 'r' });
    expect(props.onDecide).toHaveBeenCalledWith('a', 'rejected');
    expect(document.activeElement).toBe(arrow);
    fireEvent.click(arrow);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'R' });
    expect(props.onDecideUntil).toHaveBeenCalledWith('a', 'rejected');
    fireEvent.click(arrow);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(arrow);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(props.onDecide).toHaveBeenCalledTimes(1);
  });

  it('decides with a comment, which is edited and removed under the card', () => {
    const props = renderList(false);
    const card = () => screen.getAllByTestId('change-card')[0]!;
    expect(within(card()).queryByRole('textbox')).toBeNull();
    fireEvent.click(within(card()).getByRole('button', { name: 'More Reject options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reject this with comment' }));
    expect(props.onDecide).toHaveBeenCalledWith('a', 'rejected');
    expect(props.onComment).toHaveBeenCalledWith('a', '');

    // With the comment in the state, the card shows it, focused.
    cleanup();
    const next = renderList(false, { comments: { a: '' } });
    const textbox = within(card()).getByRole('textbox', { name: 'Comment on change 1' });
    fireEvent.click(within(card()).getByRole('button', { name: 'More Reject options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reject this with comment' }));
    // An existing comment is kept.
    expect(next.onComment).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(textbox);
    fireEvent.change(textbox, { target: { value: 'Keep the old word.' } });
    expect(next.onComment).toHaveBeenCalledWith('a', 'Keep the old word.');
    fireEvent.click(textbox);
    expect(next.onSelect).not.toHaveBeenCalled();
    fireEvent.click(within(card()).getByRole('button', { name: 'Remove comment' }));
    expect(next.onComment).toHaveBeenCalledWith('a', null);
  });

  it('disables the bulk actions when nothing is undecided', () => {
    renderList(false, { totals: { ...totals, text: { total: 2, accepted: 1, rejected: 1, undecided: 0 } } });
    expect((screen.getByRole('button', { name: 'Accept all' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
