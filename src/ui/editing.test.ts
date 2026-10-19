import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { OBJECT_CHAR } from '../model/paragraphEdit';
import type { UneditableReason } from './blockSegments';
import { EDIT_MESSAGES, PanelEditing, UPDATE_DELAY_MS, deletedSpan, plainText, type EditingOptions } from './editing';

describe('plainText', () => {
  it('turns line breaks and tabs into spaces and drops other control characters and object placeholders', () => {
    expect(plainText('one\r\ntwo\nthree\tfour\u2028five')).toBe('one two three four five');
    expect(plainText(`a\u0000b${OBJECT_CHAR}c\u007f`)).toBe('abc');
    expect(plainText('őű “x”')).toBe('őű “x”');
  });
});

describe('deletedSpan', () => {
  const text = `one two${OBJECT_CHAR} three`;

  it('gives the character or word a delete removes', () => {
    expect(deletedSpan(text, 3, 'deleteContentBackward')).toEqual([2, 3]);
    expect(deletedSpan(text, 3, 'deleteContentForward')).toEqual([3, 4]);
    expect(deletedSpan(text, 8, 'deleteContentBackward')).toEqual([7, 8]);
    expect(deletedSpan(text, 7, 'deleteWordBackward')).toEqual([4, 7]);
    expect(deletedSpan(text, 4, 'deleteWordBackward')).toEqual([0, 4]);
    expect(deletedSpan(text, 0, 'deleteWordForward')).toEqual([0, 3]);
    expect(deletedSpan(text, 9, 'deleteSoftLineBackward')).toEqual([0, 9]);
    expect(deletedSpan('a😀b', 3, 'deleteContentBackward')).toEqual([1, 3]);
    expect(deletedSpan('a😀b', 1, 'deleteContentForward')).toEqual([1, 3]);
  });

  it('gives null when the delete would join paragraphs', () => {
    expect(deletedSpan(text, 0, 'deleteContentBackward')).toBeNull();
    expect(deletedSpan(text, text.length, 'deleteContentForward')).toBeNull();
    expect(deletedSpan('', 0, 'deleteWordForward')).toBeNull();
  });
});

describe('PanelEditing', () => {
  let host: HTMLDivElement;
  let root: ShadowRoot;
  let wrapper: HTMLDivElement;
  let editing: PanelEditing;
  let reasons: Record<string, UneditableReason | undefined>;
  let options: EditingOptions & { onEdit: Mock<EditingOptions['onEdit']>; onMessage: Mock<EditingOptions['onMessage']> };
  const block = (unid: string) => wrapper.querySelector<HTMLElement>(`[data-anchor="${unid}"]`)!;
  const fire = (target: Element, event: Event) => {
    target.dispatchEvent(event);
    return event;
  };
  const beforeInput = (target: Element, inputType: string) =>
    fire(target, new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true, composed: true }));
  /** Text typed at the end of the block's last text node, then its `input` event. */
  const type = (unid: string, text: string, init: InputEventInit = {}) => {
    const node = block(unid).querySelector('span')!.firstChild as Text;
    node.data += text;
    fire(block(unid), new InputEvent('input', { inputType: 'insertText', data: text, bubbles: true, composed: true, ...init }));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    host.tabIndex = 0;
    document.body.append(host);
    root = host.attachShadow({ mode: 'open' });
    wrapper = document.createElement('div');
    wrapper.className = 'doc';
    wrapper.innerHTML =
      '<p data-anchor="a"><span>Kept </span><ins data-author="rev:r2" data-change-id="r2">new</ins><span> text</span><a class="footnote-ref" data-footnote-id="3" href="#fn-3"><sup>1</sup></a></p>' +
      '<p data-anchor="b" class="rev-para-ins"><span>Added</span></p>' +
      '<table data-anchor="t"><tr><td><p data-anchor="c"><span>Cell</span></p></td></tr></table>';
    root.append(wrapper);
    reasons = { b: 'move', t: 'not-a-paragraph' };
    options = {
      reasonOf: (unid) => reasons[unid],
      textOf: (unid) => ({ a: `Kept new text${OBJECT_CHAR}`, c: 'Cell' })[unid] ?? '',
      onEdit: vi.fn<EditingOptions['onEdit']>(() => 'updated'),
      onMessage: vi.fn<EditingOptions['onMessage']>(),
    };
    editing = new PanelEditing(root, wrapper, () => options, block);
    editing.attach();
  });

  afterEach(() => {
    editing.detach(false);
    host.remove();
    vi.useRealTimers();
  });

  it('makes only the editable paragraphs editable, objects inside them not, and undoes it when detached', () => {
    expect(wrapper.classList.contains('doc--editing')).toBe(true);
    expect(block('a').getAttribute('contenteditable')).toBe('true');
    expect(block('a').getAttribute('spellcheck')).toBe('false');
    expect(block('a').querySelector('.footnote-ref')!.getAttribute('contenteditable')).toBe('false');
    expect(block('c').getAttribute('contenteditable')).toBe('true');
    expect(block('b').hasAttribute('contenteditable')).toBe(false);
    expect(block('t').hasAttribute('contenteditable')).toBe(false);

    reasons.a = 'out-of-range';
    editing.refresh();
    expect(block('a').hasAttribute('contenteditable')).toBe(false);
    expect(block('a').querySelector('[contenteditable]')).toBeNull();
    reasons.a = undefined;
    editing.refresh();
    editing.detach(false);
    expect(wrapper.querySelector('[contenteditable], [spellcheck]')).toBeNull();
    expect(wrapper.classList.contains('doc--editing')).toBe(false);
    editing.attach();
  });

  it('prepares a block put in by an update', () => {
    const replacement = block('a').cloneNode(true) as HTMLElement;
    for (const element of [replacement, ...replacement.querySelectorAll('[contenteditable]')]) element.removeAttribute('contenteditable');
    block('a').replaceWith(replacement);
    editing.prepareBlock(replacement);
    expect(replacement.getAttribute('contenteditable')).toBe('true');
    expect(replacement.querySelector('.footnote-ref')!.getAttribute('contenteditable')).toBe('false');
  });

  it('blocks paragraph breaks with a message, and the browser’s undo, formatting and drops silently', () => {
    expect(beforeInput(block('a'), 'insertParagraph').defaultPrevented).toBe(true);
    expect(beforeInput(block('a'), 'insertLineBreak').defaultPrevented).toBe(true);
    expect(options.onMessage.mock.calls).toEqual([[EDIT_MESSAGES.paragraphBreak], [EDIT_MESSAGES.paragraphBreak]]);
    for (const inputType of ['historyUndo', 'historyRedo', 'formatBold', 'formatItalic', 'insertFromDrop', 'deleteByDrag', 'insertFromPaste']) {
      expect(beforeInput(block('a'), inputType).defaultPrevented).toBe(true);
    }
    expect(options.onMessage).toHaveBeenCalledTimes(2);
    expect(fire(block('a'), new Event('dragstart', { bubbles: true, cancelable: true, composed: true })).defaultPrevented).toBe(true);
    // Input into a block that isn't editable never happens.
    expect(beforeInput(block('b'), 'insertText').defaultPrevented).toBe(true);
  });

  it('says once that there is no undo when Ctrl+Z is pressed in an editable paragraph', () => {
    const key = (target: Element, init: KeyboardEventInit) => fire(target, new KeyboardEvent('keydown', { bubbles: true, composed: true, cancelable: true, ...init }));
    key(block('b'), { key: 'z', ctrlKey: true });
    expect(options.onMessage).not.toHaveBeenCalled();
    key(block('a'), { key: 'z', ctrlKey: true, shiftKey: true });
    key(block('a'), { key: 'y', ctrlKey: true });
    expect(options.onMessage).not.toHaveBeenCalled();
    key(block('a'), { key: 'z', ctrlKey: true });
    key(block('c'), { key: 'Z', metaKey: true });
    expect(options.onMessage.mock.calls).toEqual([[EDIT_MESSAGES.noUndo]]);
    expect(EDIT_MESSAGES.noUndo).toBe('Undo isn’t available here: use ↺ to revert your edits.');
  });

  it('says why a clicked paragraph can’t be edited', () => {
    const click = (target: Element) => {
      const event = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(event, 'target', { value: target });
      editing.click(event);
    };
    click(block('a').querySelector('ins')!);
    click(block('t').querySelector('td')!);
    expect(options.onMessage).not.toHaveBeenCalled();
    click(block('b').querySelector('span')!);
    expect(options.onMessage).toHaveBeenCalledWith('This paragraph can’t be edited here: it contains a moved passage.');
  });

  it('updates the block 300 ms after the last input, with its visible text', () => {
    type('a', 'X');
    vi.advanceTimersByTime(UPDATE_DELAY_MS - 1);
    type('a', 'Y');
    vi.advanceTimersByTime(UPDATE_DELAY_MS - 1);
    expect(options.onEdit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(options.onEdit).toHaveBeenCalledExactlyOnceWith('a', `Kept XYnew text${OBJECT_CHAR}`, undefined);
  });

  it('waits for a composition to end, then 300 ms', () => {
    fire(block('c'), new CompositionEvent('compositionstart', { bubbles: true, composed: true }));
    type('c', '˝', { inputType: 'insertCompositionText', isComposing: true });
    vi.advanceTimersByTime(2 * UPDATE_DELAY_MS);
    expect(options.onEdit).not.toHaveBeenCalled();
    fire(block('c'), new CompositionEvent('compositionend', { bubbles: true, composed: true }));
    vi.advanceTimersByTime(UPDATE_DELAY_MS - 1);
    expect(options.onEdit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(options.onEdit).toHaveBeenCalledExactlyOnceWith('c', 'Cell˝', undefined);
  });

  it('updates at once when the text loses focus, on Escape, and when detached (unless the review changed)', () => {
    type('c', '1');
    fire(block('c'), new FocusEvent('focusout', { bubbles: true, composed: true }));
    expect(options.onEdit).toHaveBeenLastCalledWith('c', 'Cell1', undefined);

    type('c', '2');
    const escape = fire(block('c'), new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, composed: true }));
    expect(escape.defaultPrevented).toBe(true);
    expect(options.onEdit).toHaveBeenLastCalledWith('c', 'Cell12', undefined);
    expect(document.activeElement).toBe(host);

    type('c', '3');
    editing.detach(true);
    expect(options.onEdit).toHaveBeenLastCalledWith('c', 'Cell123', undefined);
    editing.attach();
    type('c', '4');
    editing.detach(false);
    vi.advanceTimersByTime(UPDATE_DELAY_MS);
    expect(options.onEdit).toHaveBeenCalledTimes(3);
    editing.attach();
  });

  it('says so when the update refuses the edit', () => {
    options.onEdit.mockReturnValue('refused');
    type('c', '!');
    vi.advanceTimersByTime(UPDATE_DELAY_MS);
    expect(options.onMessage).toHaveBeenCalledWith(EDIT_MESSAGES.object);
  });
});
