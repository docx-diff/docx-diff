# Tasks: Inline edits in the Edited column

PRD: [`2026-10-18-151812-prd---inline-edits-in-edited-column.md`](2026-10-18-151812-prd---inline-edits-in-edited-column.md)
(requirements are cited as `PRD-<n>`, the PRD's technical section as `PRD §7`).

## Relevant Files

New:
- `src/model/paragraphEdit.ts` - The paragraph edit model, pure (no DOM): `Segment`/`BlockEdit` types, `visibleText`/`originalText`, `editSpan`, `applyTextEdit` (old visible text → new visible text applied to the segments: ownership, whole-word widening, typed-back cancellation, new ids), `revertBlock`, `revisionTexts`, `blockItems`. Shared by the main thread and the worker.
- `src/model/paragraphEdit.test.ts` - Unit tests: edit span (caret, NBSP, surrogates), PRD-16's example, typo inside an insertion, typing the Original back, deleting a whole insertion, a word partly changed, objects, ids stable on replay, `blockItems`.
- `src/ui/blockSegments.ts` - `readBlockSegments`: a rendered block's segments from the decorated HTML (`equal` / `del` / `ins` / inline objects: note references, tabs, breaks; item ids from `data-change-id`, revision ids from `data-author`) (task 2.6); `renderBlockSegments`: segments back into the block's markup (task 3.1); `uneditableReason` + `UNEDITABLE_MESSAGES`: which blocks can be edited, and the message (task 3.2).
- `src/ui/blockSegments.test.ts` - Reader tests on `test/small-html.ts` shapes (objects, back links/¶/list labels skipped, empty-paragraph and deleted-mark fillers, shared edges); rendering (own segments give the block back, typed word, typo inside an insertion, word changed, typed back, labels/bookmarks/objects/break mark kept, fillers, refused Original); editability.
- `src/engine/applyEdits.ts` - The export's first step: patches each edited block's `w:p` to its final segments (Original-side characters aligned one to one, inserted ones matched per gap; only touched runs split, then joined again) and returns the updated revision list (new `w:ins`/`w:del`, `w:id`s above every id of the text parts, updated `constituentKeys`, emptied revisions dropped); `EditPatchError`; `unpatchableContent`, the one rule for the paragraphs it refuses (also used by task 3.2 and `test/edits.ts`).
- `src/engine/applyEdits.test.ts` - Unit tests on hand-written redline XML: plain runs, formatting from the neighbour, ids, empty paragraph, inside an engine `w:ins` (one and several runs), engine `w:del` partly typed back, typed-back replacement dropped, `w:rPrChange` in split runs, hyperlink, bookmark/comment range, tab/break, note references (plain and inserted), refused content (field, `w:sdt`), unknown revision.
- `test/edits.ts` - Test helpers for inline edits: `scriptEdits` (reader + `applyTextEdit` → patches and new revisions), the scenarios (`scenarioEdit`, `pickScenarios`), `editableBlocks`, `redlineParagraphs` (each `w:p`'s Original/Edited text by unid, and whether `unpatchableContent` refuses it), `segmentsText` / `editedOverrides` for `expectedText`.
- `test/engine-decide.ts` - `engineDecideOne` (a `DocxSession` decision) and `partsXml`, moved out of `src/engine/exportDocx.test.ts` to be shared with the inline-edit checks.
- `test/fixtures/link-bookmark-tab.{original,edited}.docx` - Fixture with edits next to a hyperlink, a bookmark, a tab and a line break (the `field-hyperlink` link paragraph isn't editable: an inserted mark joins into it).
- `src/engine/blockKey.ts` - `paragraphUnids`: the engine's Unid of every `w:p` of a part, i.e. the rendered blocks' `data-anchor` (task 0).
- `src/engine/blockKey.test.ts` - The mapping checked on every fixture and on repeated/empty paragraphs, identical cells, headings and inline objects.
- `test/block-mapping.ts` - `unmappedBlocks(redline, html)`: paragraph blocks whose `data-anchor` names no `w:p` (used by the blockKey, sample and big-pair tests).
- `src/ui/useEdits.ts` - `EditSession` (one per comparison): edit records, derived items / item texts / index / headings, the master document's blocks patched; `update`, `revert`, `revertAll`, `restore`, `revisions()`, `patches()`; `BlockUpdate` (with the items a live edit created); `showBlockUpdates` (panels + accept); the `useEdits` hook.
- `src/ui/useEdits.test.tsx` - Session tests (PRD-16's example, typo inside an insertion, typed back, revert to the compared markup and items, ids never reused, restore and skipped records, heading) and a hook test.
- `src/ui/DocumentPanel.test.tsx` - `replaceBlock` in the side panels (decisions, current, ignored, new items' elements known, dark colours) and the Resolved column; `showBlockUpdates` over three panels.
- `test/small-comparison.ts` - A comparison built without the engine for UI tests of inline edits (`smallComparison`).
- `src/ui/EditableToggle.tsx` - The Edited panel header's toggle (task 4); the Revert all edits button (task 5).
- `src/ui/EditableToggle.test.tsx` - The toggle's pressed state and tooltips; the toast's timer.
- `src/ui/editing.ts` - `PanelEditing`, the Edited panel's editing behaviour: contenteditable on editable blocks (objects `false`), `beforeinput` rules (PRD-11–13, `EDIT_MESSAGES`), plain-text paste (`plainText`), `deletedSpan`, composition, debounce and flushes, input elsewhere than the pending span applied through the model (`applyNow`), cursor save/restore as text offsets (`blockSelection`, `selectInBlock`), Escape; own undo stack and revert ↺ placement (task 5).
- `src/ui/editing.test.ts` - Unit tests (jsdom) for what doesn't need layout or a shadow-root selection: `plainText`, `deletedSpan`, contenteditable on/off and refresh, blocked input types, click messages, debounce, composition, flush on focus loss / Escape / detach, refused update.
- `src/ui/Toast.tsx` - The short status message under the Edited header (PRD-13), `role="status"`, 4 s.
- `e2e/editing.spec.ts` - e2e: toggle and defaults, typing a word (new accepted item, cursor kept), typo inside an insertion, PRD-16's example, blocked actions and messages, footnote reference and moved paragraph, typed shortcut keys, dead key (CDP composition), paste, flush on toggle off / blur / typing elsewhere, heading in the outline, Resolved column (task 4); undo/revert, range warning, Swap confirmation, reload/resume, export round trip (tasks 5, 6).

Changed:
- `src/engine/types.ts` - `ExportRequest.edits` (`BlockEditPatch`); `CompareResult.uneditableBlocks` and its `editable` timing (task 3.2).
- `src/engine/pipeline.ts` - Reports the paragraphs with fields, content controls and other objects the HTML doesn't mark (`uneditableBlocks`, from `unpatchableParagraphs` in `applyEdits.ts`, task 3.2).
- `src/engine/applyEdits.ts` - The alignment moved to `paragraphEdit.ts` (`alignUnits`, shared with `renderBlockSegments`); `unpatchableParagraphs` (task 3).
- `src/engine/exportDocx.ts` - `ExportOptions.edits`: runs `applyEdits` first and passes the patched redline and updated revisions to every later step (the decision check included).
- `src/model/paragraphEdit.ts` - Also `PART_OF_SCOPE` and `editRevisions` (list entries for the revisions edits created) (task 2); `AlignUnit`, `segmentUnits`, `alignUnits` (task 3).
- `src/ui/resolvedView.ts` - `resolvedText` (tests) reads tabs as spaces and drops the mark after a break (task 2: first fixture with them).
- `src/engine/exportDocx.test.ts` - Uses `test/engine-decide.ts`.
- `test/expectedText.ts` - `overrides`: the text of edited paragraphs (by part and `w:p` ordinal).
- `docs/architecture.md`, `docs/measurements.md` - Task 2: "Inline edits" (reading a block, export patch), Export step 0, module map, Testing; export timings with edits.
- `src/engine/engine.worker.ts` - Passes `edits` through.
- `src/model/changes.ts` - `replaceBlockItems`: one block's items replaced (untouched items keep their objects, ids kept, new ones located in the block, `order` renumbered); `locate` takes a fallback scope.
- `src/model/docIndex.ts` - `replaceIndexBlock`: one block's revisions in the HTML and adjacencies replaced (blocks, versions, note references, titles don't change with an edit).
- `src/model/equivalence.ts` - `collectItemTexts` over any root or a map of blocks.
- `src/model/outline.ts` - `editedHeadingBlocks`, `withEditedHeadings`, `editedParagraphText` (outline from the edited headings).
- `src/ui/renderedDocument.ts` - `decorateDocument`, `isolateCommonAffixes`, `markItems`, `markCommon` scoped to a root/block (root included, `within`).
- `src/ui/DocumentPanel.tsx` - `controlRef` (`PanelControl.replaceBlock(unid, block)`, task 3.7; the scroller ref is unchanged); `editing` prop: `PanelEditing` attached while it is set (flushed when turned off, not on a new document), replaced blocks prepared, refreshed when `reasonOf` changes, clicks don't select changes, `document-panel--editing`; side panels swap a block's whole join run (`swapRuns`), the Edited panel unjoined while editing (`setUnjoined`, `markUnjoined`; an update there swaps the block alone, `keepUnjoined`) (task 4).
- `src/ui/renderedDocument.ts` - Task 4: `joinInPanel` (a side panel's joins for some blocks) and `joinRun` (the run a side panel joins a block with).
- `src/ui/resolvedView.ts` / `src/ui/resolvedView.test.ts` - Task 4: `replaceResolvedBlock` assigns id-less ¶ glyphs and deletion markers (`addMarksWithoutIds`, shared with `prepareResolvedPanel`) and keeps what `wrapper.contains`; test for a block whose mark is deleted.
- `src/ui/renderedDocument.test.ts` - Task 4: `joinRun`.
- `test/sample-pair.test.ts` - Task 4: the Resolved column after the scripted updates ≡ one built from the updated document (sides applied for every item whose side changed).
- `src/ui/blockSegments.ts` - Task 4: `visibleOffset` / `visiblePoint` (cursor ↔ visible-text offset; char entries keep their text node), a `<br>` with no text after it (the browser's placeholder) is skipped.
- `src/ui/useEdits.ts` - Task 4: `EditSession.blockElement(unid)`, `visibleText(unid)`.
- `src/ui/resolvedView.ts` - `replaceResolvedBlock(handle, old, block)`: restore the run of joined paragraphs, swap, rebuild the items' elements/markers/children/note references/item notes, join again, apply the sides; `follows` without the `Node` global.
- `src/ui/resolvedView.test.ts` - `replaceResolvedBlock` ≡ a panel prepared from the updated HTML (comment icon, joined run, note reference).
- `src/ui/panel.css` - Editable styles (cursors, focused block; ↺ button in task 5), no style text written at run time.
- `src/ui/useKeyboardShortcuts.ts` - Typing targets found through `composedPath()`.
- `src/ui/useKeyboardShortcuts.test.tsx` - A key from an editable element inside a shadow root is not a shortcut.
- `src/App.tsx` - `useEdits`, derived values instead of `comparison.analysis.items`/`itemTexts`/headings, panel `controlRef`s, export with `revisions()`/`patches()`, `useSameSet` for `ignored`/out-of-range (task 3); Editable state (off per review), `reasonOf` / `textOf` / `applyEdit` (`EditingOptions`), toast, card hidden while editing (task 4); Swap confirmation, range warning, resume order, autosave of edits.
- `src/ui/RangeControl.tsx` - Asks before an end point that leaves edited paragraphs outside the range (PRD-24a).
- `src/ui/HelpPopover.tsx` - A line about Editable (shortcuts off while typing, Escape).
- `src/storage/reviewStore.ts` / `src/storage/reviewStore.test.ts` - `edits` in `ReviewState` and `sanitizeState`.
- `src/ui/useReviewStorage.ts` - Saves the edits with the rest of the state.
- `src/index.css` - Toggle, toast and the editing panel's outline (task 4), Revert all (task 5); tokens, light and dark.
- `test/fixtures/make-fixtures.ts` - Fixture `link-bookmark-tab` (task 2).
- `test/edits.ts` - `editableBlocks` uses `uneditableReason` (task 3).
- `src/ui/renderedDocument.test.ts`, `src/model/{changes,docIndex,equivalence,outline}.test.ts`, `src/ui/useComparison.test.tsx` - Block-scoped decoration, `replaceBlockItems`, `replaceIndexBlock`, `collectItemTexts` from a block, edited headings; `uneditableBlocks` in the fake result (task 3).
- `test/fixture-pairs.test.ts`, `test/sample-pair.test.ts` - Inline edits: `uneditableBlocks` ≡ the paragraphs the patch refuses, rendering a block with its own / edited segments (task 3), the sample's update through `EditSession` with timings (task 3.10); segments ≡ redline paragraph text on every fixture, self-patch is a no-op, scripted edits (accept/reject/alternating ≡ `expectedText` with overrides, `verifyDeliverable`, each engine revision of the patched redline ≡ `DocxSession`), a heading edit (small generated pair), on the sample body + footnote edits and an undecided edited item tracked (FR-38b); the sample's block mapping (task 0).
- `test/big-pair.test.ts` - The ~300-page pair's block mapping and its time (task 0).
- `e2e/perf.spec.ts` - Update timing after typing (`PERF=1`).
- `src/ui/DocumentPanel.test.tsx` - Task 4: editing mode (editable blocks, no click-to-select, message, replaced block prepared, flush on turning off but not on a new document).
- `src/ui/blockSegments.test.ts` - Task 4: the browser's placeholder `<br>`, `visibleOffset` / `visiblePoint`.
- `docs/requirements.md`, `docs/architecture.md`, `docs/measurements.md`, `CLAUDE.md` - Task 8 (`docs/architecture.md`: "Block mapping" and the module map entry added in task 0; the "Inline edits" section's segment model and the `paragraphEdit.ts` module map entry added in task 1; rendering a block, editability, live review state and panels, `useEdits.ts` in the module map, added in task 3; `docs/measurements.md`: `uneditableBlocks` time and the jsdom update timings, task 3; "Editing in the panel" and the module map entries for `editing.ts`, `EditableToggle.tsx`, `Toast.tsx`, task 4).

### Notes

- Unit tests sit next to the code (`foo.ts` + `foo.test.ts`); e2e tests in `e2e/`.
- `npm test` runs Vitest (project `unit`: jsdom, `src/**/*.test.ts(x)`; project `engine`: Node with the real WASM, `src/engine/**/*.test.ts` and `test/**/*.test.ts`). One file: `npx vitest run src/model/paragraphEdit.test.ts`.
- `npm run test:e2e` runs Playwright against a `vite preview` build (`PERF=1` adds the timing checks); `npm run typecheck` runs `tsc --noEmit`.
- Run everything from the repo directory so asdf picks Node 24.22.0 (`node --version`).
- Commit on `main` (solo repo), after each top-level task at least.
- e2e specs written for two columns pin the view (`pinView`, `e2e/viewSettings.ts`).

## Instructions for Completing Tasks

**IMPORTANT:** As you complete each task, you must check it off in this markdown file by changing `- [ ]` to `- [x]`. This helps track progress and ensures you don't skip any steps.

Example:
- `- [ ] 1.1 Read file` → `- [x] 1.1 Read file` (after completing)

Update the file after completing each sub-task, not just after completing an entire parent task.

## Tasks

### 0.0 Spike

**Specs**

- Three questions, each answered with evidence in this file (a "Findings" paragraph under the task)
  and later in `docs/architecture.md` (task 8):
  1. **Block ↔ `w:p` mapping** (PRD §7 "Mapping a block"). Candidates: (a) reimplement
     `UnidHelper.ContentSignature` (`refs/Docxodus`) in TypeScript over the redline XML, producing
     the same unids as `data-anchor`; (b) the paragraph's ordinal within its part (body, footnotes,
     endnotes; table cell paragraphs in document order) matched to the rendered blocks of that
     scope in order, verified by the block's Original/Edited text vs. the `w:p`'s rejected/accepted
     text. Pick the one that matches on **every** fixture, the sample and the ~300-page pair
     (`BIG_PAIR=1`). The key saved in reviews is what it produces (unid or `scope:ordinal`).
  2. **Selection in an editable block inside the panel's shadow root:** does
     `getSelection().getComposedRanges({ shadowRoots: [root] })` (fallback
     `shadowRoot.getSelection()`) give the right node/offset at a click, after typing, and after
     the block's markup is rewritten and the cursor restored? Check in Chromium and Firefox.
  3. **Cost of one block update** on the ~300-page pair, before building it properly: replace one
     block's HTML in the three panels' DOMs, re-run the `App.tsx` memos that read items (`ignored`,
     `classify`, `spanning`, `reviewable`, `resolvedItemDecisions`, `buildReviewList`) with one item
     added, and time it. Budget: 100 ms for the whole update (PRD goal 3).
- Spike code is throw-away: scratch tests or a scratch branch-free file deleted afterwards. Nothing
  in `src/` changes in this task except `src/engine/blockKey.ts` if the mapping is kept.

**Depends on:** `refs/Docxodus` (unid hash), `src/engine/pipeline.ts` (`runCompare`), `test/fixtures/`, `test/samples.ts`, `test/big-pair.ts`, `src/model/docIndex.ts`.

- [x] 0.0 Spike
  - [x] 0.1 Read `UnidHelper.ContentSignature` and where the converter stamps `data-anchor` in `refs/Docxodus`; note what goes into the hash (text, descendant element names; attributes don't count) and whether the redline XML alone is enough to recompute it.
  - [x] 0.2 Try mapping (b) (ordinal + text check) in a scratch Vitest file over every fixture and the sample: for each rendered `[data-anchor]` paragraph block, find its `w:p` and compare texts. Log mismatches. Also check that **character offsets** agree between the block's HTML text and the `w:p`'s XML text with inline objects as one placeholder each (tabs, breaks, `w:sym`, no-break hyphens, note references, field results, list labels absent in XML); list the cases that differ.
  - [x] 0.3 If (b) has mismatches, try (a); if both work, prefer the simpler (b) unless (a) is needed for robustness. Write the chosen function to `src/engine/blockKey.ts` with `blockKey.test.ts` over fixtures + sample (+ big pair behind `BIG_PAIR=1`).
  - [x] 0.4 Selection check: a scratch page (`npm run dev`, a test route or a small HTML in the scratchpad served by Vite) with a shadow root, a `contenteditable` paragraph containing `ins`/hidden `del`/a `contenteditable=false` footnote ref. Ask the user to click and type by hand (never drive their display), or use a Playwright scratch spec. Record what `getComposedRanges` and the fallback return in Chromium and Firefox.
  - [x] 0.5 Timing check on the ~300-page pair: a scratch Playwright spec (or the browser console on `npm run preview`) replacing one block's HTML in all three panels and re-running the item memos; record the numbers.
  - [x] 0.6 Write the findings under this task (mapping chosen, key format, selection API and fallback, timings, anything that changes later tasks), adjust the later tasks if needed, delete scratch files, commit `blockKey.ts` and the findings.

**Findings** (2026-10-18; scratch tests deleted, numbers from Node 24 / Chromium 156 / Firefox 157)

1. **Mapping: (a), the Unid hash** (`src/engine/blockKey.ts`, `paragraphUnids`; described in
   `docs/architecture.md`, "Block mapping"). The converter assigns Unids on the tagged redline as
   given (`HtmlConversionOps.AssignAnchorUnids` → `UnidHelper.AssignToAllElementsDeterministic`,
   before revision handling and markup simplification, whose rewrites keep the attribute); the
   redline has no Unids of its own, attributes don't count, so the untagged redline gives the same
   values. (a) found every paragraph block's `w:p` on all 21 fixtures, a scratch pair with tabs /
   breaks / `w:sym` / no-break and soft hyphens / bookmark / `w:fldSimple` / inline `w:sdt` / `w:cr` /
   `w:ptab`, the sample (775 blocks) and the ~300-page pair (3,036 blocks). (b), the ordinal, matched
   too, but (a) is exact by construction, needs no second key, and doesn't depend on which `w:p` the
   converter renders (text boxes are written twice, `mc:Choice` + `mc:Fallback`; an ordinal would
   count both). Cost: 174 ms for the ~300-page body part in Node (Web Crypto, hashed level by level in
   parallel), in the worker. `table`/`tr`/`td` also carry `data-anchor`; only paragraph blocks
   (`p`, `h1`–`h6`; anchor kinds `p:`/`h:`/`li:`) map to a `w:p`.
   **Key format: the block's unid itself** (its `data-anchor`), plus its scope (`body`/`fn`/`en`)
   to pick the part. So `BlockEdit.blockKey` and `unid` are the same value: tasks 1, 2, 6 use `unid`
   (+ `scope` where the worker needs the part) instead of a separate `blockKey`.
2. **Text offsets, HTML vs XML** (per version; objects one placeholder each). They agree once these
   rendering rules are applied by the reader (task 2.6) and the XML walk (task 2.2):
   - the converter renders some spaces as **NBSP** (e.g. the last space of a span) and the sample's
     XML has real NBSPs: same length, so compare/diff with NBSP ≡ space; browsers also type NBSPs in
     `contenteditable`;
   - `w:tab` → empty `span[data-docx-tab]`; `w:br`/`w:cr` → `<br>` followed by a U+200E text mark
     (skip it); `w:footnoteReference`/`w:endnoteReference` → `a.footnote-ref`/`a.endnote-ref` with the
     number as text: each one placeholder;
   - `w:sym` → one private-use character (U+E000–U+F8FF) in a plain span; `w:noBreakHyphen` → a
     plain `-`; neither is marked in the HTML;
   - `w:softHyphen`, `w:ptab`, `w:footnoteRef`/`w:endnoteRef` (inside the note), `w:instrText`,
     `w:fldChar`, `w:bookmarkStart/End` (an empty `a#name`), `w:proofErr`, `w:lastRenderedPageBreak`:
     no text on either side;
   - field results (complex and `w:fldSimple`) and inline `w:sdt` content render as **plain text**
     with nothing marking them;
   - a block with a deleted paragraph mark ends with a `<span> </span>` before the `¶` glyph, and an
     empty paragraph renders a space filler: not document text (such blocks aren't editable anyway,
     but the reader must not count the filler of an empty paragraph).
   Consequence for task 3.2: what the HTML doesn't mark (fields, inline `w:sdt`, `w:sym`,
   `w:noBreakHyphen`, `w:ptab`, drawings/`w:pict`/`w:object`/`mc:AlternateContent`, nested
   paragraphs; images not tested) can only be detected in the XML. The worker reports it per block
   at compare time (`CompareResult.uneditableBlocks`, unid → reason, from `paragraphUnids`), and those
   paragraphs are not editable (PRD-12, message "contains a field or object that can't be edited
   here").
3. **Selection in the shadow root:** `getSelection().getComposedRanges({ shadowRoots: [root] })`
   gives the right text node and offset in **both** browsers: at a click, after typing, after the
   block's markup is rewritten and the cursor restored, and for a range. `shadowRoot.getSelection()`
   works in Chromium only (same values); Firefox lacks it. `document.getSelection()` must **not** be
   used: Chromium reports `BODY:0` for a cursor placed by a click (Firefox reports the shadow nodes).
   Restoring with `getSelection().setBaseAndExtent(node, offset, …)` on shadow text nodes works in
   both. `getComposedRanges` returns start/end only; for a backward selection, keep the direction
   from `Selection.direction` if it matters.
   Events (both browsers): at `window`, `event.target` is the shadow host and `composedPath()[0]` the
   editable paragraph (task 4.1 confirmed). Enter / Shift+Enter / Backspace / Ctrl+Z give cancelable
   `beforeinput` (`insertParagraph`, `insertLineBreak`, `deleteContentBackward`, `historyUndo`), and
   cancelling leaves the text as it was; **Ctrl+Shift+Z fires no `historyRedo`** (nothing to redo
   natively), so redo must come from `keydown` (task 5.1). Typing right after an `ins` lands **inside**
   the `ins` in both: derive ownership from the text diff (as PRD §7 says). For e2e (task 4.10):
   Playwright's `keyboard.insertText` is a cancelable `insertText` in Chromium but a non-cancelable
   `insertCompositionText` in Firefox; a composition in Chromium needs CDP `Input.imeSetComposition`.
   (Playwright's Firefox was installed for the spike: `~/.cache/ms-playwright/firefox-1555`.)
4. **Cost of one update.**
   - Item memos (`ignored`, `classify`, `spanning`, `outOfRange`, `reviewable`, `resolvedSides`,
     `formatting`, `entries`, `order`, `itemById`, `labelById`, `totals`) with one item added and
     every item a new object (renumbered `order`), ~300-page pair (1,545 items), Node: **10 ms**
     (median of 7), of which `ignoredItems` 9 ms (it normalizes every item's text; make it
     incremental, or cache per item, if the update gets tight). Renumbering the items: 0.1 ms.
   - DOM, one block replaced in the three panels (built app, Chromium, three columns): the swap
     itself < 1 ms; forced style + layout 6–11 ms per panel. **Sample:** the update frame's rendering
     work is 8.5 ms (Layout 3, Paint 1.5, PrePaint 1.1), the frame comes as fast as an idle one
     (~30 ms); one decision takes 23 ms, Accept all 64 ms. **~300-page pair:** the update frame is
     **65–80 ms** of rendering alone (trace: Paint 39, PrePaint 16.5, Layout 15; script ≈ 0), the same
     as any frame whose layout changes there (scrolling a panel gives 55–70 ms tasks too); one
     **decision already takes 149 ms** and Accept all 360 ms.
   - So the 100 ms budget (PRD goal 3, success metric 5) holds with room on the sample. On the
     ~300-page pair the browser's own paint/layout of the long documents takes most of it before any
     of our code, and a decision is over it today: an update there will be about as slow as a
     decision (~150 ms). Meeting 100 ms there needs rendering work outside this feature (e.g.
     `content-visibility: auto` on blocks, which affects scroll sync's offsets). **Decided
     (2026-10-18):** on the ~300-page pair the target is "no slower than a decision" (~150 ms): it
     runs once when the reviewer stops typing, not per keystroke. The sample keeps 100 ms (task 8.1).

### 1.0 Paragraph edit model (pure)

**Specs**

- Types (in `src/model/paragraphEdit.ts`):
  ```ts
  type Segment =
    | { kind: 'equal'; text: string; source: string }                         // text in both versions
    | { kind: 'del'; text: string; itemId: string; revisionId: string; source: string }
    | { kind: 'ins'; text: string; itemId: string; revisionId: string; source: string }
    | { kind: 'object'; key: string };                                         // note ref, list label, image, field, tab, break
  interface BlockEdit { unid: string; scope: BlockScope; original: Segment[]; current: Segment[] }  // unid = the block key (task 0)
  ```
  `source` is not stored as a run index (HTML spans and XML runs don't correspond): new text takes
  the formatting of its neighbouring character (PRD-18, PRD §7 "Formatting source"), so `source`
  can be dropped or kept only for `equal`/engine segments read from the HTML. `original`
  is the block as the comparison produced it (for revert and the replay check, PRD-22, 26).
- `visibleText(segments)` = Edited text (no `del`, objects as a placeholder char that is never
  editable). `originalText(segments)` = no `ins`.
- `applyTextEdit(segments, newVisible, ids)`: diff old visible text → new visible text (common
  prefix/suffix is enough: an edit is one contiguous span; a paste replacing a selection is too),
  then apply PRD-16 / PRD §7 "segment model":
  - inserted characters inside an `ins`, or continuing one of its words with no space between, join
    it; elsewhere they form a new `ins`;
  - deleted `equal` characters become a new `del`; deleted `ins` characters shrink it;
  - objects can't be deleted (the caller blocks it; `applyTextEdit` throws if asked);
  - normalise only the touched span: widen new pieces to whole words (FR-7), merge touching new
    `del`/`ins` into one new item (a Replaced), drop a new `ins`+`del` pair with equal text, merge
    adjacent segments of the same kind and owner;
  - an existing item whose segments are all gone disappears (its id is no longer in the result).
- Ids: new item and revision ids are `e<unid>.<n>`, `n` counting up per block in order of creation
  and stored in the edit, so replay gives the same ids (PRD §7 "Ids"). A new item's `del` and `ins`
  get two revision ids (`…a`/`…b` or consecutive `n`), the item id is the first.
- `revertBlock(edit)` returns `edit.original`.
- No DOM, no React: usable in the worker.

**Depends on:** nothing new; follows `ChangeItem` (`src/model/changes.ts`) and `countWords`.

- [x] 1.0 Paragraph edit model (pure)
  - [x] 1.1 Create `src/model/paragraphEdit.ts` with the types, `visibleText`, `originalText` and the id helper. Typed text is normalized to NFC before it is applied (PRD-18).
  - [x] 1.2 Implement the edit span (old → new visible text) and applying it to the segments without normalisation; unit tests for insert/delete/replace at the start, middle, end, inside `ins`, across `equal`/`ins` boundaries.
  - [x] 1.3 Implement the ownership rules (inside / continuing a word of an `ins`) and the "never join an existing item" rule; unit test PRD-16's `the [big] red [house]` example (three items, decisions untouched).
  - [x] 1.4 Implement whole-word widening and the local normalisation; tests: a typo fixed inside a word of `equal` text gives `del "hosue"` + `ins "house"`; typing the Original back removes the item; deleting all of an insertion removes the item.
  - [x] 1.5 Implement `revertBlock` and replay determinism (applying the same sequence of edits from `original` gives identical segments and ids); tests.
  - [x] 1.6 Add a function giving the block's items from its segments (`kind`, `removedText`, `addedText`, `wordDelta`, `revisionIds`) in `ChangeItem` shape, keeping existing items' ids, kinds recomputed (Inserted / Deleted / Replaced); tests.
  - [x] 1.7 `npm run typecheck`, `npm test`; commit.

**Notes** (task 1, for later tasks)

- `BlockEdit` also holds `nextId` (as the saved record in task 6 does). `ObjectSegment` has an
  optional `owner` (`{ change, itemId, revisionId }`) for an object that is inserted or deleted
  content (e.g. an inserted note reference): it is hidden in the view that lacks it. No segment
  stores a formatting `source`: the renderer (3.1) and the patch (2.2) find formatting by text
  offset from the neighbouring character.
- `applyTextEdit` takes `{ unid, nextId, caret? }` and returns `{ segments, nextId,
  createdItemIds }`. The edit is the common prefix/suffix span of the old and new visible text, so
  edits at two places in one paragraph within one debounce become one span (unchanged text and
  items between them would be replaced): task 4.5 must also flush when the cursor moves away from
  the pending edit (`selectionchange` outside the changed span), not only on blur.
- `blockItems(edit, { items, revisions })` needs the current items and the engine's revision texts
  (`RevisionText`) to keep revisions outside the block and engine texts of untouched revisions
  (task 3.4).
- A new piece never joins an existing item, including the reviewer's own earlier ones: typing
  "big" and, after a pause, " dog" gives two items.

### 2.0 Export with edits

**Specs**

- `ExportRequest.edits?: { unid: string; scope: BlockScope; segments: Segment[] }[]` (`src/engine/types.ts`), plus
  the new revisions' `RevisionListEntry`s in `revisions` (from task 1.6, without `constituentKeys`).
- `applyEdits(files, revisions, edits) → revisions'` in `src/engine/applyEdits.ts`, first step of
  `exportDocx` (`src/engine/exportDocx.ts`); every later step (`planConsistentLook`,
  `planRangeOrder`, `rejectRevisions`, `trackedRevisions`, `reconcileNotes`, comments) gets
  `revisions'`.
- Patch rules (PRD §7 "Export"):
  - find the `w:p` by its unid with `paragraphUnids` on the scope's part (task 0);
  - walk its text runs in order (also inside `w:hyperlink`, `w:ins`, `w:del`, `w:smartTag`) and map
    segment character offsets onto them (inline objects one placeholder each, as in the reader;
    the per-element rules are in task 0's findings, item 2);
    split `w:r` at segment boundaries; new text copies the `w:rPr` of the run holding the
    neighbouring character (before, else after);
  - new `ins` → `w:ins` with a new integer `w:id` (above the part's max `w:id`), `w:author`/`w:date`
    as the engine's (look at an existing revision in the redline); new `del` → `w:del` with
    `w:delText`; shrunk/extended engine `ins`/`del` change text in place; a split engine element
    gets new ids for the extra elements, added to its revision's `constituentKeys`; elements
    removed entirely drop their keys;
  - every other child (`w:bookmarkStart/End`, `w:commentRangeStart/End`, `w:fldChar`, `w:instrText`,
    `w:footnoteReference`, `w:proofErr`, `w:hyperlink` itself) stays in place;
  - xmldom only; copy live node lists into arrays before changing the document.
- Paragraphs the patch can't handle safely (e.g. `w:sdt`, a complex field whose result spans the
  edit) are reported in task 0/2 findings and made non-editable (task 3.2's editability check), not
  patched.
- Correctness (success metrics 1–2): with scripted edits, accept all ≡ the edited Edited text, reject
  all ≡ Original text, mixed decisions ≡ the `test/expectedText.ts` model extended with edits;
  exports pass `verifyDeliverable` and `scripts/check-libreoffice.sh`; on fixtures, each single
  revision decided against the rest ≡ `DocxSession`'s decision on the **patched** redline.

**Depends on:** task 0 (`blockKey`), task 1 (segments, ids), `src/ui/renderedDocument.ts` (prepared HTML, for the reader in 2.6); `src/engine/exportDocx.ts`, `rejectRewrite.ts`, `ooxml.ts` (`ElementIndex`, `parseConstituentKey`, `W_NS`), `trackedRevisions.ts`, `test/text.ts`, `test/deliverable.ts`, `test/expectedText.ts`.

- [x] 2.0 Export with edits
  - [x] 2.1 Add `edits` to `ExportRequest` and pass it through `engine.worker.ts` / `client.ts` (no behaviour yet); typecheck.
  - [x] 2.2 Write `applyEdits` for plain runs (no engine revisions in the paragraph): insert, delete, replace; unit tests on hand-written XML (`test/minimal-docx.ts` style).
  - [x] 2.3 Extend to paragraphs with engine `w:ins`/`w:del`: text changed inside, split elements with new ids and keys, removed elements; unit tests.
  - [x] 2.4 Keep non-run children in place (hyperlink, bookmark, comment range, field, footnote reference); unit tests, plus the `field-hyperlink` fixture.
  - [x] 2.5 Call `applyEdits` first in `exportDocx` and pass the updated revisions on.
  - [x] 2.6 The segment **reader** in `src/ui/blockSegments.ts`: a rendered block's segments (equal/del/ins/objects, item and revision ids from `data-change-id`/`data-author`). Skip `NOT_TEXT` as `DocIndex` does; the shared-edge pieces of replacements (`data-common-needs`) belong to their item. Tests on `test/small-html.ts` shapes and every fixture's blocks (the text of the segments equals the block's Original/Edited text). Then a test helper that applies scripted edits to a compared fixture/sample with it and `applyTextEdit`, returning `edits` + new revisions.
  - [x] 2.7 Round-trip checks in `test/fixture-pairs.test.ts`: per fixture, a few scripted edits (insert a word, delete a word, edit inside an insertion, edit between two changes, typing the Original back); accept-all / reject-all text, `verifyDeliverable`, single-revision decisions vs `DocxSession` on the patched redline.
  - [x] 2.8 Same on the sample in `test/sample-pair.test.ts` (shared compare): edits in body, table cell, footnote, heading; mixed decisions vs extended `expectedText`; FR-38b (`track`) export with an undecided edited item.
  - [x] 2.9 `scripts/check-libreoffice.sh` on exports written with `EXPORT_DIR`.
  - [x] 2.10 `npm run typecheck`, `npm test`; commit.

**Notes** (task 2, for later tasks)

- The export request carries `edits: { unid, scope, segments }[]` (the blocks' `current`
  segments) and, in `revisions`, the engine's revisions plus `editRevisions(edit)` of every edited
  block; decisions are needed for the revisions as they are **after** the patch (engine revisions the
  edits emptied are dropped by `applyEdits` and need none; extra decisions are harmless). Comments
  naming a dropped revision skip it (`anchorComments` ignores unknown ids).
- `applyEdits` refuses (`EditPatchError`, reported as the worker error code) a paragraph with
  content it can't keep in place: anything but runs of `w:t`/`w:delText`/tab/break/note
  references/zero-width marks, `w:ins`/`w:del` (not nested), `w:hyperlink`/`w:smartTag` (not inside
  a change), bookmarks, comment ranges, `w:proofErr`, `w:permStart/End`. The rule is
  `unpatchableContent`; task 3.2's `uneditableBlocks` and `test/edits.ts` (`redlineParagraphs`,
  `editableBlocks`) use it rather than a list of their own.
- The sample has no editable heading (every `h*` block has a paragraph-mark change) and no table:
  those are covered by the fixtures and a small generated pair.
- The reader works on the **decorated, unjoined** master document (`prepareRenderedDocument`); a
  panel's joined copy would read wrong.

### 3.0 Live review state with edits

**Specs**

- A `Comparison` stays immutable; a new one still means a new review (`src/App.tsx`, the
  `reviewedComparison` check). Edits live in `useEdits(comparison)`:
  ```ts
  interface EditsState { blocks: Map<string /* unid */, BlockEdit>; nextIds: Map<string, number> }
  useEdits(comparison) → {
    edits: EditsState;
    items: ChangeItem[]; itemTexts: Map<string, ItemText>; index: DocIndex; headings: {…};
    createdItems: string[];                      // new items of the last update (to accept)
    update(unid, newVisibleText): BlockUpdate;   // { html, removedItemIds, addedItemIds }
    revert(unid): BlockUpdate; revertAll(): BlockUpdate[]; restore(saved): void;
    revisions: RevisionListEntry[];              // engine revisions + edit-created ones, for the export
  }
  ```
  Reset when `comparison` changes.
- **Item ids never change** for existing items (PRD §7 "Ids"); items of other blocks are reused as
  objects (same identity) so memos keyed on them stay cheap; `order` renumbered.
- New items get `accepted` (dispatch `set` per created item) **only** when a live edit just
  allocated their id; never on replay, undo/redo or revert, which bring back items whose
  decisions are already in the state (PRD §7 "Saved review"). Existing items' decisions and comments
  untouched; removed items' decisions/comments stay in state (PRD-16, 22).
- In `App.tsx`, every use of `comparison.analysis.items`, `comparison.itemTexts` and the outline's
  headings switches to `useEdits`' values (`ignored`, `range`, `spanning`, `outOfRange`, `reviewable`,
  `resolvedSides`, `entries`, `itemById`, `labelById`, `totals`, `bubbleComments`, export,
  `exportCounts`). `blockPositions` / `outOfRangeBlocks` stay on the comparison.
- Block HTML: `blockSegments` renders segments to the converter's markup; then the master document
  (`comparison.document.body`) gets the decorated block (`decorateDocument`, `isolateCommonAffixes`,
  `markItems(change-as-formatting)` scoped to the block).
- `DocumentPanel` ref gains `replaceBlock(unid, html)`: import the HTML, swap the block (left/right:
  undo/redo `mergeJoinedParagraphs` locally, though editable blocks are never join targets),
  update `elementsRef`, `blocksRef`, `styledRef` (+ dark colours), apply ignored/common/out-of-range
  classes, decisions, current; then `CONTENT_CHANGED`. Resolved: `resolvedView.replaceBlock`.
- The Resolved column: `replaceBlock(handle, unid, html)` restores the whole run of joined
  paragraphs containing the block (`runOf`/`restore`), swaps it, rebuilds the handle's maps for its
  elements (markers via `insertMarkers` for its items, `children`, `itemNotes`, comment toggles),
  then `applyResolution` for its items and joins again (CLAUDE.md: restore the whole run).
- Outline: `buildOutline` gets the edited headings (a heading's text replaced when its block is
  edited, PRD-20).
- Performance: one update < 100 ms on the ~300-page pair (task 0 numbers).
- No editing UI yet: covered by unit tests, and by a jsdom test rendering `App`-like wiring, not by a
  hook shipped in production.

**Depends on:** task 0 (timings, mapping), task 1; `src/App.tsx`, `src/ui/DocumentPanel.tsx`, `src/ui/resolvedView.ts`, `src/ui/renderedDocument.ts`, `src/model/{changes,docIndex,equivalence,outline}.ts`.

- [x] 3.0 Live review state with edits
  - [x] 3.1 In `src/ui/blockSegments.ts` (reader from task 2.6), render segments back to block HTML in the converter's markup. Tests on `test/small-html.ts` shapes and every fixture's blocks: block → segments → HTML → segments is identity.
  - [x] 3.2 Editability check (PRD-12) in `blockSegments.ts`: in range, no move content, no paragraph-mark revision, not a join target in any panel, not in `uneditableBlocks`. Return a reason for the message (PRD-13). Tests.
    - Worker side first: `CompareResult.uneditableBlocks` (unid → reason) from `runCompare` (`src/engine/pipeline.ts`), via `paragraphUnids` on the redline: every paragraph for which `unpatchableContent` (`src/engine/applyEdits.ts`) gives a reason. Don't write a second list: the export refuses exactly those paragraphs, so a paragraph editable in the panel can always be exported. It covers fields (`w:fldChar`, `w:fldSimple`, `w:instrText`), inline `w:sdt`, `w:sym`, `w:noBreakHyphen`, `w:ptab`, drawings/`w:pict`/`w:object`/`mc:AlternateContent`, nested paragraphs (task 0 findings, item 2: the HTML doesn't mark them), and also `w:customXml`, `w:dir`/`w:bdo`, math, nested `w:ins`/`w:del`, a hyperlink inside a change, and run content such as `w:pgNum`. Map its detail to the PRD-13 message ("contains a field or object that can't be edited here"). Engine test on the fixtures (`field-hyperlink`) and the sample (its time goes into the compare's timings).
  - [x] 3.3 Scope `decorateDocument`, `isolateCommonAffixes`, `markItems`, `markCommon` (`renderedDocument.ts`) and `collectItemTexts` (`equivalence.ts`) to a root/block without changing their whole-document behaviour; existing tests pass unchanged, new tests for a block.
  - [x] 3.4 `DocIndex` and items for one replaced block: functions in `docIndex.ts` / `changes.ts` that replace one block's entries and items, keep other items' identity, keep existing ids, renumber `order`. Tests.
  - [x] 3.5 `useEdits` hook with `update`, `revert`, `revertAll`, derived values, reset per comparison. Hook tests.
  - [x] 3.6 Switch `App.tsx` to the derived values (the export gets `useEdits().revisions` and `edits`); accept created items (live edits only); keep the master `comparison.document.body` patched so a Resolved column mounted later (two → three columns) shows the edits; check that with no edits everything is unchanged (`npm test`, `npm run test:e2e`).
  - [x] 3.7 `DocumentPanel` `replaceBlock` for the side panels (caches, classes, decisions, current, dark colours). jsdom tests.
  - [x] 3.8 `resolvedView.replaceBlock` with join restore/rejoin, markers, notes, comment toggles. Tests: block inside a run of joined paragraphs, a block with a comment icon, a block with a note reference; DOM equals a fresh `prepareResolvedPanel` + `applyResolution` on the updated HTML.
  - [x] 3.9 Outline from edited headings; test.
  - [x] 3.10 Timing of one update in `test/sample-pair.test.ts` (jsdom, logged) for task 8.
  - [x] 3.11 `npm run typecheck`, `npm test`, `npm run test:e2e`; commit.

**Notes** (task 3, for later tasks)

- The App's entry point for an edit is `edits.update(unid, newVisibleText, caret)` (also `revert`,
  `revertAll`, `restore`), then `showBlockUpdates(updates, [leftControl, middleControl,
  rightControl].map((ref) => ref.current), (ids) => dispatch({ type: 'acceptAllUndecided', itemIds: ids }))`.
  Only `update` returns `createdItemIds`; revert/restore never do. Not called anywhere yet (task 4.7).
- `update` takes the block's **visible text** (`visibleText` form: objects as `OBJECT_CHAR`); the
  editing code must read the panel block that way (`readBlockSegments` + `visibleText` works on the
  Edited panel's copy too: hidden `del` is skipped as a change, not by CSS). It returns `null` when
  nothing changed. It throws when `applyTextEdit` does (an object deleted or typed): task 4.4 blocks
  those first.
- `uneditableReason(block, { outOfRange, uneditable })` wants the **master** (or an unjoined panel)
  block; `uneditable` is `comparison.result.uneditableBlocks`; `outOfRange` the out-of-range blocks
  for the right panel (`outOfRangeBlocks(index, endPoint, positions)`, which the App computes as
  `outsideBlocks` but doesn't pass to the right panel). Messages: `UNEDITABLE_MESSAGES`.
- A panel's `replaceBlock` keeps the panel's own `contenteditable` attributes only if task 4 puts them
  back after the swap (the master block has none): set them in `replaceBlock` or after
  `showBlockUpdates`, and restore the cursor after that.
- `EditSession.isEdited(unid)` / `editedBlocks()` give "paragraphs with edits" (task 5: ↺ button,
  Revert all count, Swap/range confirmations); a reverted block keeps its `BlockEdit` (for `nextId`).
- Saved records (task 6) are `BlockEdit`s as they are (`SavedBlockEdit`); `restore` checks `original`
  against the block as compared and reports `skipped`.

### 4.0 Editing in the Edited panel

**Specs**

- `EditableToggle` in the Edited panel's `headerControls`: pencil icon + "Editable", `aria-pressed`,
  tooltips per PRD-1; off for every new review/reload/resume (state in `App`, reset with
  `reviewKey`; not in view settings or the saved review, PRD-3). Both views (PRD-4).
- Editing mode: a class on the right panel's `.doc` (e.g. `doc--editing`) with pre-written CSS in
  `panel.css` (tint/outline, I-beam on editable blocks, arrow elsewhere, PRD-5). Never write new
  style text at run time (CLAUDE.md: restyle cost).
- `contenteditable="true"` only on editable blocks (task 3.2), `contenteditable="false"` on inline
  objects; removed again when editing is turned off.
- Clicks: in editing mode, the right panel's click handler doesn't select changes (PRD-7); other
  panels unchanged. The inline card is not rendered while editing (PRD-6).
- Shortcuts (PRD-8): `useKeyboardShortcuts` uses `event.composedPath()[0]` for the typing check;
  Escape in an editable block blurs it (the App's Escape handler ignores it, `src/App.tsx` ~line 386).
- `beforeinput` rules (PRD-11–13): block `insertParagraph`, `insertLineBreak`, deletes that would
  join blocks or remove an object, cross-block selections, `insertFromDrop`, `formatBold`/`formatItalic`
  (until task 7); `insertFromPaste` → plain text with line breaks/tabs as spaces. Each block shows its
  toast message (`Toast`, `role="status"`, ~4 s, one at a time).
- Update timing (PRD-15): 300 ms after the last input in a block, on blur, on toggle off; never during
  composition, counting from `compositionend`.
- Update (PRD-19): read the block's new visible text → `useEdits.update` → `replaceBlock` in every
  panel → restore the cursor/selection by text offsets in the edited block; no scroll in the Edited
  panel; the other panels keep the text being read in place (as after a decision).
- Selection API per task 0 (`getComposedRanges` / fallback).

**Depends on:** task 3; `src/ui/DocumentPanel.tsx`, `src/ui/useKeyboardShortcuts.ts`, `src/App.tsx`, `src/ui/panel.css`, `src/index.css`.

- [x] 4.0 Editing in the Edited panel
  - [x] 4.1 Fix `useKeyboardShortcuts` for events from inside shadow roots (`composedPath()[0]`); test with an editable element in a shadow root.
  - [x] 4.2 `EditableToggle` component and `App` state (reset per review); test.
  - [x] 4.3 Editing mode in `DocumentPanel` (class, contenteditable on/off by editability, no click-to-select, card hidden), CSS in `panel.css` / `index.css` for light and dark.
  - [x] 4.4 `src/ui/editing.ts`: `beforeinput` rules, plain-text paste, object protection, cross-block selection check; `Toast` with the PRD-13 messages. Typed and pasted text has U+FFFC (`OBJECT_CHAR`) removed: `applyTextEdit` throws on it. jsdom tests for the rules.
  - [x] 4.5 Debounce, blur and toggle-off flush, flush when the cursor leaves the pending edit's span (task 1 notes), composition handling; tests with fake timers.
  - [x] 4.6 Cursor/selection save and restore as text offsets around `replaceBlock`; tests in jsdom and an e2e check.
  - [x] 4.7 Wire the update: read visible text, `useEdits.update`, `replaceBlock` in all panels (the 3.6 path accepts the created items).
  - [x] 4.8 Escape blurs the editable block; App's Escape handler leaves it alone.
  - [x] 4.9 Help popover line about Editable.
  - [x] 4.10 `e2e/editing.spec.ts`: toggle and defaults; type a word → new accepted item in the list, Original/Resolved updated; fix a typo inside an insertion → same item, decision kept; PRD-16's example; blocked actions and messages (success metric 6); `a`/`r`/`j`/`u`/`?` typed as text (metric 7); dead key composition (Playwright `insertText`/IME events); both views.
  - [x] 4.11 `npm run typecheck`, `npm test`, `npm run test:e2e`; commit.

**Notes** (task 4, for later tasks)

- The App's `applyEdit(unid, text, caret)` (`EditingOptions.onEdit`) is the one path from the panel
  to the session: it calls `edits.update`, shows the update in all panels (`showBlockUpdates`,
  created items accepted), and otherwise puts the master block back into the Edited panel
  (`'unchanged'` / `'refused'`). Undo/redo (5.1) and revert (5.2) must not accept anything: use
  `restore` / `revert` and `showBlockUpdates` (which accepts only `createdItemIds`, empty there),
  then `PanelEditing` restores the cursor (`selectInBlock`).
- The browser's `historyUndo`/`historyRedo` are cancelled silently for now; task 5.1 replaces that
  with the own stack (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y on `keydown`: Chromium sends no `historyRedo`
  when it has nothing to redo, task 0).
- `PanelEditing.flush()` returns the outcome; the pending edit's caret is the cursor **after the last
  input**, not the cursor at flush time (it may have moved: passing that one placed the edit wrongly).
  `selectionchange` is asynchronous: an input that arrives outside the pending span before it is
  cancelled and applied through the model after the flush (`applyNow`).
- Timings (built app, three columns, Chromium): sample: Editable on 15 ms, no long task while
  typing or for the update; ~300-page pair: Editable on 228 ms (once), update tasks 51 and 68 ms,
  none while typing. For `docs/measurements.md` (task 8).
- e2e runs Chromium only; Firefox behaviour rests on the task 0 findings (no `ShadowRoot.getSelection`,
  `insertCompositionText` not cancelable: the composition path doesn't cancel anything).
- **Changed after task 4's first commit (2026-10-18, user request: "it is unusable currently"):**
  paragraphs with paragraph-mark changes and join targets are editable (PRD-12 updated). While
  Editable is on, the Edited panel swaps each joined run for unjoined copies (`setUnjoined` in
  `DocumentPanel.tsx`, `joinRun` / `joinInPanel` in `renderedDocument.ts`, CSS `unjoined-empty` /
  `unjoined-continues`); a side panel's `replaceBlock` swaps the block's whole run from the master
  and joins it again (the unjoined Edited panel swaps only the block: fixed after the task 3–4
  review, the cursor in the run's next paragraph was lost); `replaceResolvedBlock` assigns id-less ¶ glyphs / deletion markers as
  `prepareResolvedPanel` does and uses `wrapper.contains` instead of `isConnected`. Wholly deleted
  paragraphs and moves stay uneditable. Task 5's revert/undo go through the same `replaceBlock`.
- **Display setting "left-aligned" (FR-20a, user request, 2026-10-18):** the Edited panel's
  alignment changed when Editable unjoined paragraphs (a joined paragraph takes its target's
  alignment). `ViewSettings.leftAligned` (default on, checkbox in Compare settings → Display);
  `documentLook` in `DocumentPanel.tsx` rewrites `text-align: justify` to `start` with the dark-mode
  colours, in all panels. Files: `useViewSettings.ts`, `CompareSettingsDialog.tsx`, `App.tsx`,
  `DocumentPanel.tsx` (+ their tests), `docs/requirements.md` (FR-20a), `docs/architecture.md`.
- **Fixed (user report, 2026-10-18): an italic word edited in part lost its italics** (display and
  export) unless the text before it was italic too: the whole-word insertion took the formatting of
  the visible character before the deletion. `formattingSource` (`paragraphEdit.ts`) is now the one
  rule for both `renderBlockSegments` and `applyEdits`: typed text right after deleted text takes,
  per character, the formatting of the deleted text (common start/end matched, the changed middle
  from the character before the change: "(kiccavatta)" widens over its plain parentheses), else the
  visible character before, else after (PRD-18 updated).
- CLAUDE.md candidates (task 8.5): `composedPath()[0]` for keys from the panels; the pending edit's
  caret; `hasText` locators in e2e match `textContent`, which includes hidden deletions.

### 5.0 Undo, revert and guards

**Specs**

- Own undo stack per editing session (PRD-21): snapshots of `{ unid, segments, cursor }` pushed per
  update; Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y on `keydown`, and `beforeinput` `historyUndo`/`historyRedo`
  cancelled and handled the same. Also undoes input not yet flushed (flush first). Cleared on toggle
  off and reload.
- Undoing/redoing applies the snapshot through the same path as an update (decisions of items that
  come back are still in state).
- ↺ Revert this paragraph (PRD-22): light-DOM button through a slot (like `InlineChangeCard`,
  `reveal.ts` placement), shown for an edited block while the cursor or mouse is in it.
- Revert all edits (PRD-23): header button next to the toggle while editing and edits exist;
  `ConfirmDialog` with the count.
- Swap (PRD-24): `ConfirmDialog` when edits exist; Close review discards with the rest.
- Range warning (PRD-24a): when a new end point (RangeControl or picking a paragraph) would make
  edited blocks out of range, `ConfirmDialog` ("Move the end point" / "Cancel"); edits kept either
  way.

**Depends on:** tasks 3–4; `src/ui/ConfirmDialog.tsx`, `src/ui/RangeControl.tsx`, `src/App.tsx` (`swap`, `pickParagraph`, `setRangeState`), `src/model/range.ts` (`outOfRangeBlocks`).

- [ ] 5.0 Undo, revert and guards
  - [ ] 5.1 Undo/redo stack in `editing.ts`; tests (incl. after an update rewrote the block).
  - [ ] 5.2 ↺ button and Revert this paragraph; test that items, decisions and comments come back.
  - [ ] 5.3 Revert all edits button with confirmation.
  - [ ] 5.4 Confirmation when edits exist before Swap and before replacing a file with the toolbar's pickers (`Toolbar.tsx` `onFile`).
  - [ ] 5.5 Range warning for RangeControl changes and paragraph picking; tests.
  - [ ] 5.6 e2e: undo after an update, revert one/all, Swap confirm/cancel, range warning confirm/cancel.
  - [ ] 5.7 `npm run typecheck`, `npm test`, `npm run test:e2e`; commit.

### 6.0 Saving and resuming edits

**Specs**

- `ReviewState.edits: { unid: string; scope: BlockScope; original: Segment[]; current: Segment[]; nextId: number }[]`
  (PRD §7 "Saved review"); `sanitizeState` keeps well-formed records, drops others; schema stays 1.
- Autosave includes edits (`reviewState` memo in `App.tsx`).
- Resume order (PRD §7): the decision filter (`known`, `App.tsx` ~line 139) also accepts the item
  ids named in the saved edits' segments, so decisions of edit-created items survive whatever order
  the replay (`useEdits.restore`) runs in. The replay never auto-accepts. A record whose `original` doesn't match the block as compared now is skipped;
  one notice "N edits could not be restored." (PRD-26).

**Depends on:** tasks 1, 3; `src/storage/reviewStore.ts`, `src/ui/useReviewStorage.ts`, `src/App.tsx`, `e2e/resume.spec.ts`.

- [ ] 6.0 Saving and resuming edits
  - [ ] 6.1 `edits` in `ReviewState` and `sanitizeState`; tests (old record without edits, malformed record).
  - [ ] 6.2 Include edits in the saved state.
  - [ ] 6.3 Add saved edit item ids to the decision filter; replay on resume (no auto-accept); skipped-edit notice; tests (a created item rejected before the reload stays rejected).
  - [ ] 6.4 e2e: edit, decide, reload, resume → same text, items, ids, decisions, comments (success metric 4).
  - [ ] 6.5 `npm run typecheck`, `npm test`, `npm run test:e2e`; commit.

### 7.0 Phase 2: bold and italic

**Specs**

- Ctrl+B / Ctrl+I with a selection inside one editable block toggle bold/italic (PRD-33); without a
  selection blocked silently.
- Model: a formatting segment attribute (`bold`/`italic` overrides on a segment) and a formatting
  item per toggled span (`kind: 'formatting'`, into the formatting group, decided by the
  formatting choice).
- Export: the span's runs get `w:b`/`w:i` in `w:rPr` with a `w:rPrChange` holding the old `w:rPr`.
  Check `consistentLook` (FR-39a) with runs that exist only from edits.
- Display: the converter's markup for bold/italic (look at how `format-run` renders) and the
  formatting item's `data-change-id`.

**Depends on:** tasks 1–6; `src/engine/consistentLook.ts`, `test/fixtures/format-run.*`.

- [ ] 7.0 Phase 2: bold and italic
  - [ ] 7.1 Segment formatting overrides and formatting items in `paragraphEdit.ts`; tests.
  - [ ] 7.2 Rendering and the formatting group in the UI; Ctrl+B/I handling in `editing.ts`.
  - [ ] 7.3 Export: `w:rPrChange` in `applyEdits`; round trip with both formatting choices; `verifyDeliverable`, LibreOffice.
  - [ ] 7.4 e2e: bold a word, see it in the formatting group, export with each formatting choice.
  - [ ] 7.5 `npm run typecheck`, `npm test`, `npm run test:e2e`; commit.

### 8.0 Documentation, measurements and final checks

**Specs**

- `docs/requirements.md` (PRD-30): remove "Editing text in the tool" from Non-goals, add "editing
  the Original"; the feature as sub-items (e.g. FR-25d …), never renumbering; mention edits in FR-45
  and FR-46; Design section (Edited header). Update code comments citing `PRD-<n>` to the FR numbers.
- `docs/architecture.md` (PRD-31): new "Inline edits" section (segment model, ownership rule, ids,
  block mapping, live update path, Resolved column `replaceBlock`, export patch, saved records,
  shadow-root selection and shortcuts); module map; Saved review schema.
- `docs/measurements.md` (PRD-32): update timings on the sample and ~300-page pair, export with
  edits.
- `CLAUDE.md`: easy-to-get-wrong facts found during the work (e.g. shortcuts and `composedPath`,
  item ids fixed, patch before every export step).
- `e2e/perf.spec.ts` (`PERF=1`): an update after typing a word within 400 ms of the last keystroke,
  no update task over 100 ms, no task over 50 ms per keystroke (success metric 5).

**Depends on:** tasks 0–7.

- [ ] 8.0 Documentation, measurements and final checks
  - [ ] 8.1 Perf checks in `e2e/perf.spec.ts`; run with `PERF=1` on the sample and the ~300-page pair; record numbers. (Task 0, item 4: on the ~300-page pair a decision already takes ~150 ms and the browser's paint/layout of an update frame 65–80 ms. Decided: there, an update is no slower than a decision; the sample keeps 100 ms; no task over 50 ms per keystroke on both.)
  - [ ] 8.2 `docs/requirements.md` updates and FR citations in code comments.
  - [ ] 8.3 `docs/architecture.md` "Inline edits" section, module map, Saved review.
  - [ ] 8.4 `docs/measurements.md` numbers.
  - [ ] 8.5 `CLAUDE.md` facts.
  - [ ] 8.6 Final run: `npm run typecheck`, `npm test`, `npm run test:e2e`, `PERF=1 npm run test:e2e`, `BIG_PAIR=1` engine tests, LibreOffice on exports with edits; commit.
