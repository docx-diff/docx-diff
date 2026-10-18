# PRD: Inline edits in the Edited column

## 1. Introduction / overview

Today the reviewer can only accept or reject the editor's changes (`docs/requirements.md`, FR-27 …
FR-34). When a change is *almost* right (a typo in the editor's new wording, a missing comma, a
word the editor forgot to change) the reviewer has to export, open the file in a word processor and
fix it there, outside the review. "Editing text in the tool" is listed under the Non-goals.

This feature lets the reviewer make **simple text edits directly in the Edited panel** (the right
column). The **Editable** toggle in the Edited panel's header turns it on. While it is on, a click
in the text places a cursor there, and the reviewer types, deletes or replaces words within a
paragraph. About 400 ms after they stop typing, the change set updates **for that paragraph only**,
without a full re-compare. An edit inside an existing change's text stays part of that change,
with its decision. Anything else becomes a new change, which starts as accepted; existing decisions
are never changed by an edit. The other panels, the Resolved column,
the changes list and the export all treat the edited text **as if the Edited document had contained
it from the start**.

Editable is **off by default** and **off after every load**, because a click in the text normally
selects a change (FR-29).

**Goal:** the reviewer fixes small mistakes in the editor's text during the review. They don't
have to leave the tool, and the comparison doesn't slow down.

## 2. Goals

1. The reviewer can edit text within a paragraph of the Edited panel (body, table cells,
   footnotes/endnotes, headings) once **Editable** is on.
2. After the reviewer stops typing, all views (Original, Resolved, Edited, changes list, outline,
   overview bars) show the new change set within **400 ms (debounce) + 100 ms** on the ~60-page
   sample. This also holds on the ~300-page pair, because an update touches only the edited
   paragraph. The update never runs the engine's compare again.
3. Typing never freezes the page: no main-thread task over 50 ms while typing, and none over 100 ms
   for one update after the debounce, on the sample.
4. The export treats edited text exactly like the editor's text: accept all ≡ the Edited text with
   the edits, reject all ≡ the Original text, and exports with edits pass `verifyDeliverable` and
   LibreOffice.
5. Edits are saved with the review and are back, with the same changes, ids and decisions, after a
   reload or on resuming.
6. The reviewer can undo while typing, and can revert their edits per paragraph or all at once.

## 3. User stories

- As a reviewer, I want to fix a typo in the editor's new wording in place, so I can accept the
  change instead of rejecting a mostly correct one.
- As a reviewer, I want to change a word the editor did not touch, so the export has the wording I
  want without a second tool.
- As a reviewer, I want a fix inside the editor's change to stay part of that change, and my
  decisions on neighbouring changes to stay as I made them.
- As a reviewer, I want my own new changes to start as accepted, because I made them on purpose.
- As a reviewer, I want editing to be off unless I turn it on, so a click still selects a change and
  I can't change the text by accident.
- As a reviewer, I want to undo a slip while typing, and to throw away all my edits in a paragraph
  (or the whole document) if I change my mind.
- As a reviewer, I want my edits kept when I reload the page, like my decisions.

## 4. Functional requirements

### The Editable toggle

1. The Edited panel's header (where its file name is shown, FR-2) must have a toggle button with an
   icon (e.g. a pencil) and the text label **Editable**. It is pressed (`aria-pressed="true"`) while
   editing is on. Tooltip: "Edit the Edited text (simple edits within a paragraph)" when off, "Stop
   editing" when on.
2. Only the Edited panel has this toggle. The Original panel and the Resolved column are never
   editable.
3. Editable is **off** when a review is shown: after a comparison, a reload, or on resuming. Its
   state is **not** remembered in the browser or in the saved review.
4. The toggle works the same in the two-column and three-column views (FR-25c).
5. While Editable is on, the Edited panel shows that it is editable: a text cursor (I-beam) over
   editable text, and a subtle tint or outline on the panel. Non-editable regions
   (requirement 12) show the default arrow cursor.
6. While Editable is on, the current change's card in the Edited panel (FR-28a) is hidden, so it
   doesn't cover the text being edited. It comes back when Editable is turned off.

### Clicking and the keyboard while editable

7. While Editable is on, a click in the Edited panel's text **places the cursor** there and does
   **not** select the change under it (FR-29 is suspended in this panel only). Clicks in the
   Original panel, the Resolved column and the changes list still select changes as usual.
8. While the cursor is in the Edited text, the app's single-key shortcuts (FR-34: `j`/`k`/`↓`/`↑`,
   `a`/`r`/`A`/`R`/`u`, `?`) are **off**: the keys type text. Escape takes the cursor out of the
   text (blur), and the shortcuts work again.
9. Turning Editable off applies any edit still waiting for its debounce at once (requirement 15),
   then restores click-to-select.

### What can be edited

10. Editable text: the paragraphs of the Edited panel in the **body**, **table cells**,
    **footnotes and endnotes**, and **headings**, within the comparison range (FR-14 … FR-19).
11. Allowed edits within **one paragraph**:
    - typing, deleting (Backspace/Delete within the paragraph) and replacing selected text;
    - pasting: only **plain text** is inserted, with line breaks and tabs replaced by spaces;
    - **phase 2** (requirement 33): Ctrl+B / Ctrl+I.
12. **Not editable** (the cursor cannot be placed there, or the action is blocked):
    - text after the comparison range's end point (the out-of-range tail, FR-17/FR-18);
    - paragraphs containing any part of a **move** (FR-8 Moved), source or destination;
    - paragraphs whose paragraph mark is inserted or deleted (shown joined in the panel,
      `mergeJoinedParagraphs`), and **Paragraph break** items. This includes every paragraph of an
      inserted table row and of a footnote/endnote only the Edited has (their marks are inserted);
    - paragraphs that another paragraph's content is joined into, in any panel (the paragraph
      after one with an inserted or deleted mark);
    - inline objects inside a paragraph: footnote/endnote reference marks, list numbers, images,
      fields, tabs and line breaks. They stay where they are. The reviewer can type around them but cannot delete or
      select-and-replace across them.
13. Blocked actions show a short message (a toast near the Edited panel's header, gone after ~4 s,
    `role="status"`), and the text does not change:
    - **Enter** or **Shift+Enter**: "Only simple edits within a paragraph are supported, to keep
      the comparison fast. Paragraph breaks can't be added here."
    - **Backspace at the start / Delete at the end** of a paragraph (joining paragraphs): the same
      message, "… Paragraphs can't be joined here."
    - a selection that spans more than one paragraph, then typing/deleting/pasting: "… Edits must
      stay within one paragraph."
    - deleting an inline object (footnote reference, image, …): "Footnote references and other
      objects can't be deleted here."
    - clicking a non-editable region (requirement 12): "This paragraph can't be edited here (it
      contains a moved passage / a paragraph break change / text joined from another paragraph /
      is outside the comparison range)."
    - drag-and-drop of text in the panel is blocked silently.

### How an edit becomes a change

14. An edit changes the **Edited** version only. The Original never changes. After the update, the
    paragraph is compared again **with its Original counterpart**: the same paragraph as the
    Original panel shows it (empty for a paragraph only the Edited has) against the new Edited
    text, **word by word** (FR-7: a changed word is marked as a whole word). Only the edited part
    is compared again. The rest of the paragraph's changes stay exactly as they were.
15. The update runs **400 ms after the last keystroke** in a paragraph (debounce), when the cursor
    leaves the paragraph, or when Editable is turned off, whichever comes first. While a character
    is being composed (dead keys, e.g. ő, ű; input methods) no update runs; the 400 ms count from
    the end of the composition. It updates only the
    edited paragraph's data and markup: no engine compare, no full re-render.
16. **Existing decisions are never changed by an edit.** A decision is a deliberate action, so an
    edit never merges changes or moves text from one change to another. Which change each piece of
    the paragraph's difference belongs to is decided by **where the text came from**:
    - text that was already part of an existing change's text stays in **that** change. The change
      keeps its **id, decision and comment**. Its text in the list and card is updated (e.g. the
      reviewer fixes a typo inside the editor's inserted "hosue" → "house");
    - newly typed characters **inside** an existing change's text, or continuing one of its words
      without a space between, join that change;
    - everything else the edit adds or removes (typed text outside existing changes, deleted text
      that was unchanged before) forms a **new** change, **accepted** by default. A new deletion and
      a new insertion that touch form one new **Replaced** change (FR-8);
    - a new change is never joined with an existing one, even when they touch. Example: the Edited
      panel shows `the [big] red [house]`, two insertions by the editor, "big" accepted and "house"
      rejected. The reviewer changes "red" to "blue". Result: three changes, `[big]` (still
      accepted), `red → blue` (new, accepted) and `[house]` (still rejected), each decided
      separately;
    - an existing change whose text the edit removes completely, or that no longer differs from the
      Original (the reviewer typed the Original's text back), **disappears** from the list. Its
      decision and comment are kept in the review state (unused), so that Revert (requirement 22)
      brings it back as it was.
    An edit inside a **rejected** change keeps it rejected: the reviewer is editing the Edited's
    wording (perhaps with a comment) and decides it separately.
17. New and changed items behave like any other: Accept/Reject, comments, Previous/Next, the
    keyboard, the Resolved column's marks, the overview bars, the totals, compare-setting rules
    (FR-13b same-text relabelling, FR-13c ignored items, shared edges of replacements), the range
    classification. They are **not** marked as "the reviewer's" anywhere (they count as the Edited
    document's).
18. Inserted text takes the formatting of the text it is typed into: the character before the
    cursor, else the one after it. Typed text is normalized to NFC, like the inputs (FR-13a).
19. After an update, the Edited panel shows the new markup (insertions blue and underlined, FR-21).
    The cursor and the text selection stay where they were in the text, and the panel doesn't
    scroll. The Original panel and the Resolved column show the paragraph's new markup without
    moving the text being read (as after a decision, FR-25b). Scroll sync (FR-22) keeps working,
    with the edited paragraph's new height taken into account.
20. Editing a heading updates the outline (FR-24a) after the update: the heading stays in it, with
    its new text.

### Undo and revert

21. **Undo while editing:** Ctrl+Z / Ctrl+Shift+Z (and Ctrl+Y) undo and redo the reviewer's text
    edits in the Edited panel, step by step, **also after** an update has re-rendered the paragraph.
    The browser's native undo is not enough here: it breaks when the markup is rewritten. The
    history lasts until Editable is turned off or the page is reloaded.
22. **Revert this paragraph:** while Editable is on, a paragraph with edits shows a small revert
    button (↺, tooltip "Revert my edits in this paragraph") at its right edge when the cursor is in
    it or the mouse is over it. A click restores the paragraph as the comparison produced it. Its
    original items come back with their decisions and comments. The items the edits created
    disappear, with their decisions and comments.
23. **Revert all edits:** while Editable is on and at least one paragraph has edits, the Edited
    panel's header shows a **Revert all edits** button next to the toggle. It asks for confirmation
    ("Revert your edits in N paragraphs? This can't be undone.") and then reverts every paragraph as
    in requirement 22.
24. **Swap** (FR-3) and a new comparison discard the edits. When there are edits, Swap and
    replacing either file with the toolbar's file pickers (FR-1) first ask for confirmation
    ("Swapping discards your edits in N paragraphs." / "Opening another file discards …"). Close review (FR-48)
    discards them with the rest of the review.
24a. **Range warning:** edits don't re-detect the comparison range. When the reviewer moves the
    range's end point (FR-15/FR-16) so that one or more edited paragraphs fall outside the range, a
    confirmation dialog warns first: "Your edits in N paragraphs will be outside the comparison
    range. Their changes won't be offered for decision, and the export keeps the Original's text
    there." **Move the end point** applies it; **Cancel** leaves the range as it was. The edits are
    kept either way: moving the end point back brings their changes into the range again.

### Saving the review

25. Edits are part of the saved review (FR-46), saved like decisions (debounced, at once on
    `pagehide`). Resuming (FR-47) compares the stored files again as today, then **replays** the
    edits. It gives the same items, item ids, decisions and comments as before the reload.
26. A saved edit that can no longer be applied (its paragraph not found or its Original text
    different; it should not happen with the same files and engine version, FR-49) is skipped, and
    the app says so once ("N edits could not be restored.").

### Export

27. The export (FR-37 … FR-45) uses the Edited text **with the edits**. An accepted change gives
    the reviewer's edited wording, a rejected one the Original's.
28. With **Keep undecided changes as tracked changes** (FR-38b), a change containing an edit that
    is undecided (the reviewer reset its decision) stays a tracked change, like any other. Its
    tracked text is the edited wording, by the export's author (FR-38c).
29. The export's comments (FR-27b) quote the edited wording ("to …").

### Documentation

30. `docs/requirements.md`: remove "Editing text in the tool" from the Non-goals (keep "Editing text
    or comments in the Resolved column" and add "editing the Original"). Add the feature as new
    sub-items (e.g. FR-25d …, see the numbering rule in the file's header; don't renumber).
    Mention the edits in FR-46 and FR-45.
31. `docs/architecture.md`: a new section on inline edits (data model, paragraph diff, id rules,
    paragraph mapping, export path), and the Saved review section's schema change.
32. `docs/measurements.md`: the update timings (requirement 2, 3).

### Phase 2: bold and italic

33. Ctrl+B / Ctrl+I on a selection within one paragraph toggle bold / italic. It becomes a
    **formatting** change (FR-8, in the formatting group, decided by the document-wide formatting
    choice, FR-30). The edits belong to the Edited document, and the default choice is **Use the
    Edited's formatting**, so by default the export keeps them. With **Keep the Original's
    formatting** it drops them, as it does the editor's own formatting; no extra warning. Without a
    selection the keys are blocked silently. Implement only after phase 1 is done and tested.

## 5. Non-goals (out of scope)

- Editing the Original panel or the Resolved column.
- Adding or removing paragraphs, paragraph breaks, line breaks or tabs; joining paragraphs.
- Editing moved text, paragraphs with paragraph-mark changes, or the out-of-range tail.
- Paragraph formatting (styles, alignment, lists), fonts, colours, sizes, underline; anything
  beyond bold/italic (phase 2).
- Inserting or deleting footnotes, images, fields, hyperlinks or comments.
- Rich paste (formatting from the clipboard).
- Marking the reviewer's edits as a separate layer or author (they count as the Edited's).
- Downloading the edited Edited document on its own.
- A full re-compare after edits, or re-detecting the comparison range after edits.
- Touch / mobile editing.

## 6. Design considerations

- **Header:** the Edited panel header already accepts controls (`headerControls` in
  `src/ui/DocumentPanel.tsx`; the Resolved column uses it for its Comments button,
  `src/App.tsx`). Toggle: icon + "Editable", same look as the Comments button. **Revert all
  edits** appears to its right only while Editable is on and there are edits.
- **Editable panel:** a subtle tint or a 2 px outline in the accent colour (light and dark,
  FR-25a, tokens in `index.css`/`panel.css`). Non-editable regions stay as they are, with an arrow
  cursor.
- **Toast:** small, near the Edited header, `role="status"`, auto-hides. One at a time. A repeated
  message restarts its timer.
- **Revert ↺ button:** in the panel's right margin, aligned with the paragraph's first line. Placed
  like the inline card (light-DOM child through a slot, `reveal.ts`/`InlineChangeCard.tsx`
  pattern), so it scrolls with the text.
- **Colours:** no new colours for edited text. It is an ordinary insertion/deletion (blue / red).
- **Help popover:** add a line about Editable and that shortcuts are off while typing.

## 7. Technical considerations

**Read `docs/architecture.md` first** (Data flow, Change items, Rendering, Resolved column, Export,
Saved review). Engine facts in `CLAUDE.md` apply: in particular, never restructure the redline XML
before rendering, and never use `DocxSession` for decisions. File and line references below were
checked against the code on 2026-10-18.

### What the current code assumes, and what has to change

- **A comparison is immutable today.** `useComparison` builds one `Comparison` (`result`,
  `analysis.items`, `document`, `itemTexts`). `App.tsx` treats a new `comparison` object as a
  **new review**: `if (comparison !== reviewedComparison)` clears or restores decisions and range
  (`src/App.tsx` ~line 130). So edits must **not** produce a new `Comparison`. Keep the edits in
  their own state and derive the live `items`, `itemTexts` and index from `comparison` + edits.
  Every `useMemo` that reads `comparison.analysis.items` or `comparison.itemTexts` (`ignored`,
  `range`/`classify`, `spanning`, `outOfRange`, `reviewable`, `resolvedSides`, `entries`,
  `itemById`, export) switches to the derived values. `blockPositions` and `outOfRangeBlocks` can
  stay on the comparison, because blocks and anchors don't change.
- **Each panel holds its own copy of the HTML.** `DocumentPanel` imports `document.body` into its
  shadow root in a layout effect keyed on `[document, side]` (`src/ui/DocumentPanel.tsx`, first
  `useLayoutEffect`). A new `document` would rebuild every panel: the longest task is 180–270 ms
  (`docs/measurements.md`), and the Resolved column is prepared again. That breaks the 100 ms
  budget. An update must instead **replace one block in place**, in four DOMs: the master
  `comparison.document.body` (read by `buildOutline`) and the Original, Resolved and Edited panels.
  Each one also needs its caches patched:
  - `DocumentPanel`: `elementsRef` (`elementMap`), `blocksRef`, `styledRef` (dark-mode `style`
    rewrites, `darkColors`), the applied decisions, current change and ignored/out-of-range/common
    classes for the new elements;
  - `resolvedView.ts` (`ResolvedPanel`): `elements`, `markers` (`insertMarkers`), `children` (saved
    for joins), `itemNotes`, `commentToggles`, `sides`. Add a `replaceBlock(handle, unid, html)`
    that first restores the **whole run** of joined paragraphs around the block, swaps it, and joins
    again. `CLAUDE.md`: "restore the whole run … not just the changed block". The edited block's
    own mark never changes, but an earlier block's content can be joined **into** it.
  Add a panel method, e.g. an imperative `replaceBlock(unid, html)` on the panel's ref, that the
  App calls after an update, instead of a new prop that re-runs the import effect.
- **Decorating the new block.** The master HTML goes through `prepareRenderedDocument`:
  `decorateDocument` (adds `data-change-id`), `collectItemTexts`, `relabelTextUnchanged`,
  `combineTypedListNumbers`, `isolateCommonAffixes`, `markItems(change-as-formatting)`. Then each
  panel runs `markItems(ignored)`, `markCommon`, `markItems(out-of-range)`, `applyDecision`. The new
  block's markup must go through the same steps, **scoped to the block**. Several of these functions
  take a `Document` or the whole root today. Give them a root/block parameter without changing what
  they do for the whole document (their tests must pass unchanged).
- **Scroll sync needs nothing new.** It drops a panel's cached offsets on a `ResizeObserver` entry
  for `.doc` (`src/ui/scrollSync.ts` ~line 162), which fires when the edited paragraph's height
  changes. The overview bar re-measures on the same observer (debounced 200 ms).
- **App-wide recomputation per update.** The derived memos run over all items (a few thousand on the
  ~300-page pair). Accept all, which also recomputes them, takes 63–69 ms on the sample. Measure an
  update on the ~300-page pair early. If it is over budget, update `ignored`/`range` incrementally
  for the paragraph's items.

### Paragraph model and diff (requirement 16)

- **The Original counterpart is the same block.** The redline has one `w:p` holding both versions:
  its Original text is the block's text without `ins`/move-to content, its Edited text the text
  without `del`/move-from content (`NOT_ORIGINAL`/`NOT_EDITED` in `src/model/docIndex.ts`). No
  matching between paragraphs is needed.
- **Use a segment model, not a fresh Original-vs-new diff.** Represent the block as a sequence of
  segments: `equal` text, `del(item, revision)`, `ins(item, revision)`, and inline objects. Apply the
  reviewer's change (the diff between the previous and the new **visible** Edited text, which is
  confined to the edited span) to that sequence:
  - typed text inside an `ins` (or continuing one of its words) extends it;
  - typed text elsewhere becomes a new `ins`;
  - deleting `equal` text makes a new `del`;
  - deleting from an `ins` shrinks it.
  Then normalise **only around the edit**: expand new pieces to whole words (FR-7) by turning the
  partly changed word's `equal` characters into new `del` + `ins`; join touching new `del`/`ins`
  into one new Replaced item; drop a new `ins` + `del` pair whose texts are equal.
  A fresh LCS of the whole paragraph could align the engine's untouched changes differently and
  silently move or dissolve decided items. The segment model leaves everything outside the edit
  byte-identical.
- **Formatting source.** A segment doesn't store an HTML span or run index: HTML spans and XML
  `w:r`s don't correspond one to one. New text takes its formatting from the **neighbouring
  character** (before it, else after it, PRD-18): in the display, the neighbouring span's markup; in
  the export, the `w:rPr` of the `w:r` holding that character, found by text offset.
- **Text offsets must agree between the HTML and the XML.** The reader skips what isn't document
  text the same way `DocIndex` does (`NOT_TEXT`: list labels, ¶ glyphs, back links) and treats
  inline objects (note references, tabs, breaks, `w:sym`, images, field codes) as one placeholder
  each on both sides. The spike checks this alignment on every fixture and the sample.
- **Don't trust where the browser put the typed characters.** At the boundary between an `ins` and
  plain text (or next to a hidden `del`), browsers choose the element to insert into on their own.
  Derive ownership from the text diff and the rules above, not from the DOM node the text landed in.
- Write the model as **pure functions** (e.g. `src/model/paragraphEdit.ts`) with no DOM, used by
  the main thread (display) and the worker (export). Unit-test requirement 16's example, the typo
  inside an insertion, typing the Original back, and deleting a whole insertion.
- The regions may differ from what a fresh engine compare would give (decided, acceptable).

### Ids

- **Item ids must not change when their revisions change.** Today an item's id is its first
  revision id (`ChangeItem.id`, `src/model/changes.ts`). If an edit removes that revision (e.g. the
  whole inserted half of a Replaced item), recomputing the id would lose the decision. Keep each
  existing item's id fixed for the life of the review.
- New revision and item ids: strings that can't collide with the engine's ids (`rev…` strings, not numbers) and are
  **deterministic on replay**, e.g. `e<paragraphKey>.<n>`. Nothing in the model parses ids as
  numbers (checked: `revisionIdFromAuthor` slices the `rev:` prefix; `changes.ts` sorts by list
  position). `ChangeItem.order` must be renumbered after inserting new items.
- `RevisionListEntry`-like entries for new revisions (`type`, `family`
  `content_insert`/`content_delete`, `text`, `partUri`, `scope`, `affectedAnchors` = the block's
  unid) so the model code treats them like engine revisions. `DocIndex.adjacentRevisions` and
  `revisionsInHtml` need entries for them too.

### Mapping a block to the redline `w:p` (spike first)

- The redline has no anchor ids, and the HTML's `data-anchor` unids are computed by the engine
  (`UnidHelper.ContentSignature`). **First task: a spike** deciding between
  (a) reimplementing the unid hash in TypeScript (exact, see `refs/Docxodus`), and
  (b) mapping by the paragraph's ordinal within its part (body, footnotes, endnotes; table cell
  paragraphs in document order), verified by comparing the block's Original/Edited text with the
  `w:p`'s. Run it over the sample, the ~300-page pair and every fixture.
- The edit records' key is this block key. It must be stable across reloads (comparison output is
  deterministic for the same files and engine version, FR-49).
- The rendered block keeps its **old** `data-anchor` after an edit. Don't recompute it: the range,
  scroll sync and outline rely on it.

### Export: patching the redline in the worker

- Add `edits` to `ExportRequest` (`src/engine/types.ts`): per block key, the final segment sequence
  (with each segment's revision id, and the source run for formatting). The redline is patched only
  here, so the 400 ms path does no zip/XML work and no engine calls.
- **Patch first, then hand updated revisions to every later step.** `rejectRevisions` finds each
  revision's markup by its `constituentKeys` (element name + `w:id`) through `ElementIndex`
  (`src/engine/ooxml.ts`). A duplicate or missing `w:id` is an error (`RevisionMarkupError`). So the
  patch step returns an updated `revisions` list:
  - new `w:ins`/`w:del` get fresh integer `w:id`s above every `w:id` in the part;
  - an engine `w:ins`/`w:del` that is split (e.g. part of a deleted word typed back) gets new ids
    for the extra elements, added to its revision's `constituentKeys`;
  - removed elements leave the keys.
  `consistentLook`, `rangeOrder`, `trackedRevisions` (FR-38b, which allocates ids from the max),
  `notes` and `comments` then all use the updated list.
- **Rewrite only text runs.** Keep every other child of the `w:p` in place by text offset:
  bookmarks, comment ranges, `w:hyperlink` (whose runs are inside it), field characters,
  `w:proofErr`, footnote references. Split `w:r` at segment boundaries, copy `w:rPr` from the source
  run, wrap new pieces in `w:ins`/`w:del` (`w:delText` inside deletions; author/date like the
  engine's). If the spike finds paragraphs whose run structure is too complex (content controls
  `w:sdt`, complex fields spanning the edit), add them to requirement 12's non-editable list rather
  than patching them.
- Use `@xmldom/xmldom` (no `DOMParser` in the worker), and copy live node lists into arrays before
  changing the document (`CLAUDE.md`).
- The round-trip checks (§8) must hold on the patched redline: accept all ≡ the edited Edited text,
  and every single revision decided against the rest ≡ the engine's `DocxSession` decision on the
  patched XML (fixtures).

### Editing in the panel

- **Keyboard shortcuts will fire while typing unless fixed.** `useKeyboardShortcuts` listens on
  `window` and checks `event.target.closest(TYPING_FIELDS)`, which includes `[contenteditable]`.
  But a key event from inside a shadow root is **retargeted** to the shadow host (the panel's
  scroller) by the time it reaches `window`, so the check doesn't see the editable block. Typing
  "a" would accept the current change. Check `event.composedPath()[0]` instead (and add a test).
  The global Escape handler (`src/App.tsx` ~line 386) needs the same care (requirement 8).
- **Selection inside the shadow root:** `document.getSelection()` reports boundaries retargeted to
  the host. Use `Selection.getComposedRanges({ shadowRoots: [root] })` (Baseline 2025: Chrome/Edge
  137+, Firefox 142+, Safari 17+; Safari 17.0–17.1 have an older call form), with Chromium's
  `shadowRoot.getSelection()` as a fallback. Its behaviour inside a `contenteditable` in a shadow
  root is not documented anywhere I found: check it in the spike.
- Use `contenteditable` on editable blocks only, `contenteditable="false"` on inline objects (note
  references, list labels `[data-list-marker]`, images, our markers), and intercept `beforeinput` to
  enforce requirements 11–13 (`insertParagraph`, `insertLineBreak`, cross-block `deleteContent*`,
  `insertFromDrop`, `insertFromPaste` → plain text).
- **Undo (requirement 21):** cancel `beforeinput` with `inputType` `historyUndo`/`historyRedo`
  (cancelable in Chrome; the browser's Edit-menu undo state is then meaningless), and also handle
  Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y on `keydown`. Keep the own stack as segment-model snapshots with
  cursor offsets.
- **Input methods:** Hungarian (the sample's language) uses dead keys for ő/ű. Don't run the
  update during composition (`compositionstart`…`compositionend`, `event.isComposing`). Start the
  400 ms debounce at `compositionend`.
- The panel hides `<del>` and move-from content with CSS: read the visible Edited text without them,
  and keep the cursor out of hidden elements.
- Save and restore the cursor/selection as **text offsets within the block** around a markup
  rewrite. Rewrite the block being typed in only after the debounce, never per keystroke.
- **Which blocks are editable:** in-range blocks (the Edited panel gets no `outOfRangeBlocks` today;
  compute them for it from `blockPositions` and the end point). Exclude blocks with move content,
  blocks with a paragraph-mark revision, and blocks that received another block's content through a
  join in **any** panel (`mergeJoinedParagraphs` / the Resolved column's joins), see requirement 12.
- **Performance:** changing a panel's style sheet after content is in the shadow root restyles the
  whole document (`CLAUDE.md`, 0.7 s on the ~300-page pair). Toggle editability with a class or
  attribute and pre-written CSS in `panel.css`, never by writing new style text.

### Outline (requirement 20)

- `buildOutline` places each heading by **matching its text** (`result.headings`, read from the
  Edited input in the worker) to a block's text (`src/model/outline.ts`). After a heading is
  edited, that match fails and the heading would vanish from the outline. Keep a derived
  `headings.edited` with the edited text, and rebuild the outline from it.

### Saved review

- **What is saved:** per edited block, its key (see the mapping spike) and its segment sequence
  as last updated (text, segment kind, owning item and revision id, formatting source), plus the
  sequence the comparison produced, so that Revert and replay can check that the block still
  matches (requirement 26). Not keystrokes, and not the undo history.
- `src/storage/reviewStore.ts`: add `edits` to `ReviewState` and `sanitizeState` (a record without
  them loads with none; malformed records are dropped). The schema version can stay 1 (an addition
  with a default).
- **Order on resume:** `App.tsx` restores decisions while rendering, the moment the comparison
  arrives, and **drops decisions whose item id is unknown** (`known` set, ~line 139). The saved
  segments name their item ids, so add the ids found in the saved edits to `known`. The decisions
  of edit-created items are then kept, whatever order the replay runs in.
- **Only brand-new items start accepted.** A replay, an undo/redo or a revert brings back items
  whose decisions are already in the state (the reviewer may have rejected them since). Accept only
  items whose id was just allocated by a live edit, never on replay, undo, redo or revert.
- The master rendered document (`comparison.document.body`) must stay in sync with the panels:
  switching to three columns mounts the Resolved column from it.
- `useAutoSave` saves `reviewState`. Add the edits to it (debounced 300 ms; typing produces an update
  every 400 ms at most).

### Phase 2 (bold/italic)

- A formatting revision is a `w:rPrChange` on the run holding the old `w:rPr`. In the display, the
  run's `b`/`i` styling changes and the item goes to the formatting group. Check that `consistentLook`
  (FR-39a) and the formatting choice handle runs that exist only from edits.

## 8. Success metrics

1. **Text round trip with edits** (engine tests, fixtures and the sample pair): for scripted edits
   (insert a word, delete a word, replace inside an existing insertion, edit between two
   changes, edit in a table cell, in a footnote, in a heading, edit that types the Original back),
   accept all ≡ the Edited text with the edits, reject all ≡ the Original text (`test/text.ts`).
   Mixed decisions ≡ an extended `test/expectedText.ts` model.
2. Exports with edits pass `verifyDeliverable` and `scripts/check-libreoffice.sh`.
3. **Id rules** (unit tests): existing item keeps id/decision/comment when edited; an edit next to
   decided changes never changes their decisions (requirement 16's example); new items accepted; a reverted paragraph restores its items exactly.
4. **Replay** (unit + e2e): reload after edits gives identical items, ids, decisions, comments.
5. **Performance** (e2e `PERF=1`): an update after typing a word is visible within 500 ms of the
   last keystroke, and no update task is over 100 ms, on the sample and on the ~300-page pair. No
   task over 50 ms per keystroke.
6. **Blocked actions** (e2e): Enter, joining paragraphs, cross-paragraph selection, deleting a
   footnote reference, and clicking a moved paragraph each show their message and leave the text
   unchanged.
7. **Typing is not a shortcut** (e2e): typing `a`, `r`, `j`, `u` and `?` into an editable paragraph
   inserts the letters and decides or moves nothing. An accented letter typed with a dead key
   (e.g. `ő`) gives one update after composition ends.
8. Existing tests still pass (`npm run typecheck`, `npm test`, `npm run test:e2e`), and nothing
   changes while Editable has never been turned on.

## 9. Open questions

1. **Spike before the rest of the work:** (a) paragraph mapping: reimplement the unid hash, or map
   by ordinal? It decides the key format saved in reviews; (b) does `getComposedRanges` give the
   right cursor position inside an editable block in the panel's shadow root (Chromium, Firefox)?
   (c) time one update on the ~300-page pair (derived memos over all items, one block replaced in
   four DOMs) against the 100 ms budget.

Decided 2026-10-18:
- An edit never merges changes or changes an existing decision; it splits by where the text came
  from, and what it adds outside existing changes is a new, accepted change (requirement 16).
- Editing inside a **rejected** change: the item stays rejected (requirement 16). The reviewer is
  editing the Edited's wording, perhaps with a comment, and decides it separately.
- Paragraphs with paragraph-mark changes or moves are not editable (requirement 12): acceptable.
- The local diff's word regions may differ from a fresh engine compare: acceptable, as long as the
  text checks (§8) hold.
- Moving the range end point past edited paragraphs warns first (requirement 24a).
- Bold/italic (phase 2) stays in scope: the edits are in the Edited document, whose formatting is
  the default choice (requirement 33).
