import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTENT_CHANGED, CommentBubbles, stackBoxes, type BubbleComment } from './CommentBubbles';
import { GAP } from './InlineChangeCard';
import type { ContentBox } from './reveal';

// jsdom has no layout: where each change is comes from here.
const changes = new Map<string, ContentBox>();
vi.mock('./reveal', () => ({ changeBox: (_scroller: HTMLElement, itemId: string) => changes.get(itemId) ?? null }));

const comments: BubbleComment[] = [
  { itemId: 'a', anchors: [], text: 'Keep this.\nAsk the author.' },
  { itemId: 'b', anchors: [], text: 'Fine.' },
];

type Props = Omit<Parameters<typeof CommentBubbles>[0], 'scrollerRef'>;

/** The bubbles as children of a scroller, as in the Resolved column. */
function Scroller(props: Props) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} data-testid="scroller">
      <CommentBubbles scrollerRef={ref} {...props} />
    </div>
  );
}

function renderBubbles(overrides: Partial<Props> = {}) {
  const props: Props = { comments, closed: new Set(), onClose: vi.fn(), ...overrides };
  const result = render(<Scroller {...props} />);
  return { props, rerender: (more: Partial<Props>) => result.rerender(<Scroller {...props} {...more} />) };
}

const bubble = (itemId: string) => screen.getAllByTestId('comment-bubble').find((element) => element.dataset.itemId === itemId);

describe('CommentBubbles', () => {
  afterEach(() => {
    cleanup();
    changes.clear();
  });

  it('shows every comment, open, below its change', () => {
    changes.set('a', { top: 10, bottom: 30, left: 100 });
    changes.set('b', { top: 200, bottom: 220, left: 50 });
    renderBubbles();
    expect(screen.getAllByRole('note')).toHaveLength(2);
    expect(bubble('a')!.textContent).toContain('Keep this.\nAsk the author.');
    expect(bubble('a')!.style.top).toBe(`${30 + GAP}px`);
    expect(bubble('b')!.style.top).toBe(`${220 + GAP}px`);
    expect(bubble('a')!.hasAttribute('data-placed')).toBe(true);
  });

  it('closes a bubble with its ×, and leaves out the closed ones', () => {
    const { props, rerender } = renderBubbles();
    fireEvent.click(screen.getAllByRole('button', { name: 'Hide comment' })[1]!);
    expect(props.onClose).toHaveBeenCalledWith('b');
    rerender({ closed: new Set(['b']) });
    expect(screen.getAllByTestId('comment-bubble').map((element) => element.dataset.itemId)).toEqual(['a']);
  });

  it('shows the comment as it is edited', () => {
    const { rerender } = renderBubbles();
    rerender({ comments: [{ ...comments[0]!, text: 'Changed my mind.' }, comments[1]!] });
    expect(bubble('a')!.textContent).toContain('Changed my mind.');
  });

  it('follows the text when the panel says it changed, and is not placed while its change is not shown', () => {
    changes.set('a', { top: 10, bottom: 30, left: 100 });
    renderBubbles();
    expect(bubble('b')!.hasAttribute('data-placed')).toBe(false);
    changes.set('a', { top: 60, bottom: 80, left: 100 });
    changes.set('b', { top: 300, bottom: 320, left: 50 });
    screen.getByTestId('scroller').dispatchEvent(new Event(CONTENT_CHANGED));
    expect(bubble('a')!.style.top).toBe(`${80 + GAP}px`);
    expect(bubble('b')!.hasAttribute('data-placed')).toBe(true);
  });

  it("starts below its comment icon's line, at the icon's left", () => {
    changes.set('a', { top: 10, bottom: 30, left: 100 });
    renderBubbles({ comments: [comments[0]!] });
    const scroller = screen.getByTestId('scroller');
    Object.defineProperty(scroller, 'clientWidth', { value: 600 });
    const root = scroller.attachShadow({ mode: 'open' });
    root.innerHTML = '<p style="line-height: 20px">Text<span class="comment-toggle" data-comment-for="a"></span></p>';
    const icon = root.querySelector('.comment-toggle')!;
    icon.getClientRects = () => [{ top: 100, bottom: 112, left: 200 }] as unknown as DOMRectList;
    scroller.dispatchEvent(new Event(CONTENT_CHANGED));
    expect(bubble('a')!.style.top).toBe(`${112 + 0.6 * 20}px`);
    expect(bubble('a')!.style.left).toBe('200px');
  });
});

describe('stackBoxes', () => {
  const box = (top: number, left = 0, width = 100, height = 50) => ({ top, left, width, height });

  it('pushes a bubble that would overlap an earlier one below it', () => {
    expect(stackBoxes([box(0), box(20)])).toEqual([0, 54]);
    // In any order; the one above stays.
    expect(stackBoxes([box(20), box(0)])).toEqual([54, 0]);
  });

  it('leaves bubbles side by side, or apart, where they are', () => {
    expect(stackBoxes([box(0), box(20, 150)])).toEqual([0, 20]);
    expect(stackBoxes([box(0), box(60)])).toEqual([0, 60]);
  });

  it('pushes a bubble down past every bubble it would overlap', () => {
    // b is pushed below a; c, under both, below b; d fits beside b, above c's new place, under a.
    expect(stackBoxes([box(0, 0, 200), box(10, 0, 100), box(20, 50, 100), box(30, 150, 40, 10)])).toEqual([0, 54, 108, 54]);
  });
});
