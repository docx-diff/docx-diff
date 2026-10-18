import { describe, expect, it } from 'vitest';
import type { ResolvedSide } from '../model/resolved';
import type { Decision } from '../model/decisions';
import {
  MARKER_SHOWN,
  RESOLVED_HIDDEN,
  applyCommentToggles,
  applyRangeOrder,
  applyResolution,
  applyResolvedDecisions,
  prepareResolvedPanel,
  resolvedText,
} from './resolvedView';

// Decorated redline HTML in the shapes of the fixtures (src/ui/resolvedView.ts): r a replacement
// with shared edges, i an insertion, d a deletion, j a removed paragraph mark (the next paragraph
// is a list item), s an inserted one (a split), m a move with edits of a whole paragraph, w and v a
// wholly deleted and a wholly inserted paragraph before a table, ri/rd an inserted/deleted row, n
// the deletion of a note with its reference.
const HTML = `<div data-section-index="0">
<p data-anchor="a">Kept <del data-change-id="r">old </del><del data-change-id="r" data-common-needs="ignoreQuotes" class="change-common">"x</del><ins data-change-id="r">new </ins><ins data-change-id="r" data-common-needs="ignoreQuotes" class="change-common">“x</ins> text.</p>
<p data-anchor="b">An <ins data-change-id="i">inserted</ins> word.</p>
<p data-anchor="c">A <del data-change-id="d">deleted</del> word.</p>
<p data-anchor="j1" class="rev-para-del" data-change-id="j">Joined <span class="rev-para-mark-del">¶</span></p>
<p data-anchor="j2"><span data-list-marker="true">1.</span>here.</p>
<p data-anchor="s1" class="rev-para-ins" data-change-id="s">Split </p>
<p data-anchor="s2">in two.</p>
<p data-anchor="m1" class="rev-para-del" data-change-id="m"><del class="rev-move-from" data-change-id="m">Moved old wording.</del><span class="rev-para-mark-del">¶</span></p>
<p data-anchor="x">Middle.</p>
<p data-anchor="m2" class="rev-para-ins" data-change-id="m"><ins class="rev-move-to" data-change-id="m">Moved new wording.</ins></p>
<p data-anchor="w" class="rev-para-del" data-change-id="w"><del data-change-id="w">Whole paragraph deleted.</del><span class="rev-para-mark-del">¶</span></p>
<p data-anchor="v" class="rev-para-ins" data-change-id="v"><ins data-change-id="v">Whole paragraph inserted.</ins></p>
<div align="left"><table data-anchor="t"><tbody>
<tr><td data-anchor="c1"><p data-anchor="t1">Time</p></td></tr>
<tr class="rev-row-ins" data-change-id="ri"><td data-anchor="c2"><p data-anchor="t2" class="rev-para-ins" data-change-id="ri"><ins data-change-id="ri">5:00</ins></p></td></tr>
<tr class="rev-row-del" data-change-id="rd"><td data-anchor="c3"><p data-anchor="t3" class="rev-para-del" data-change-id="rd"><del data-change-id="rd">8:00</del></p></td></tr>
</tbody></table></div>
<p data-anchor="f">Note<del data-change-id="n"><a href="#fn-2" id="fn-ref-2" class="footnote-ref"><sup>2</sup></a></del>.</p>
</div>
<section class="footnotes"><ol><li id="fn-2"><p data-anchor="n1" class="rev-para-del" data-change-id="n"><del data-change-id="n">A note.</del><a href="#fn-ref-2" class="fn-backref">↩</a></p></li></ol></section>`;

const ITEMS = ['r', 'i', 'd', 'j', 's', 'm', 'w', 'v', 'ri', 'rd', 'n'];

function panel(html = HTML) {
  const wrapper = new DOMParser().parseFromString(`<div class="doc">${html}</div>`, 'text/html').body.firstElementChild as HTMLElement;
  return prepareResolvedPanel(wrapper);
}

const all = (side: ResolvedSide, ids = ITEMS) => new Map(ids.map((id) => [id, side]));

/** The panel's DOM, without the empty class attributes that toggling a class leaves. */
const dom = (resolved: ReturnType<typeof panel>) => resolved.wrapper.innerHTML.replaceAll(' class=""', '');

describe('applyResolution', () => {
  it('shows the Edited text when everything is accepted', () => {
    const resolved = panel();
    applyResolution(resolved, all('accept'));
    expect(resolvedText(resolved.wrapper)).toEqual([
      'Kept new “x text.',
      'An inserted word.',
      'A word.',
      'Joined here.',
      'Split',
      'in two.',
      'Middle.',
      'Moved new wording.',
      'Whole paragraph inserted.',
      'Time',
      '5:00',
      'Note.',
    ]);
    const block = (unid: string) => resolved.wrapper.querySelector(`[data-anchor="${unid}"]`)!;
    // Joined after the list label; the emptied paragraph is marked.
    expect(block('j2').firstElementChild!.matches('[data-list-marker]')).toBe(true);
    expect(block('j1').className).toContain('merged-into-next');
    expect(resolved.wrapper.querySelector('tr.rev-row-del')!.classList.contains(RESOLVED_HIDDEN)).toBe(true);
    expect(resolved.wrapper.querySelector('li')!.classList.contains(RESOLVED_HIDDEN)).toBe(true);
  });

  it('shows the Original text when everything is rejected, never joining into a table', () => {
    const resolved = panel();
    applyResolution(resolved, all('reject'));
    expect(resolvedText(resolved.wrapper)).toEqual([
      'Kept old "x text.',
      'An word.',
      'A deleted word.',
      'Joined',
      'here.',
      'Split in two.',
      'Moved old wording.',
      'Middle.',
      'Whole paragraph deleted.',
      'Time',
      '8:00',
      'Note.',
      'A note.',
    ]);
    // v lost its mark, but a table follows: it stays a paragraph (with nothing shown).
    expect(resolved.wrapper.querySelector('[data-anchor="v"]')!.className).not.toContain('merged-into-next');
  });

  it('always hides the ¶ glyphs and never hides unchanged text', () => {
    const resolved = panel();
    applyResolution(resolved, all('reject'));
    expect([...resolved.wrapper.querySelectorAll('.rev-para-mark-del')].every((glyph) => glyph.classList.contains(RESOLVED_HIDDEN))).toBe(true);
    expect(resolved.wrapper.querySelectorAll(`.${RESOLVED_HIDDEN}:not([data-change-id], .rev-para-mark-del)`)).toHaveLength(0);
  });

  it('gives the same DOM after any sequence of changes as when applied at once', () => {
    const fresh = (sides: Map<string, ResolvedSide>) => {
      const resolved = panel();
      applyResolution(resolved, sides);
      return dom(resolved);
    };
    const resolved = panel();
    applyResolution(resolved, all('accept'));
    applyResolution(resolved, all('reject'), ITEMS);
    applyResolution(resolved, all('accept'), ITEMS);
    expect(dom(resolved)).toBe(fresh(all('accept')));
    for (const start of ['accept', 'reject'] as const) {
      const other = start === 'accept' ? 'reject' : 'accept';
      for (const id of ITEMS) {
        const resolved = panel();
        applyResolution(resolved, all(start));
        const flipped = new Map(all(start)).set(id, other);
        applyResolution(resolved, flipped, [id]);
        expect(dom(resolved), `${id} from ${start}`).toBe(fresh(flipped));
        applyResolution(resolved, all(start), [id]);
        expect(dom(resolved), `${id} back to ${start}`).toBe(fresh(all(start)));
      }
    }
  });

  it('shows a note referenced twice twice, and hides one no reference is left to', () => {
    // A reference moved: deleted at one place (o), inserted at another (p).
    const html = `<div data-section-index="0">
<p data-anchor="a">One<del data-change-id="o"><a href="#fn-1" class="footnote-ref"><sup>1</sup></a></del>.</p>
<p data-anchor="b">Two<ins data-change-id="p"><a href="#fn-1" class="footnote-ref"><sup>1</sup></a></ins>.</p>
</div>
<section class="footnotes"><ol><li id="fn-1"><p data-anchor="n">The note.<a href="#fn-ref-1" class="fn-backref">↩</a></p></li></ol></section>`;
    const resolved = panel(html);
    const text = (sides: [string, ResolvedSide][], changed?: string[]) => {
      applyResolution(resolved, new Map(sides), changed);
      return resolvedText(resolved.wrapper);
    };
    expect(text([['o', 'accept'], ['p', 'accept']])).toEqual(['One.', 'Two.', 'The note.']);
    expect(text([['o', 'reject'], ['p', 'accept']], ['o'])).toEqual(['One.', 'Two.', 'The note.', 'The note.']);
    expect(resolved.wrapper.querySelectorAll('[data-anchor="n"]')).toHaveLength(1);
    expect(text([['o', 'accept'], ['p', 'reject']], ['o', 'p'])).toEqual(['One.', 'Two.']);
    expect(text([['o', 'accept'], ['p', 'accept']], ['p'])).toEqual(['One.', 'Two.', 'The note.']);
  });
});

/** The shown markers, as `item:side`. */
const shownMarkers = (resolved: ReturnType<typeof panel>) =>
  [...resolved.wrapper.querySelectorAll<HTMLElement>(`.${MARKER_SHOWN}`)].map((marker) => `${marker.dataset.changeId}:${marker.dataset.for}`);

describe('markers', () => {
  it('follows the last deletion and the last insertion of each item, the note deletion in the body', () => {
    const resolved = panel();
    const markers = (id: string) => resolved.markers.get(id)!.map((marker) => `${marker.dataset.for} after ${marker.previousElementSibling?.localName ?? marker.parentElement!.localName}`);
    expect(markers('r')).toEqual(['del after del', 'ins after ins']);
    expect(markers('m')).toEqual(['del after del', 'ins after ins']);
    expect(markers('d')).toEqual(['del after del']);
    // In the body, after the reference.
    expect(resolved.markers.get('n')).toHaveLength(1);
    expect(resolved.markers.get('n')![0]!.closest('section')).toBeNull();
    // A row's after its table.
    expect(resolved.markers.get('ri')![0]!.previousElementSibling!.localName).toBe('table');
    expect(resolved.markers.has('j')).toBe(false);
  });

  it('is shown where a decision leaves no text, and at the end a move leaves', () => {
    const resolved = panel();
    applyResolution(resolved, all('accept'));
    expect(shownMarkers(resolved)).toEqual(['d:del', 'm:del', 'w:del', 'rd:del', 'n:del']);
    applyResolution(resolved, all('reject'), ITEMS);
    expect(shownMarkers(resolved)).toEqual(['i:ins', 'm:ins', 'v:ins', 'ri:ins']);
    // The marker of an accepted whole-paragraph deletion moves with the paragraph's content.
    applyResolution(resolved, new Map(all('reject')).set('w', 'accept'), ['w']);
    const marker = resolved.markers.get('w')![0]!;
    expect(marker.classList.contains(MARKER_SHOWN)).toBe(true);
    expect(marker.closest('[data-anchor]')!.getAttribute('data-anchor')).toBe('v');
  });

  it('adds no text', () => {
    const resolved = panel();
    applyResolution(resolved, all('accept'));
    expect(resolvedText(resolved.wrapper)).toContain('A word.');
  });
});

describe('applyResolvedDecisions', () => {
  const ends = (resolved: ReturnType<typeof panel>) =>
    [...resolved.wrapper.querySelectorAll<HTMLElement>('.change-decided-end')].map((element) =>
      `${element.dataset.changeId}:${element.classList.contains('resolved-marker') ? 'marker' : element.localName}`,
    );

  it('marks decided items, with the ✓/✗ on the last shown element and on shown markers', () => {
    const resolved = panel();
    const decisions: Record<string, Decision> = { r: 'accepted', d: 'accepted', i: 'rejected', m: 'rejected' };
    applyResolution(resolved, new Map([['i', 'reject'], ['m', 'reject']]));
    applyResolvedDecisions(resolved, decisions);
    expect(ends(resolved)).toEqual(['r:ins', 'i:marker', 'd:marker', 'm:del', 'm:marker']);
    expect([...resolved.wrapper.querySelectorAll('[data-change-id="r"]')].every((element) => element.classList.contains('change-accepted'))).toBe(true);
    expect(resolved.wrapper.querySelectorAll('.change-accepted:not([data-change-id="r"], [data-change-id="d"])')).toHaveLength(0);
  });

  it('moves the ✓/✗ when the resolved side changes, and drops it with the decision', () => {
    const resolved = panel();
    applyResolution(resolved, all('accept'));
    applyResolvedDecisions(resolved, { d: 'accepted' }, ['d']);
    expect(ends(resolved)).toEqual(['d:marker']);
    applyResolution(resolved, new Map(all('accept')).set('d', 'reject'), ['d']);
    applyResolvedDecisions(resolved, { d: 'rejected' }, ['d']);
    expect(ends(resolved)).toEqual(['d:del']);
    expect(shownMarkers(resolved)).not.toContain('d:del');
    applyResolvedDecisions(resolved, {}, ['d']);
    expect(ends(resolved)).toEqual([]);
    expect(resolved.wrapper.querySelectorAll('.change-rejected')).toHaveLength(0);
  });
});

describe('applyCommentToggles', () => {
  const toggle = (resolved: ReturnType<typeof panel>, id: string) => resolved.wrapper.querySelector<HTMLElement>(`.comment-toggle[data-comment-for="${id}"]`);
  /** What the icon follows: the element's item and kind, or the text before it. */
  const before = (resolved: ReturnType<typeof panel>, id: string) => {
    const previous = toggle(resolved, id)!.previousSibling as HTMLElement;
    if (previous.nodeType === 3) return `text:${previous.textContent}`;
    return `${previous.dataset.changeId ?? ''}:${previous.classList.contains('resolved-marker') ? 'marker' : previous.localName}${previous.classList.contains('change-decided-end') ? ' ✓' : ''}`;
  };

  it('puts the icon after the ✓/✗ of the text shown, or after a shown marker', () => {
    const resolved = panel();
    applyResolution(resolved, new Map([['i', 'reject']]));
    applyResolvedDecisions(resolved, { r: 'accepted', i: 'rejected' });
    applyCommentToggles(resolved, new Map([['r', true], ['i', false], ['d', true], ['m', true]]));
    expect(before(resolved, 'r')).toBe('r:ins ✓');
    expect(before(resolved, 'i')).toBe('i:marker ✓');
    // Undecided: an accepted deletion's dotted placeholder; a move's destination (after its source's marker).
    expect(before(resolved, 'd')).toBe('d:marker');
    expect(before(resolved, 'm')).toBe('m:ins');
    expect(toggle(resolved, 'i')!.getAttribute('aria-expanded')).toBe('false');
    expect(toggle(resolved, 'i')!.title).toBe('Show comment');
    expect(toggle(resolved, 'r')!.getAttribute('aria-label')).toBe('Hide comment');
  });

  it("follows a paragraph mark's text into the next paragraph and back", () => {
    const resolved = panel();
    applyResolution(resolved, all('accept'));
    applyCommentToggles(resolved, new Map([['j', true]]));
    const icon = toggle(resolved, 'j')!;
    expect(icon.parentElement!.dataset.anchor).toBe('j2');
    expect(icon.previousElementSibling!.className).toContain('rev-para-mark-del');
    applyResolution(resolved, new Map(all('accept')).set('j', 'reject'), ['j']);
    applyCommentToggles(resolved, new Map([['j', true]]));
    expect(toggle(resolved, 'j')).toBe(icon);
    expect(icon.parentElement!.dataset.anchor).toBe('j1');
    expect(icon.parentElement!.lastChild).toBe(icon);
    expect(resolvedText(resolved.wrapper).slice(3, 5)).toEqual(['Joined', 'here.']);
  });

  it('comes back after a join is undone around it, and goes with its comment', () => {
    const resolved = panel();
    applyResolution(resolved, all('accept'));
    // The deleted word's marker is in a paragraph that a join moves.
    applyCommentToggles(resolved, new Map([['w', true]]));
    expect(before(resolved, 'w')).toBe('w:marker');
    applyResolution(resolved, new Map(all('accept')).set('v', 'reject'), ['v']);
    applyCommentToggles(resolved, new Map([['w', true]]));
    expect(before(resolved, 'w')).toBe('w:marker');
    applyCommentToggles(resolved, new Map());
    expect(resolved.wrapper.querySelectorAll('.comment-toggle')).toHaveLength(0);
  });

  it('adds no text', () => {
    const resolved = panel();
    applyResolution(resolved, all('reject'));
    const text = resolvedText(resolved.wrapper);
    applyCommentToggles(resolved, new Map(ITEMS.map((id) => [id, true])));
    expect(resolvedText(resolved.wrapper)).toEqual(text);
    expect(resolved.wrapper.querySelectorAll('.comment-toggle')).toHaveLength(ITEMS.length);
  });
});

describe('applyRangeOrder', () => {
  // A deleted tail (t1, t2) outside the range, with the Edited's closing paragraph (d, whose mark
  // the tail's revision inserted) and a move destination (g) placed after it by the engine.
  const html = `<div data-section-index="0">
<p data-anchor="a">In range.</p>
<p data-anchor="t1" class="rev-para-del" data-change-id="tail"><del data-change-id="tail">Tail one.</del></p>
<p data-anchor="t2" class="rev-para-del" data-change-id="tail"><del data-change-id="tail">Tail two.</del></p>
<p data-anchor="d" class="rev-para-ins" data-change-id="tail"><ins data-change-id="e">Closing.</ins></p>
<p data-anchor="g" class="rev-para-ins" data-change-id="g"><ins class="rev-move-to" data-change-id="g">Moved here.</ins></p>
</div>`;
  const positions = new Map([
    ['a', 0],
    ['t1', 1],
    ['t2', 2],
    ['d', 0.5],
    ['g', 0.5],
  ]);
  const order = (resolved: ReturnType<typeof panel>) =>
    [...resolved.wrapper.querySelectorAll<HTMLElement>('[data-section-index] > *')].map((element) => element.dataset.anchor ?? element.className);
  const sides = (e: ResolvedSide) => new Map<string, ResolvedSide>([['tail', 'reject'], ['e', e], ['g', 'accept']]);

  it('moves the in-range blocks after the region outside to before it, and back', () => {
    const resolved = panel(html);
    applyResolution(resolved, sides('accept'));
    const before = dom(resolved);
    applyRangeOrder(resolved, positions, 1, new Set(['tail']));
    expect(order(resolved)).toEqual(['a', 'd', 'g', 't1', 't2']);
    expect(resolvedText(resolved.wrapper)).toEqual(['In range.', 'Closing.', 'Moved here.', 'Tail one.', 'Tail two.']);
    applyRangeOrder(resolved, positions, null, new Set());
    expect(dom(resolved)).toBe(before);
  });

  it('keeps the mark of a moved paragraph when all its in-range changes are accepted', () => {
    const resolved = panel(html);
    applyRangeOrder(resolved, positions, 1, new Set(['tail']));
    applyResolution(resolved, sides('accept'));
    applyResolution(resolved, sides('reject'), ['e']);
    expect(resolvedText(resolved.wrapper)).toEqual(['In range.', 'Moved here.', 'Tail one.', 'Tail two.']);
    expect(resolved.wrapper.querySelector('[data-anchor="d"]')!.className).toContain('merged-into-next');
    applyResolution(resolved, sides('accept'), ['e']);
    expect(resolvedText(resolved.wrapper)).toEqual(['In range.', 'Closing.', 'Moved here.', 'Tail one.', 'Tail two.']);
  });

  it('puts the moved blocks before the range divider', () => {
    const resolved = panel(html);
    const divider = resolved.wrapper.ownerDocument.createElement('div');
    divider.className = 'range-divider';
    resolved.wrapper.querySelector('[data-anchor="t1"]')!.before(divider);
    applyRangeOrder(resolved, positions, 1, new Set(['tail']));
    expect(order(resolved)).toEqual(['a', 'd', 'g', 'range-divider', 't1', 't2']);
  });
});
