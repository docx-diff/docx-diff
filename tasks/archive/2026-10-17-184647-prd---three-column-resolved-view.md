# PRD: Three-column view with the resolved text

## 1. Introduction / overview

Today the review screen shows two document panels: the **Original** (left) and the **Edited**
(right), with the changes highlighted, plus an outline sidebar on the left and the changes list on
the right (`docs/requirements.md`, FR-20 … FR-36). To see what the exported document will say, the
reviewer has to piece it together in their head from the two panels and the ✓/✗ marks.

This feature adds a third document column **in the middle**, between the Original and the Edited:
the **Resolved** column. It shows the document as the export would produce it, with every
accept/reject decision applied. Decided changes are highlighted in light yellow with their ✓/✗ icon.
Reviewer comments are shown as bubbles under their change. A toolbar icon switches between the
two-column and three-column views. Three columns is the default, with both sidebars collapsed, so
the three documents get the width.

To keep yellow meaning "resolved change", the formatting group in the changes list changes its
background from yellow to light gray.

**Goal:** the reviewer can read the result of their decisions while reviewing, and decide changes
from that result, without exporting first.

## 2. Goals

1. The middle column shows the same text the export would produce for the current decisions, with
   undecided changes treated as accepted (the export dialog's default). Checked by automated tests
   on the fixtures and the sample pair (see §8).
2. The middle column shows the right **text**. Its formatting is the Edited panel's, whatever the
   formatting choice (FR-30). The export stays the authority on formatting.
3. Every change shown in the middle column can be selected and decided there, the same way as in the
   side panels (click, keyboard `a`/`r`/`A`/`R`/`u`).
4. Every non-blank reviewer comment is readable in the middle column without selecting its change.
5. The middle column stays in sync with the other two when scrolling or deciding a change. It does
   not freeze the page on the ~60-page sample.
6. The two-column view keeps working as it does now.

## 3. User stories

- As a reviewer, I want to see the resolved text next to the Original and the Edited, so I can check
  that my decisions give the sentence I want.
- As a reviewer, I want decided changes in the resolved text highlighted with ✓/✗, so I can tell
  which parts of the result come from my decisions and which I still have to decide.
- As a reviewer, I want to click a change in the resolved text and accept or reject it there, so I
  don't have to find it in a side panel first.
- As a reviewer, I want all my comments shown under their changes in the resolved text, so I can
  re-read my notes in context, and close the ones in my way.
- As a reviewer with a small screen, I want to switch back to two columns, so each document gets
  more width.
- As a first-time user, I want the three-column view with the sidebars out of the way, so the three
  documents are readable without any setup.

## 4. Functional requirements

### Layout and the view toggle

1. The review screen must offer two views:
   - **Three columns:** Original | Resolved | Edited, in this order.
   - **Two columns:** Original | Edited, exactly as today.
2. The top bar must have an icon button that switches between the two views, next to the light/dark
   toggle (FR-25a). Its tooltip and accessible name say what clicking does ("Show two columns" /
   "Show three columns"), and it uses `aria-pressed` for the three-column state.
3. The chosen view must be remembered in this browser (with the other view settings in
   `src/ui/useViewSettings.ts`). It is **not** part of a saved review (FR-46).
4. On the first visit (nothing stored in this browser yet), the defaults must be: three columns, the
   outline sidebar (FR-24a) **collapsed**, the changes list (FR-26b) **collapsed**. After that,
   the browser remembers the user's last choice for the view and for each sidebar, as it already
   does for the sidebars. Note: a browser that already stored sidebar settings keeps them. Only the
   new view setting starts at its default (three columns).
5. When the window is **1024 CSS px wide or narrower** (iPads in portrait, the base iPad in
   landscape), the app must show two columns, whatever the stored choice (decided 2026-10-17). The toggle is then
   disabled, with a tooltip saying the window is too narrow for three columns. The stored choice is
   left unchanged, so the three columns come back when the window is widened again.

### Content of the Resolved column

6. The Resolved column must show the document as the export would produce it, using the current
   decisions (FR-39, FR-40, FR-45):
   - An **accepted** change shows the Edited's version of that change.
   - A **rejected** change shows the Original's version.
   - An **undecided** change shows the Edited's version (the export dialog's default, FR-38).
   - A **replacement** shows only the inserted text when accepted (or undecided), and only the
     deleted text when rejected.
   - A **move**: accepted (or undecided), its text appears at the destination only, in the
     `w:moveTo` (Edited) wording. Rejected, it appears at the source only, in the `w:moveFrom`
     (Original) wording.
   - A **table row** insertion or deletion shows the row or not, by the same rules.
   - **Footnotes and endnotes** follow the same rules, shown at the end as in the side panels
     (FR-20). A note only one version has appears or disappears with the change to its reference
     (`foldWholeNotes`).
   - **Order around the out-of-range tail:** in-range content that the engine placed *after* the
     out-of-range region (on the sample: the two move destinations and the Edited's closing
     paragraph) is shown *before* the divider, as the export places it (`planRangeOrder`,
     `src/engine/rangeOrder.ts`). Without this the middle column would show them after the
     Original's tail.
7. Changes the list does not offer for decision must appear as the export resolves them, **with no
   mark**: changes ignored by the compare settings, insertions/deletions relabelled as formatting
   (FR-13b), the shared edges of a replacement (`change-common`), and out-of-range changes.
8. The **out-of-range tail** (FR-17, FR-18) must appear as in the left panel: the Original's text
   after the end point, greyed, after the same divider.
9. The Resolved column must render with the **same formatting as the redline HTML** the side panels
   show: the Edited's formatting wherever a formatting revision exists, and each piece of text's own
   formatting otherwise (a restored deletion keeps the Original's run formatting, as the left panel
   shows it). It does **not** follow the formatting choice (FR-30), and it does not apply FR-39a
   (kept text taking its neighbours' formatting). Changing the formatting choice changes nothing in
   the column. The middle column is a text preview, and the export decides the formatting. A short
   note in the column's header tooltip says so ("Shows the resolved text; formatting as in the
   Edited document").
10. The Resolved column must update immediately after every decision, including bulk decisions
    (Accept all / Reject all, "until here" `A`/`R`, FR-27a/FR-32). The scroll position must not
    jump when text above the viewport appears or disappears.

### Marks in the Resolved column

11. Every **decided** change (accepted or rejected) that is offered for decision must have a **light
    yellow background**, the colour the formatting group uses now (`--warning-bg`: `#fff8c5` light,
    `#2b2111` dark). It is the only mark in this column. No red/blue/purple, no strike-through or
    underline, and **no dimming** (the side panels dim decided changes; the middle column shows
    the result, so it is shown at full strength).
12. After the last piece of a decided change, the Resolved column must show the same **✓** (accepted,
    `--success`) or **✗** (rejected, `--danger`) icon the side panels show (FR-25, `panel.css`).
13. A decision that leaves **no text** in the result (an accepted deletion, a rejected insertion, a
    rejected move's destination, an accepted move's source) must still leave a **marker** where the
    text was: its ✓/✗ icon on the yellow background. The marker can be clicked and selected like a
    fragment (requirement 16), and the current-change outline goes around it. For a move, the marker
    appears only at the side the decision removed **from the reader's current position**, i.e. at
    the source of an accepted move and at the destination of a rejected one. (The moved text itself
    is marked at the other side.)
14. An **undecided** change must have a faint "pending" mark: a dotted underline in `--muted`, no
    background, no icon. An undecided deletion (which shows no text, since undecided means
    accepted) gets a small dotted placeholder marker, so it can still be clicked.
15. Colours must work in light and dark mode (FR-25a), and never by colour alone: the ✓/✗ icons and
    the dotted underline carry the meaning too.

### Selection and decisions

16. Clicking a change (or its marker) in the Resolved column must select its item, exactly like
    clicking one in a side panel (FR-29): it becomes current and the list (if expanded) scrolls to
    it. As with a click in a side panel, the clicked column does not scroll, and the others stay
    aligned through the scroll sync. Selecting from the list, the keyboard or Previous/Next scrolls
    **all three** columns to the change (FR-28).
17. The current change must have the same outline in the Resolved column as in the side panels
    (`change-current`, FR-28).
18. Keyboard shortcuts (FR-34) and Previous/Next (FR-31, FR-33) must work the same in both views.
    After a decision the selection moves on as it does now.
19. The current change's **card** (FR-28a) stays in the **Edited panel** only, in both views. The
    Resolved column never shows the card.

### Comments in the Resolved column

20. For every item with a non-blank comment (FR-27b), the Resolved column must show the comment
    text in a **bubble** under its change (or under its marker, requirement 13), **without the change
    being selected**. All bubbles are open when the review is shown.
21. The bubble shows only the reviewer's comment text (not the "Accepted: Changed from … to …"
    wrapper the export writes). It is **read-only**; comments are still written and edited in the
    card (FR-27b).
22. Each bubble must have an **×** in its corner that closes it.
23. After the change (after its ✓/✗ icon, if any) there must be a small **comment icon** (speech
    bubble). Clicking it opens the bubble again if it is closed, and closes it if it is open.
    Clicking the icon does not select the change. It has a tooltip ("Show comment" / "Hide
    comment") and an accessible name.
24. Which bubbles are closed is **not remembered**: after a reload, or on resuming a review, all
    bubbles are open again.
25. Adding, editing or removing a comment in the card must update the bubble right away. A new
    comment's bubble opens. A removed (or blanked) comment removes both its bubble and its icon.
26. Bubbles float over the text below (like the inline card, FR-28a, with a gap so the next line
    stays readable) and scroll with the text. Two bubbles that would overlap must not hide each
    other: the later one is pushed down below the earlier.
27. Comments on out-of-range items are not shown (the export ignores them).

### Colour change in the changes list

28. The **formatting group** in the changes list (`.formatting-group`, FR-30) must use a **light
    gray** background instead of yellow, in light and dark mode (for example `--surface` or a new
    token; it must stay distinguishable from the list background).
    28a. The **left edge of formatting cards** (`.change-card--formatting`, now `--warning`) must
    become gray too (e.g. `--divider`), so that the changes list has no yellow left. Yellow then means
    only "resolved change".

### Legend

28b. The legend in the top bar (`Legend.tsx`, FR-21) must get two more entries, shown only in
    three-column view: **Decided** (a sample on the yellow background with a ✓) and **Undecided**
    (a sample with the dotted underline). The tooltip of each says it applies to the Resolved column.
    In two-column view the legend stays as it is now (Deleted, Inserted, Moved).

### Scrolling and the outline

29. In three-column view, the scroll sync (FR-22) must keep the matching paragraph aligned in **all
    three** columns, whichever column is scrolled. Scroll lock off (FR-23) lets each column scroll
    on its own.
30. Clicking a heading in the outline (FR-24a) must scroll **all three** columns to it.
31. The Resolved column has no overview bar of its own (FR-24). The side panels keep theirs.

### Requirements doc

32. When the feature is built, `docs/requirements.md` must be updated with sub-items that keep the
    existing numbers stable (e.g. FR-25b for the Resolved column and its marks, FR-25c for the view
    toggle and its defaults, FR-27c for comment bubbles), the **Design** section's layout
    description, and the colour list. The changed sidebar defaults update FR-24a and FR-26b.
    `docs/architecture.md` gets a section on how the Resolved column is rendered.

## 5. Non-goals (out of scope)

- Editing text in the Resolved column, or editing comments in the bubbles.
- Showing the current change's card in the Resolved column.
- Remembering closed bubbles, or making the view setting part of a saved review.
- An overview bar for the Resolved column.
- Changing how the side panels look (other than following scroll sync with three columns), or
  marking formatting changes in any panel (FR-21 stays as it is).
- A layout designed for phones or touch input. At 1024 px or narrower the app simply uses two
  columns.
- A different column order, or more than three columns.
- Changes to the export itself.
- Previewing formatting in the Resolved column: it does not follow the formatting choice (FR-30) or
  FR-39a (requirement 9; open question 1).

## 6. Design considerations

- **Column widths:** the three columns share the width equally. The side panels keep their overview
  bars. With both sidebars collapsed, each column at the narrowest three-column width (~1080 px, an
  iPad in landscape) gets roughly 330 px of text width, so the panels' horizontal padding
  (`.doc { padding: 1.5rem 2rem }` in `panel.css`) may need to shrink in three-column view. The
  documents' `max-width: 48rem` stays as a maximum.
- **Column header:** each column has a small label like the existing ones, the middle one reading
  "Resolved" (or "Result").
- **Toggle icon:** a "columns" icon (two vs three vertical bars), drawn like the existing top-bar
  icons. It shows the view that clicking switches **to**, matching the tooltip.
- **Yellow:** after this change, yellow (`--warning-bg`) means "resolved change in the middle
  column". The formatting group and the formatting cards' left edge become gray (requirements 28,
  28a). The only other use of the warning tokens, the range bar's warning text
  (`.range-control__spanning`, `--warning-fg`), keeps its colour: it is a message, not a change mark.
- **Bubble:** styled like a small card (`--raised` background, `--border`, shadow), max ~20 rem
  wide, comment text at the panel's UI font size, × in the top-right corner. Like the inline card,
  it is placed below the change with a gap.
- **Comment icon:** small, `--muted`, inline after the change. It must not change the line height.
- **Pending mark** (undecided): subtle enough that a mostly undecided document does not look busy.

## 7. Technical considerations

- **Rendering idea:** all panels show the same redline HTML (`renderedDocument.ts`), and each side
  panel hides what its version lacks with CSS (`.doc[data-side='left'] ins { display: none }` …).
  The Resolved column can be a third shadow-root panel over the same HTML with
  `data-side='resolved'`. It hides per change, from the decision: `del` of accepted/undecided
  changes and `ins` of rejected ones. A per-change class on the elements, or a generated stylesheet
  keyed by `data-change-id`, is needed. The current panels already get `change-accepted` /
  `change-rejected` classes. Moves, paragraph-mark revisions (`p.rev-para-ins`/`rev-para-del`, joined
  paragraphs `merged-into-next`), table rows (`tr.rev-row-ins/del`) and notes need the same per-
  decision treatment the side panels apply per side. Paragraph-mark revisions put `data-change-id`
  on the **block** (see CLAUDE.md), so selectors must target `:is(ins, del)` where only the inline
  text is meant.
- **Why the formatting choice is not followed (requirement 9):** the converter renders formatting
  revisions with the **new** (Edited) properties only, so the existing HTML cannot show the
  Original's formatting. Following the choice would need a second HTML rendered from a redline with
  the formatting revisions rejected. Rewriting `w:rPr` children changes the `data-anchor` unids
  (they hash descendant element names), which would break the range and scroll-sync logic. That
  was judged not worth it for now. The middle column therefore reuses the one HTML the side panels
  already show, and no new engine call or second render is needed. Approaches for a later version
  are recorded in open question 1.
- **What the rendered HTML looks like** (checked on the fixtures, 2026-10-17):
  - Every `ins`/`del` (also `rev-move-from`/`rev-move-to`) carries its item's `data-change-id`.
  - A paragraph-mark revision puts the id on the block (`p.rev-para-ins`/`rev-para-del`). It can be
    a different item than the paragraph's text (on `paragraph-join`, an "inserted" item owns a
    `rev-para-del` block), so the rule is chosen by the element's class, not by the item's kind.
  - The ¶ glyph (`span.rev-para-mark-del`) has no id; it is a left-panel aid.
  - Table rows: `tr.rev-row-ins/del` carries the id, its cells (`td.not-in-…`) do not, and the
    paragraphs inside carry paragraph-mark ids of the same item.
  - A note's `li` has no id; its paragraphs and the reference (`del`/`ins` around the number) carry
    the item's id.
  - `.rev-del-marker`/`.rev-move-from-marker` (hidden in the right panel) did not appear on any
    fixture.
- **Joins in the middle column:** `mergeJoinedParagraphs` joins once per side. In the middle column
  joins depend on decisions, so they must be undoable. Content that is moved in (markers, comment
  icons) has to be put back or removed when a join is undone. A join must not cross a table or the
  end of its container (cell, note). The export drops a paragraph that loses its mark when no
  paragraph keeping its mark follows it there (see "Comments" in `docs/architecture.md`).
- **Decisions to elements:** `finalRevisionDecisions` (`src/model/decisions.ts`) already turns
  item decisions (plus the formatting choice and range) into per-revision decisions for the export.
  The Resolved column should use the same function for its **content** revisions, with undecided
  treated as accept, so that view and export cannot disagree on the text. Its decisions for
  formatting revisions are ignored, since formatting is not shown (requirement 9).
- **Performance:** the sample has hundreds of changes and the 300-page pair thousands. Updating
  the column after a decision must be a class/attribute change on the affected elements, not a
  re-render of the whole HTML. Bulk decisions update in one batch. A third copy of the HTML in the
  DOM adds memory and first-render time: measure it against the sample timings in
  `docs/measurements.md` (FR-44 / success metric 4) and record the new numbers there. The middle
  panel is mounted only in three-column view, so the two-column view costs nothing extra.
- **Scroll sync:** `src/ui/scrollSync.ts` pairs two panels by block offsets (`pairOffsets`,
  `mapScrollTop`). It needs to drive three. Blocks hidden in the Resolved column (a deleted
  paragraph that was accepted) have no offset there and must be skipped, as hidden blocks already
  are for the side panels.
- **Bubbles:** reuse the positioning approach of `InlineChangeCard.tsx` (`changeBox` from
  `reveal.ts`, slot in the shadow root, absolute position in the scroller), with one bubble per
  comment and a stacking pass for overlaps.
- **View settings:** add `columns: 2 | 3` (or `threeColumns: boolean`) to `ViewSettings` and change
  `DEFAULT_VIEW_SETTINGS` to `{ …, changesList: false, outline: false, threeColumns: true }`. Stored
  settings are merged over the defaults (`load()`), which gives requirement 4's behaviour.
- **Tests:** unit tests next to the code (per-decision visibility rules, bubble open/close state,
  view settings defaults, narrow-window fallback); an e2e test in `e2e/` that decides changes on a
  fixture and compares the Resolved column's text with the exported document's text; existing e2e
  tests must keep passing (they may need the view set to two columns, or the sidebars expanded,
  since the defaults change).

## 8. Success metrics

1. **Text parity:** on every fixture pair and the sample pair, for all-accept, all-reject,
   all-undecided and alternating decisions, the Resolved column's visible text (in-range part plus
   tail) equals the export's text (`test/text.ts` normalisation). Automated.
2. **Formatting unchanged by the choice:** switching the formatting choice leaves the Resolved
   column's HTML unchanged (unit or e2e check), so the view never pretends to preview formatting.
3. **Selection:** every change and marker in the Resolved column selects its item when clicked
   (e2e on a fixture with each markup kind).
4. **Comments:** with a comment on several items, all bubbles are visible on load. × and the icon
   toggle them. A reload reopens them all. (e2e)
5. **Responsiveness:** on the sample, a single decision updates the Resolved column in under 100 ms,
   and Accept all / Reject all in under 1 s. Reject all is the worst case: it flips every undecided
   change, while Accept all only changes their marks, since undecided already shows as accepted. First display with three columns stays within the existing
   success metric 4 (under 10 s for the ~60-page pair after the engine has loaded).
6. **Defaults:** a fresh browser profile opens a review in three columns with both sidebars
   collapsed. At 1024 px or narrower it shows two columns with the toggle disabled. (e2e)
7. All existing tests (`npm test`, `npm run test:e2e`, typecheck) pass.

**Status (2026-10-18):** goals 1–6 and success metrics 1–7 are met; the evidence and numbers are in
`docs/measurements.md` ("Resolved column" under the success metrics outcomes). Metric 5 measured on
the sample: one decision 13–30 ms, Reject all 122–130 ms, Accept all 63–69 ms, first display with
three columns 8.1–9.2 s. While measuring, a regression from dark mode (not from this feature) was
found and fixed: the ~300-page pair's longest display task had grown to ~1.2 s.

## 9. Open questions

1. **Later: following the formatting choice** (deferred, decided 2026-10-17). If it is wanted
   later, the candidate approaches are:
   - (a) A second HTML rendered from the tagged redline with only the formatting revisions rejected
     (the `rPrChange`/`pPrChange`/table rules of `rejectRewrite.ts`). This needs a way to keep
     `data-anchor` ids matching, or a switch of range and scroll sync to `data-change-id`.
   - (b) CSS overrides derived from the formatting revisions' old properties. This is cheaper but
     covers run formatting only, not styles or numbering.
   - (c) Rendering the real export. This is exact, but costs ~1 s per decision and loses the ids
     needed for selection.

   FR-39a (kept text takes its neighbours' formatting) would come on top of any of these.

Settled on 2026-10-17: the narrow-window threshold is 1024 px (requirement 5); the formatting
cards' edge becomes gray (28a); the legend gets Decided/Undecided entries (28b).
