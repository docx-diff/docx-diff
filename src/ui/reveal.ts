// Scrolling both panels to a change (FR-28): each panel centres the first element of the change
// that it shows; a panel that shows none of it (e.g. the Original's panel for an insertion) is
// aligned with the other one by the scroll sync's anchor mapping.
import type { ScrollController } from './scrollSync';

function root(scroller: HTMLElement): ParentNode {
  return scroller.shadowRoot ?? scroller;
}

function isShown(element: Element): boolean {
  return element.getClientRects().length > 0;
}

/** The first element of the change that the panel shows, else the first shown paragraph it affects. */
export function firstShownElement(scroller: HTMLElement, itemId: string, anchors: readonly string[]): HTMLElement | null {
  const panel = root(scroller);
  for (const element of panel.querySelectorAll<HTMLElement>(`[data-change-id="${CSS.escape(itemId)}"]`)) {
    if (isShown(element)) return element;
  }
  for (const unid of anchors) {
    const block = panel.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(unid)}"]`);
    if (block && isShown(block)) return block;
  }
  return null;
}

/** The scroll position that puts the element in the middle of the panel. */
export function centredTop(scroller: HTMLElement, element: Element): number {
  const box = element.getBoundingClientRect();
  const offset = box.top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  return offset - (scroller.clientHeight - Math.min(box.height, scroller.clientHeight)) / 2;
}

export function revealItem(
  left: HTMLElement,
  right: HTMLElement,
  itemId: string,
  anchors: readonly string[],
  controller: ScrollController,
): void {
  const leftElement = firstShownElement(left, itemId, anchors);
  const rightElement = firstShownElement(right, itemId, anchors);
  if (leftElement) controller.scrollQuietly(left, centredTop(left, leftElement));
  if (rightElement) controller.scrollQuietly(right, centredTop(right, rightElement));
  if (leftElement && !rightElement) controller.align(left, right);
  if (rightElement && !leftElement) controller.align(right, left);
}

/** A box in the scroller's content coordinates (unchanged by scrolling). */
export interface ContentBox {
  top: number;
  bottom: number;
  left: number;
}

/** The last character before `element` that the panel shows, as a one-character box. */
function caretBefore(element: Element): DOMRect | null {
  const wrapper = element.closest('.doc');
  if (!wrapper) return null;
  const walker = element.ownerDocument.createTreeWalker(wrapper, NodeFilter.SHOW_TEXT);
  walker.currentNode = element;
  // A few text nodes back is enough: further away the paragraph is a better guess.
  for (let tries = 0, node = walker.previousNode(); node && tries < 20; tries++, node = walker.previousNode()) {
    const length = node.textContent?.length ?? 0;
    if (length === 0) continue;
    const range = element.ownerDocument.createRange();
    range.setStart(node, length - 1);
    range.setEnd(node, length);
    const rects = range.getClientRects();
    if (rects.length > 0) return rects[rects.length - 1]!;
  }
  return null;
}

/**
 * Where a change is in the panel (FR-28a): around the elements of it that the panel shows; for one it
 * shows none of (a deletion in the Edited's panel), the character before the hidden text; else its
 * first shown paragraph.
 */
export function changeBox(scroller: HTMLElement, itemId: string, anchors: readonly string[]): ContentBox | null {
  const elements = [...root(scroller).querySelectorAll<HTMLElement>(`[data-change-id="${CSS.escape(itemId)}"]`)];
  let rects = elements.flatMap((element) => [...element.getClientRects()]);
  if (rects.length === 0 && elements[0]) {
    const caret = caretBefore(elements[0]);
    if (caret) rects = [caret];
  }
  if (rects.length === 0) {
    const block = firstShownElement(scroller, itemId, anchors);
    if (block) rects = [...block.getClientRects()];
  }
  if (rects.length === 0) return null;
  const origin = scroller.getBoundingClientRect();
  const dy = scroller.scrollTop - origin.top;
  // A loop, not Math.min(...): a long change has more rects than a call takes arguments.
  let top = Infinity;
  let bottom = -Infinity;
  for (const rect of rects) {
    top = Math.min(top, rect.top);
    bottom = Math.max(bottom, rect.bottom);
  }
  return { top: top + dy, bottom: bottom + dy, left: rects[0]!.left - origin.left + scroller.scrollLeft };
}
