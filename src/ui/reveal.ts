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
