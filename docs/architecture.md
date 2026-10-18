# Architecture

How docx-diff works. Requirements are cited as `FR-<n>` ([`requirements.md`](requirements.md));
measured timings and counts are in [`measurements.md`](measurements.md). The short list of engine
facts that are easy to get wrong is in `CLAUDE.md`; this document has the reasoning behind them.

## Stack

| Concern | Choice | Notes |
|---|---|---|
| Comparison, revision list, HTML rendering, final accept pass | **Docxodus** (`docxodus`, MIT, **13.0.0 pinned exactly**), a .NET OOXML engine compiled to WebAssembly | Structure-aware diff producing native Word revisions (`w:ins`/`w:del`/`w:moveFrom`/`w:moveTo`/`w:rPrChange`/`w:pPrChange`/…), move detection, table and note diffs. Round trip `accept(compare(L,R)) ≡ R`, `reject(compare(L,R)) ≡ L` holds on the sample. |
| Applying individual decisions | Our own TypeScript rewrite of the redline XML ([Export](#export)) | The engine's per-revision session API is too slow and invalidates ids ([below](#why-not-docxsession)). |
| `.docx` zip and XML | `fflate` + `@xmldom/xmldom` | Only `word/document.xml`, `footnotes.xml`, `endnotes.xml` are rewritten. `DOMParser` does **not exist in Web Workers**, so worker code uses xmldom (the same code runs in Node tests). The main thread uses the native `DOMParser` for the rendered HTML. |
| UI | React 18 + TypeScript (strict) + Vite | `@tanstack/react-virtual` for the changes list. |
| Engine thread | Our own **module Web Worker** importing `docxodus/core` | The package's `docxodus/worker` proxy has no `listRevisions`/`acceptRevision`/`rejectRevision`/`save`. |
| Persistence | IndexedDB via `idb-keyval` | Input files, hashes, engine version, range, decisions, settings. |
| Offline | `vite-plugin-pwa` (Workbox `generateSW`) | Precaches the app and all engine files. |
| Hashing | Web Crypto SHA-256 | Ties a saved review to the exact files. |
| Tests | Vitest (jsdom unit tests; engine tests in Node with the real WASM), Playwright (Chromium) | See [Testing](#testing). |

The engine is .NET: its algorithm cannot easily be changed from our side, so its bugs are worked
around here or reported upstream. All Docxodus calls go through `src/engine/docxodus.ts` (the only
file that imports `docxodus`), behind the `ComparisonEngine` interface (`src/engine/types.ts`), so the
UI does not depend on the engine.

## Module map

Engine (runs in the worker; also in Node tests)
- `src/engine/types.ts` — `ComparisonEngine`, worker message types, `RevisionListEntry` (our copy of the engine's shape), `CompareResult`, `ExportRequest`.
- `src/engine/settings.ts` — the one `docxDiffCompare` settings object.
- `src/engine/docxodus.ts` — thin wrapper over `docxodus/core`: initialize from `<base>wasm/`, warm-up, version, compare, list, render, `acceptAll` (`docxDiffAcceptRevisions`); `engineVersion()` from `__DOCXODUS_VERSION__`.
- `src/engine/pipeline.ts` — `runCompare`: check inputs for revisions → NFC normalize → read each input's headings and the Edited's author → compare → list → tag → render → the paragraphs inline edits can't change (`uneditableBlocks`), with stage timings.
- `src/engine/engine.worker.ts` / `src/engine/client.ts` — the worker and its main-thread client.
- `src/engine/ooxml.ts` — zip/XML helpers, `parseConstituentKey`, `ElementIndex` (element name + `w:id` lookup).
- `src/engine/normalizeText.ts` — text runs to NFC before comparing (FR-13a).
- `src/engine/headings.ts` — each input's headings, for the outline (FR-24a).
- `src/engine/author.ts` — the Edited's author, to pre-fill the export's (FR-38c).
- `src/engine/tagRedline.ts` — `w:author` → `rev:<id>` before rendering; `unlinkHyperlinksWithChanges`.
- `src/engine/blockKey.ts` — `paragraphUnids`: the redline `w:p` behind each rendered block, by its `data-anchor` ([Block mapping](#rendering-and-linking-html-to-revisions)).
- `src/engine/exportDocx.ts` — the export pipeline; `applyEdits.ts` (inline edits patched into the redline, [Inline edits](#inline-edits)), `rejectRewrite.ts`, `consistentLook.ts`, `rangeOrder.ts`, `trackedRevisions.ts`, `notes.ts`, `comments.ts` — its steps.

Model (pure TypeScript, main thread)
- `src/model/docIndex.ts` — the `DocIndex` built from the rendered HTML.
- `src/model/changes.ts` — `buildChangeItems`: revisions → `ChangeItem[]`.
- `src/model/equivalence.ts` — compare settings, ignored items, same-text relabelling, shared edges.
- `src/model/range.ts` — trailing-region detection, positions, in/out-of-range classification.
- `src/model/analyze.ts` — index + items + suggested end point from a worker result.
- `src/model/decisions.ts` — decision state (decisions, formatting choice, comments) and reducer; `finalItemDecision` (the per-item rule) and `finalRevisionDecisions` for export.
- `src/model/resolved.ts` — `resolvedItemDecisions`: each item's side in the Resolved column (FR-25b).
- `src/model/comments.ts` — the text of the exported comments (FR-27b).
- `src/model/reviewList.ts` — list entries, navigation order, Previous/Next, next undecided.
- `src/model/outline.ts` — the headings for the outline sidebar (FR-24a).
- `src/model/paragraphEdit.ts` — the segment model of inline edits: one text edit applied to a block's segments, ids, the block's items and new revisions ([Inline edits](#inline-edits)); also used by the worker.

UI (`src/ui/`, entry `src/App.tsx`)
- `useEngine`, `useComparison`, `useCompareSettings`, `useExportSettings` (the export dialog's last choices, kept in the browser), `useReviewStorage`/`useAutoSave`, `useKeyboardShortcuts` — the app's state hooks.
- `blockSegments.ts` — a rendered block read as segments of the edit model, segments rendered back into its markup, cursor offsets in its visible text, and which blocks can be edited; `useEdits.ts` — the live review state with inline edits (`EditSession`); `editing.ts` — editing in the Edited panel; `EditableToggle.tsx`, `Toast.tsx` ([Inline edits](#inline-edits)).
- `renderedDocument.ts` — prepares the HTML once for all panels (`joinParagraphs`, `mergeJoinedParagraphs`); `DocumentPanel.tsx` + `panel.css` — one panel in a shadow root; `scrollSync.ts` (any number of panels), `reveal.ts`, `OverviewBar.tsx`.
- `resolvedView.ts` — the Resolved column's DOM logic ([Resolved column](#resolved-column)); `CommentBubbles.tsx` — its comment bubbles; `ColumnsToggle.tsx` + `useNarrowWindow.ts` — two or three columns (FR-25c); `useViewSettings.ts` — view settings kept in the browser (columns, sidebars, inline card).
- `Outline.tsx`, `ChangesList.tsx`, `ChangeCard.tsx`, `InlineChangeCard.tsx`, `Legend.tsx`, `RangeControl.tsx`, `ExportDialog.tsx`, `CompareSettingsDialog.tsx`, `ResumePrompt.tsx`, `Toolbar.tsx`, `ThemeToggle.tsx` + `theme.ts` + `darkColors.ts` (dark mode), `FileDropZones.tsx`, `LoadingModal.tsx` (same markup as the static modal in `index.html`).

Storage: `src/storage/reviewStore.ts`. Service worker registration: `src/serviceWorker.ts`.

## Worker

- Created with `new Worker(new URL('./engine/engine.worker.ts', import.meta.url), { type: 'module' })`.
  It calls `initialize(new URL('wasm/', <app base URL>).href)` and warms the engine up after loading.
- Requests `{ id, type, payload }` (`init`, `version`, `compare`, `export`); responses
  `{ id, ok: true, result } | { id, ok: false, error: { message, code?, revisionId? } }`; progress
  events carry their request's id and reach only that request's listener (a superseded compare still
  running does not move the new one's progress). `ArrayBuffer`s are transferred.
- A worker that fails after loading (e.g. out of memory) puts the app into the engine error state
  with Retry, which replaces the worker. A tab left open across a publish cannot Retry (its worker
  script is gone), so the error says to reload.
- The build copies `node_modules/docxodus/dist/wasm/_framework/**` (without `.br`) to
  `<base>/wasm/_framework/` (`vite-plugin-static-copy` with `rename: { stripBase: true }`), and injects
  the package version as `__DOCXODUS_VERSION__` (`getVersion()` reports only "Docxodus WASM" and the
  .NET version).

## Data flow

1. **Compare** (worker): `docxDiffCompare(original, edited, settings)` → a **redline** `.docx` with
   tracked changes. Settings, exactly:
   ```ts
   {
     preAcceptInputRevisions: true,   // FR-13: compare the accepted view of each input
     compareHeadersFooters: false,    // FR-11: the engine default is true
     trackNumberingChanges: false,    // FR-12: removes numbering-label-only entries
     detectMoves: true,               // default; listed for clarity
   }
   ```
   Never `compareDocuments`: it exposes only `authorName`/`caseInsensitive` and always compares
   headers/footers. Before comparing, `getRevisions` on each input sets `inputsHadRevisions` (FR-13),
   and the inputs' text is normalized to NFC (the engine matches exact code points). Each input's
   headings are read from its own XML (`headings.ts`, for the outline).
2. **List revisions:** `getRevisions(redline)` → `RevisionListEntry[]` (`id`, `type`, `family`,
   `constituentIds`, `constituentKeys`, `text`, `scope`, `anchorId`, `affectedAnchors`,
   `resolutionStatus`).
3. **Tag and render** ([Rendering](#rendering-and-linking-html-to-revisions)). The worker returns the
   **untagged** redline (for export), the revisions and the tagged HTML.
4. **Index** (main thread): `buildDocIndex` parses the HTML: block order from `data-anchor` (these
   match the revisions' `affectedAnchors[].unid`; the redline XML carries **no** anchor ids, the
   engine computes them), which blocks each version has, the Original body paragraphs, which
   revisions touch in the text, note references (`a.footnote-ref[data-footnote-id]`,
   `a.endnote-ref` with `href="#en-<id>"`), table membership, formatting titles, the moved text at
   each end of a move.
5. **Build change items** ([below](#change-items)), then the suggested end point and the
   classification ([Comparison range](#comparison-range)).
6. **Decisions** live in app state and IndexedDB as `itemId → accepted | rejected` (absent =
   undecided) plus one `formattingChoice`. Comparison output is **deterministic** (byte-identical
   redline and identical revision ids for the same inputs and engine version), so item ids — the
   first revision id an item contains — are stable across sessions. That is why the saved review
   records the engine version (FR-49) and why the version is pinned exactly.
7. **Export** ([Export](#export)).

## Change items

`buildChangeItems(revisions, index)` in `src/model/changes.ts`. Formatting revisions (`type: "format"`)
are **interleaved** with content revisions in the engine's list, so the folding and pairing rules walk
the sequence of **non-formatting** revisions:

- **Paragraph marks:** a `paragraph_mark` revision whose text is only `¶` characters joins the
  neighbouring (previous, else next) revision that shares one of its `affectedAnchors` and is not
  itself a bare paragraph mark (moves included); otherwise it is a **Paragraph break** item (FR-9). A
  `paragraph_mark` revision with other text is an ordinary Inserted/Deleted item (the sample's whole
  cut-off tail is one such `delete`).
- **Replaced:** a `content_delete` and a `content_insert` that are neighbours, in **either order**,
  and **touch** in the rendered HTML (no unchanged text other than whitespace between them, same
  paragraph; `DocIndex.adjacentRevisions`) become one item, greedily left to right. Sharing an anchor
  is not enough: in "[del 2. ]Tilos … [ins „szentelt”][del „szentelt"] vizet … [ins orvos][del
  orvosnak]" anchor-only pairing joined "2. " with „szentelt”. A deletion covering a wholly deleted
  last Original paragraph (an unedited tail) is never paired, so an insertion touching its start does
  not hide it from range detection.
- **Moves:** one `move` revision → one Moved item (the entry covers both halves). Moves can carry
  edits: `w:moveFrom` holds the Original wording and `w:moveTo` the Edited one (`ChangeItem.moveEdit`).
- **Formatting:** each formatting revision (`rPrChange`, `pPrChange`, `sectPrChange`, table property
  changes) → one item in the formatting group. Descriptions come from the HTML `title` of the
  revision's elements.
- **Whole notes** (`foldWholeNotes`): a footnote/endnote only one version has, whose references are
  all deleted (inserted) content, joins the item of the revision that deletes (inserts) its first
  reference. Decided apart, keeping the reference while accepting the note's deletion left a footnote
  number pointing to an empty note. A note both versions have — edited, or its reference moved (which
  the engine reports as deletion + insertion of the same note id) — keeps its own items.

After rendering, on the main thread (`renderedDocument.ts`, `equivalence.ts`):
- Items whose text is identical before and after are relabelled as formatting (FR-13b,
  `change-same-text`); a typed list number replaced by automatic numbering is combined with its
  paragraph-properties change into one formatting item (`combineTypedListNumbers`).
- `collectItemTexts` gives each text change's paragraph text before and after applying only that
  change; `ignoredItems` compares them under the compare settings (FR-13c). `commonAffixes` /
  `isolateCommonAffixes` split the shared edges of replacements into their own `ins`/`del` elements
  (`data-common-needs`), marked plain (`change-common`) when the current settings cover them: a child
  element cannot undo its parent's strikethrough.

## Rendering and linking HTML to revisions

- `convertDocxToHtml(tagged, { renderTrackedChanges: true, renderFootnotesAndEndnotes: true,
  renderMoveOperations: true, stampAnchors: true })`, **once**. Every panel shows this same HTML in a
  shadow root of its own: the left hides `<ins>` and move-to content via CSS, the right hides `<del>`
  and move-from content (`.doc[data-side=left|right]` in `panel.css`); the Resolved column hides per
  item, by class ([Resolved column](#resolved-column)).
- **Revision ids:** the converter emits no revision id on `<ins>`/`<del>` (only `data-author`,
  `data-date`, and `data-move-id` for moves), and one revision can render as many elements (195
  deletions → 4,333 `<del>` on the sample), so matching by order is impossible. `tagRedline` rewrites
  the `w:author` of each revision's markup to `rev:<revisionId>` before rendering; the HTML carries it
  as `data-author`, and `renderedDocument.ts` adds `data-change-id` (the item id). Per-author CSS rules
  (`[data-author="…"]`) the converter may emit are dropped. Export uses the untagged redline.
- Every content, move and paragraph-mark revision appears in the HTML; some formatting revisions
  (formatting of an empty run, section properties) have no element of their own. For those, the
  paragraph(s) in `affectedAnchors` get the `data-change-id` (fallback marker).
- **Paragraph-mark revisions** put `data-change-id` on the **block** (`p.rev-para-ins` /
  `rev-para-del`), not only on inline `ins`/`del`: styling by change class must target `:is(ins, del)`.
  The converter's paragraph borders for inserted/deleted/reformatted paragraphs are removed (FR-21).
- **Hyperlinks:** the converter drops tracked changes inside `w:hyperlink` (it renders only the link's
  direct `w:r` children, `ConvertHyperlinkRuns` in `WmlToHtmlConverter.cs`), but renders the children
  of a hyperlink whose relationship is missing as ordinary content. So `unlinkHyperlinksWithChanges`
  points such links to a missing relationship (and removes `w:anchor`): the panels show the changes as
  plain text. **Never restructure the XML before rendering:** `data-anchor` unids hash each element's
  text and descendant element names (`UnidHelper.ContentSignature`; attributes don't count), so moving
  runs in or out of a link would break the match with `affectedAnchors`.
- **Block mapping** (`src/engine/blockKey.ts`): a block's `data-anchor` is the engine's Unid of its
  `w:p`, derived by the converter from the XML it is given (`UnidHelper` in Docxodus, assigned before
  any of the converter's own rewrites, which keep it). The redline carries no Unids, so
  `paragraphUnids` derives them the same way: `sha256(parentUnid:tag:signature:dupIndex)`, first 32
  hex digits, seeded with the part root's local name (`document`, `footnotes`, `endnotes`); the
  signature is the hash (16 hex digits) of the tag name for an element holding a `w:p`/`w:tbl`, else
  of `<w:t text>|<pStyle>|<numId>|<names of all other descendants>,`; `dupIndex` counts preceding
  siblings with the same tag and signature. Checked on every fixture, the sample (775 blocks) and the
  ~300-page pair (3,036 blocks, 174 ms for its body part in Node); a mapping by paragraph order
  matched too, but would count paragraphs the HTML shows once or not at all (text boxes are written
  twice, in `mc:Choice` and `mc:Fallback`). `table`, `tr` and `td` carry anchors as well; only
  paragraph blocks (`p`, `h1`–`h6`; anchor kinds `p:`, `h:`, `li:`) map to a `w:p`.
- **Joined and split paragraphs:** the HTML shows the redline's paragraphs as they are, so a paragraph
  whose mark is deleted still ends where it did; in Word, accepting merges it into the next one. Each
  panel moves the content of a paragraph whose mark its version lacks (right: deleted, left: inserted)
  to the start of the next shown paragraph, after its list label (`mergeJoinedParagraphs`). On the
  sample, typed "1. " numbers replaced by automatic numbering otherwise showed the text before its
  number. A join never crosses a table or the end of its container (body, cell, note): the next
  shown sibling must be a paragraph (`p`, `h1`–`h6`), and the paragraph stays as it is otherwise.
  That is what the export's accept pass does with such a paragraph's text (checked on hand-written
  redlines: kept as a paragraph of its own, before a table and as the last in a cell). The engine
  puts a paragraph with a removed mark right before a table only when the whole paragraph goes
  (its text moved into the table's first cell, fixture `paragraph-join-table`), which the panel
  hides anyway; and the converter wraps each table in a `div` without `data-anchor`.
- **Scroll sync** (`scrollSync.ts`, `useScrollSync(panels, …)` over two or three panels): all panels
  have the same `data-anchor`s. The top-most visible anchor of the scrolled panel is aligned in each
  of the others, interpolating between blocks both panels of the pair show (`pairOffsets`,
  `mapScrollTop`; block offsets cached per panel, pairs per direction, dropped for a panel on
  resize); the sync's own scroll events are ignored. `reveal.ts` centres a change's first shown
  element in each panel (or aligns a panel that shows none of it with the first one that does);
  `revealBlock` does the same for an outline heading, placing it near the top.
- **Outline** (FR-24a): the Edited's headings, or the Original's when the Edited has none. They are
  read from the inputs in the worker (`src/engine/headings.ts`: body paragraphs with an outline level,
  direct or through the style's `w:basedOn` chain; text in the accepted view), **not** from the
  redline's `h1`–`h6`: the engine can drop the Edited's paragraph style from the redline. On the
  sample the Edited's six `Heading3`/`Heading2` paragraphs come out with no `w:pStyle`, their
  `w:pPrChange` holding the Original's `Cmsor3`, so the HTML shows only 2 of its 8 headings as `h*`.
  `buildOutline` (`src/model/outline.ts`) places each heading, in order, on the next body paragraph
  of the decorated HTML whose text in that version equals it (or starts it, for a paragraph joined
  into the next); one it cannot place is left out. The HTML converter makes `h<n>` only from a
  *style's* `w:outlineLvl`, so `minimalDocx` adds a styles part when given headings.
- **Card in the Edited's panel** (FR-28a, `InlineChangeCard.tsx`): React renders it as a light-DOM
  child of the right panel's scroller (the shadow host), shown through a `<slot name="change-card">`
  at the end of the shadow root. So it gets the page's styles, and, the scroller (`contain: strict`)
  being its containing block, it scrolls with the text without scroll listeners. `changeBox`
  (`reveal.ts`) places it: the box around the item's shown elements; for one with none shown (a
  deletion), the character before its first element; else its first shown paragraph. Re-placed on
  resize of the scroller or the content. Locators on `panel-right` now also match the card's
  `ins`/`del`: use `ins.rev-ins` etc. View settings (`useViewSettings.ts`: this card, the list
  collapsed) are kept apart from the compare settings, which belong to the saved review.
- **Dark mode** (FR-25a): every colour in `index.css` and `panel.css` is a custom property on
  `:root`, redefined under `:root[data-theme='dark']`; the panels' shadow roots inherit them.
  `data-theme` is always set (`light` or `dark`): an inline script in `index.html` sets it before the
  first paint (so does its loading modal's dark variant), then `useTheme` (`src/ui/theme.ts`) keeps it
  up to date with the stored choice or `prefers-color-scheme`. The converter writes the document's own
  colours into its stylesheet (and rarely a `style` attribute), with Word's "auto" as explicit `black`
  text / `white` background, so in dark mode `DocumentPanel` swaps in `darkColors(document.css)` and
  rewrites those attributes (`src/ui/darkColors.ts`: in OKLab, text darker than L 0.72 is lightened
  into 0.72–0.95 and backgrounds lighter than 0.38 darkened into 0.2–0.38, hue kept, vivid ones less;
  so text stays apart from the shading behind it). Switching only swaps the style text: the panel's
  content is not rebuilt.
- **Left-aligned text** (FR-20a, a Display setting, on by default): the converter writes Word's
  justified alignment as `text-align: justify` (stylesheet or `style` attribute); `documentLook` in
  `DocumentPanel` rewrites it to `text-align: start` together with the dark-mode colours, in every
  panel, before the content goes into the shadow root (centred and right-aligned text are left as
  they are). Toggling it swaps the style text like the theme. Without it, the Edited panel's
  alignment changed when Editable showed joined paragraphs one by one: a joined paragraph takes the
  alignment of the paragraph it joins into, and the sample's are styled differently.
- The panel and list scrollers have `contain: strict`: without it, every list change laid out the long
  panel documents again.

## Comparison range

FR-14 – FR-19, `src/model/range.ts`. No document trimming and no second comparison: the full
documents are compared once and the items classified. All positions come from the `DocIndex`.

- **Original body paragraphs** are the body blocks visible in the left panel (not wholly inside
  `<ins>`/move-to content). List labels don't count as text; an empty block counts unless its
  paragraph mark is inserted. A paragraph's position is its index among them.
- **Detection** (`detectTrailingRegion`): only when the **last** Original body paragraph is wholly
  deleted, find the body Deleted item (`content_delete`, or a `paragraph_mark` delete with text) whose
  anchors include it. Its first **wholly deleted** paragraph is the proposed end point. It need not be
  the last revision (on the sample it is followed by two paragraph-mark inserts and a formatting
  change). When the deletion starts inside a paragraph the Edited keeps part of, that paragraph stays
  in range and the deletion spans the end point.
- **Positions** (`blockPositions(index, suggestedEndPoint)`): a block not in the Original sits half a
  step after the Original paragraph before it. Exception: with a detected trailing region, the blocks
  not in the Original that come after the last Original paragraph (the engine writes the tail's
  deletion *before* the Edited's last paragraphs) sit half a step before the detected end point — in
  range for it and any later end point. So the Edited's closing paragraph is listed and decided like
  any other insertion ([`closing-note-out-of-range.md`](closing-note-out-of-range.md)). Pass the
  detected end point: the run of Original paragraphs the Edited lacks starts earlier on the sample.
- **Classification** (`classify`): items anchored after the end point are out of range; an item
  spanning it is out of range as a whole (and the notice says so, `spanningItems`). Note items follow
  the body paragraph of the note's first reference. A **move counts by its source** alone: on the
  sample both moves go from just before the end point to after the deleted tail, and are in range. (A
  genuine move into the out-of-range part ends up just before that part on export; that part is meant
  to be unedited, so this is accepted.)
- Out-of-range items are excluded from the list, totals, navigation and bulk actions; their decisions
  stay in state. On export they are rejected (keeping the Original's text). The left panel greys the
  region and its notes and draws a divider; the overview bar hatches it.

## Resolved column

FR-25b, FR-25c, FR-27c. The column between the Original and the Edited shows the document as the
export resolves it. It is a third `DocumentPanel` (`side='resolved'`) over the same rendered HTML,
mounted only in three-column view; no engine call and no second render. The rendered HTML's shapes
it relies on (which element carries which id) are listed at the top of `src/ui/resolvedView.ts`.

- **Which side each item shows** (`resolvedItemDecisions`, `src/model/resolved.ts`): the export's
  own per-item rule (`finalItemDecision`, shared with `finalRevisionDecisions`) with undecided
  accepted, so view and export cannot disagree on the text: out of range → reject, ignored →
  accept unless explicitly decided, otherwise the decision. Formatting items are always accepted:
  the HTML has only the Edited's formatting (the converter renders a formatting revision with its
  new properties), so the column cannot follow the formatting choice or FR-39a
  (requirements, open question 5).
- **Hiding by class, not CSS per side.** `applyResolution` sets `resolved-hidden` on each element
  of the changed items by its own kind: `del` (and the converter's deletion markers) hidden when
  accepted, `ins` when rejected, `tr.rev-row-ins/del` likewise. The rule follows the element, never
  the item's kind: a paragraph-mark block can belong to a different item than its text. Only the
  items whose side changed are touched; a bulk decision is one call.
- **Undoable joins.** A paragraph whose mark the result lacks (`rev-para-ins` rejected,
  `rev-para-del` accepted) is joined into the next paragraph with the side panels' `joinParagraphs`
  (same table/container boundary). Since decisions change, `prepareResolvedPanel` saves each
  paragraph's own children, and each update first **restores** the whole run of paragraphs a changed
  mark can connect (`runOf`: neighbours that can lose their mark, up to the first that can't), then
  joins it again. Restoring only the changed block is not enough: content of an earlier block may
  sit inside it. Markers are saved with the children, so they move with the joins and come back.
- **Notes** follow `reconcileNotes`: a note is hidden when it has no text left, or no reference is
  left to it; when both references of a moved reference are left (its two ends decided
  differently), a copy of the note follows for the second one (`resolved-note-copy`).
- **Range order** (`applyRangeOrder`), the counterpart of [Range order](#range-order): the top-level
  blocks placed before the end point (`blockPositions(index, suggestedEndPoint)`) that come after
  the first block outside the range are moved, in order, before it and its divider; a moved block
  whose mark an out-of-range revision inserted keeps it only when every in-range change in it is
  accepted (`pulledMarks`). The previous placement is undone first, and the joins are redone. The
  panel removes the range divider before and puts it back after.
- **Marks** (`applyResolvedDecisions`): decided items get `change-accepted`/`change-rejected` (yellow
  in `panel.css`, at full opacity: the side panels' dimming is scoped to them) and
  `change-decided-end` (✓/✗) on their last shown `ins`/`del`. Styling targets `:is(ins, del)` and
  markers only, since paragraph-mark ids sit on blocks. **Markers**: `prepareResolvedPanel` puts an
  empty `span.resolved-marker` after each item's last deletion and last insertion (after the table
  for a row); `resolved-marker--shown` shows one where the result drops that side and nothing else
  of the item is visible, and for a move at the end the decision removed. Undecided items get the
  dotted underline (and a dotted marker for a deletion).
- **Comment icons and bubbles** (FR-27c): `applyCommentToggles` puts an empty `span.comment-toggle`
  after each commented item as shown (after its ✓/✗ or marker; for a paragraph mark only, at the
  end of the paragraph's text), moved only when its place changed (so it keeps the focus), never
  into a note copy. The bubbles (`CommentBubbles.tsx`) are React children of the column's scroller,
  shown through a `<slot>` like the inline card (so they scroll with the text and get the page's
  styles), placed below the icon (else `changeBox` + `GAP`) and stacked by `stackBoxes`. The panel
  dispatches `CONTENT_CHANGED` on its scroller after it changed its text, since a decision can
  move a comment without resizing anything. Which bubbles are closed is App state, not saved; the
  header's Comments button (`CommentsToggle`, passed as the panel's `headerControls`) closes them
  all or none.
- **Scroll anchoring:** the update runs in a layout effect; it first notes the top-most visible
  block and its offset (`topBlock`), and afterwards scrolls the column so that block stays put,
  through `scrollQuietly` (the scroll sync doesn't react to it). Text appearing or disappearing
  above the viewport doesn't move what is being read.
- **Selection** needs nothing new: markers carry `data-change-id`, the click handler reports it,
  and `changeBox`/`reveal` include shown markers. Hidden elements can't be clicked.
- **Layout:** `.panels--three` shares the width equally, with narrower side padding
  (`--doc-padding-inline`). At 1024 px or narrower (`useNarrowWindow`) two columns are shown whatever the
  setting; the setting itself is kept. Defaults (`DEFAULT_VIEW_SETTINGS`): three columns, both
  sidebars collapsed; stored settings are merged over them. E2e specs written for two columns pin
  their view with `pinView` (`e2e/viewSettings.ts`).

## Inline edits

The reviewer can edit the text of paragraphs in the Edited panel. An edit changes the Edited
version only, and only that paragraph's changes; it never runs the engine again.

**Segment model** (`src/model/paragraphEdit.ts`, pure, also used by the worker). A block is a
sequence of segments: `equal` text, `del`/`ins` text of one revision of one item, and inline
`object`s (note references, tabs, breaks, …; `owner` when they are inserted or deleted content).
`visibleText` is the Edited text (no `del`), `originalText` the Original (no `ins`); an object is
one `OBJECT_CHAR` (U+FFFC) in both. A `BlockEdit` keeps the block's `original` segments (as the
comparison produced them, for revert and the replay check), its `current` ones and `nextId`.

`applyTextEdit(segments, newVisible, { unid, nextId, caret })` applies one edit of the visible
text. A fresh diff of the whole paragraph against its Original could align the engine's untouched
changes differently and silently move or dissolve decided items; applying the edit to the
segments leaves everything outside it as it was:
- **The edit span** is the common prefix/suffix of the old and new visible text (`editSpan`): an
  edit is one contiguous span, so the update must run before the cursor moves on to another place in
  the paragraph. `caret` places an ambiguous edit (an "a" typed next to an "a") where it was
  made. A no-break space equals a space (browsers type and render some spaces as NBSP); typed NBSPs
  become spaces, and typed text is NFC-normalized. Deleting or typing an object throws.
- **Who owns the text.** Deleted `equal` text becomes a new deletion; deleted `ins` text leaves its
  insertion. Typed text between two characters (or objects) inserted by the same item joins that
  item; otherwise its first (last) word joins the insertion it continues with no space between, and
  the rest is new. Only the characters' places decide this, never the DOM node the browser typed
  into. New text goes after the deleted span, or after the hidden deletions at the cursor.
- **A new piece never joins an existing item**, even when they touch: decisions are deliberate, so
  an edit never moves text between items. Example: `the [big] red [house]`, "red" changed to
  "blue" gives three items, the editor's two with their decisions and a new Replaced one.
- **Normalisation, around the edit only:** a run of new pieces widens to whole words (FR-7; when
  its first or last character, deleted or inserted, is a word character next to an unchanged one,
  that word's unchanged characters join both sides; a side with no text continues with the
  neighbour, so a deleted space joining two words or a typed one splitting a word widens too), then lists its deletion before its insertion
  and becomes one new item (Replaced when it has both). A run of changes the edit touched whose
  deleted and inserted text are the same (the Original typed back) becomes unchanged text: its
  items lose those segments, and an item left without any disappears (its decision and comment stay
  in the review state, for revert).
- **Ids** of new items are `editId(unid, n)` = `e<unid>.<n>`, `n` counting up in the block's
  `nextId` (never reused): the deletion's id, then the insertion's; the item's id is the first. They
  can't collide with the engine's ids (`rev…` strings) and are the same when the edits are replayed. An
  existing item keeps its id for the life of the review, even when the revision it was named after
  is gone.
- `blockItems` gives the block's items from its segments in `ChangeItem` shape (kind recomputed,
  texts, word counts); an existing item keeps the order of its revisions and those outside the
  block (a note's, for an item that inserts the reference), and a revision the edits left alone
  keeps the engine's text. `editRevisions` gives the new revisions' list entries (as the engine's,
  without keys).

**Reading a block** (`readBlockSegments`, `src/ui/blockSegments.ts`): the decorated HTML's text in
order, inside `ins`/`del` (revision from `data-author`, item from `data-change-id`) or not, skipping
`NOT_TEXT` as `DocIndex` does. Note references (`a.footnote-ref`/`a.endnote-ref`), tabs
(`[data-docx-tab]`) and line breaks are one object each; the U+200E the converter writes after a
break, the space before a deleted mark's ¶ and an empty paragraph's no-break space aren't text. So
the segments' Original and Edited text equal the redline paragraph's, objects as one placeholder
(checked on every paragraph of every fixture, except those with fields, content controls, symbols,
…, which the HTML doesn't mark); a no-break space counts as a space, as the converter renders some
spaces as NBSP.

**Rendering a block** (`renderBlockSegments`): new segments go back into the block's markup by
the same alignment as the export's patch (`alignUnits`, below): each character or object of the
block keeps its elements (its ancestors below the block, cloned once per run of characters sharing
them), and everything that isn't text (list labels, ¶ glyphs, back links, bookmarks, the mark after
a break) stays before the character it preceded. A character turning unchanged ↔ deleted, and typed
text, take the elements of the neighbouring character (before, else after) without its
`ins`/`del`, in a new `ins`/`del` of their revision (`data-author`, `data-change-id`, the block's
`data-date`) unless they stay in, or join, that character's revision. A block rendered with its own
segments is unchanged (checked on every fixture and the sample).

**Which blocks can be edited** (`uneditableReason`): paragraph blocks in the comparison range that
the Edited version has (not wholly deleted ones), without move content, and not refused by the
export's patch. A paragraph-mark change doesn't matter: the edit model and the patch work on the
paragraph's text, and its mark stays as it is. (On the sample, the editor removed the blank line
after most paragraphs: the engine reports the text paragraph's mark as deleted, so the Edited
panel joins it into the empty paragraph after it. Excluding such paragraphs left 25 of the ~180 in
range editable.) The last can't be seen in the
HTML (fields, content controls, symbols render as plain text): the worker lists those paragraphs at
compare time (`CompareResult.uneditableBlocks`, unid → `unpatchableContent`'s reason; 0.27 s on the
sample), so a paragraph the panel lets the reviewer edit can always be exported.

**Live review state** (`EditSession` in `src/ui/useEdits.ts`, one per comparison, behind the
`useEdits` hook). A `Comparison` stays as compared (a new one still means a new review); the session
holds the `BlockEdit`s and the values derived from them, which the App uses instead of the
comparison's: the items, their texts, the `DocIndex`, the headings. An update (`update`, `revert`,
`revertAll`, `restore`) touches one block:
- its segments (`applyTextEdit`), then its items: `blockItems` gives the block's items now, and
  `replaceBlockItems` (`src/model/changes.ts`) puts them where its old ones were, keeping the object
  of an item the edit left alone (so a relabelled kind stays) and every existing id; `order` is
  renumbered;
- its markup in the master document (`comparison.document.body`, which a panel mounted later copies,
  e.g. the Resolved column when switching to three columns): rendered, decorated (`decorateDocument`
  scoped to the block, its shared edges isolated again, `change-as-formatting`) and swapped in;
- the changed items' texts (`collectItemTexts` over the session's block map) and same-text
  relabelling; the index's revisions in the HTML and adjacencies (`replaceIndexBlock`; blocks, their
  versions and note references don't change); an Edited heading's text (`withEditedHeadings`, so
  that the outline still finds it; the headings are matched to their blocks once, at the first edit
  of a block with a heading's text).
A block whose segments are back to the comparison's gets its element, items and texts as compared.
`nextId` is never reset, so a later edit's item never takes an earlier one's id (and its decision).
The update returns the new master element and the items removed, added and created; only items a
live edit created start as accepted (`showBlockUpdates`), never those a revert, undo or replay
brings back. The export gets `revisions()` (the engine's plus `editRevisions` of every edited
block) and `patches()`.

**Panels** don't import the document again: `DocumentPanel`'s `controlRef` (`PanelControl`) has
`replaceBlock(unid, block)`, which swaps in a copy of the master block with the panel's classes
(ignored, common edges, out of range, decisions and current change as last applied, dark colours)
and keeps the text at the top of the panel in place. In a side panel it swaps the block's whole run
of joined paragraphs (`joinRun`: the paragraphs whose mark that version lacks before it, the
paragraph they join into, and the blocks the panel doesn't show between them), copied from the
master document and joined again (`joinInPanel`), since the block's content may sit in another
block of the run. In the Resolved column,
`replaceResolvedBlock` (`src/ui/resolvedView.ts`) first restores the block's run of joined
paragraphs, swaps it, rebuilds the maps of the items in the old or new block (elements in document
order, markers, saved children, note references, item notes; the ¶ glyphs and deletion markers
without an id as `prepareResolvedPanel` assigns them; what is still in the panel is decided by
`wrapper.contains`, not `isConnected`, so a detached panel works too), joins again and shows the
items for the sides last applied; a panel built from the updated HTML is the same DOM (checked on the
sample after its scripted edits, which include paragraphs with deleted marks and in notes). The App keeps the
`ignored` and out-of-range sets by content (`useSameSet`), so an update doesn't make every panel
re-mark the whole document or the Resolved column redo its range order.

**Editing in the panel** (`PanelEditing`, `src/ui/editing.ts`; the **Editable** toggle in the Edited
panel's header, off for every review shown). While it is on, the Edited panel's `.doc` has
`doc--editing` (cursors in `panel.css`; the panel's outline in `index.css`: no style text is written
at run time) and each block `uneditableReason` allows gets `contenteditable` (and `spellcheck=false`),
its note references, tabs and `NOT_TEXT` elements `contenteditable=false`; a block an update puts in
is prepared again (`replaceBlock`), and all of them when the range changes. A click doesn't select a
change there; in a block that can't be edited it shows why. The current change's card is hidden.
- **Joined paragraphs are shown one by one while editing**: turning Editable on swaps every run the
  Edited panel joins for unjoined copies, so each paragraph is edited as itself (its text is one
  block's, its edit one `w:p`'s). A paragraph that continues into the next shows its deleted ¶
  (`unjoined-continues`); the paragraph a run joins into is hidden when it has no text of its own
  (`unjoined-empty`: the empty paragraph left where a blank line was removed). Turning it off joins
  them again (not when a new comparison replaces the document).
- The browser edits the panel's copy of the block. An update reads its visible text
  (`readBlockSegments` + `visibleText`: hidden deletions don't count, whatever the browser did to
  them; a `<br>` with no text after it is the browser's placeholder, not the converter's) and calls
  the App, which applies it to the session and shows it in every panel (`showBlockUpdates`), or puts
  the block back as it was when nothing changed or the model refuses it. The cursor goes back by
  its offsets in the visible text (`visibleOffset`/`visiblePoint`, `src/ui/blockSegments.ts`: after
  the visible character before it, never inside a hidden deletion).
- An update runs 400 ms after the last input in a block, never during a composition (dead keys,
  input methods: 400 ms after `compositionend`), and at once when the block loses focus, on Escape,
  when Editable is turned off (not when a new comparison replaces the document), and when the cursor
  leaves the span typed since the last update: an edit is one contiguous span.
- `beforeinput` enforces the rules: paragraph and line breaks, deletes at a paragraph's start or end
  (they would join paragraphs), selections beyond one block, and deletes or replacements that include
  an object are cancelled with a message (`EDIT_MESSAGES`, shown by `Toast`); the browser's undo/redo,
  formatting and drops silently. A paste inserts its plain text (`plainText`: line breaks and tabs as
  spaces) through the model at once, like typed text the browser can't be left to insert.
- Selection in the shadow root: `getSelection().getComposedRanges({ shadowRoots })` (fallback
  `ShadowRoot.getSelection`, then the document's), never `document.getSelection()` alone (Chromium
  reports a cursor in a shadow root at the host). A key event reaches `window` retargeted to the
  panel, so `useKeyboardShortcuts` checks `composedPath()[0]`: keys typed into the text are not
  shortcuts. Escape takes the cursor out of the text (to the panel, whose arrow keys scroll it).

**Export** (`applyEdits`, `src/engine/applyEdits.ts`, the export's first step): each edited block's
`w:p` (found by `paragraphUnids`) is patched to its final segments, and the revision list is updated,
so the later steps find every revision's markup by its keys as usual. An edit never changes the
Original text, so the paragraph's Original-side characters (unchanged and deleted) and the segments'
line up one to one; each may only turn unchanged ↔ deleted. Inserted characters lie in the gaps
between them: per gap, the paragraph's are matched with the segments' (same revision, longest
common subsequence), the others are removed or typed in. The runs this touches are split into one
run per character (each in its own `w:ins`/`w:del`, a copy with a new `w:id`; formatting markup
such as `w:rPrChange` in a copied `w:rPr` gets a new id in its revision too), patched, and joined
again: touching pieces of one revision into one element, touching text runs with the same
properties into one run. New text takes the `w:rPr` of the visible character before it (else after
it; a note reference's is never used), without its formatting markup; new `w:ins`/`w:del` get the
engine's author and date, and `w:id`s above every id of the text parts (the engine numbers them
across the parts). Bookmarks, comment ranges, `w:proofErr`, note references, tabs and breaks stay in
place; runs inside `w:hyperlink`/`w:smartTag` stay inside. A paragraph with anything else (fields,
`w:sdt`, `w:sym`, drawings, moves, `w:customXml`, nested changes, a hyperlink inside a change, …)
fails the export (`EditPatchError`): such paragraphs are not editable. `unpatchableContent` is
that rule, and the one place it is written: the editability check uses it too. Afterwards a revision's keys are those outside the edited paragraphs plus its elements
inside them; one left with none is dropped. The engine may group the patched markup into revisions
differently (it splits a formatting change that new text interrupts), which doesn't matter: the
export uses our list. The patch costs ~0.4 s on the sample (mostly parsing and writing
`document.xml` once more).

## Export

`src/engine/exportDocx.ts`. The engine's stateless `docxDiffAcceptRevisions` resolves a whole
document correctly and fast (~1 s), including paragraph-mark merges and moves. So the export rewrites
every **rejected** revision into markup that *accepting* resolves to the Original version, parks the
revisions to keep as tracked changes ([Tracked changes](#tracked-changes)), then accepts everything
in one pass:

0. With inline edits: `applyEdits` patches the redline and gives the revisions every later step
   uses ([Inline edits](#inline-edits)).
1. **Final decision per engine revision** (`finalRevisionDecisions` in `src/model/decisions.ts`), in
   this order: out of range → reject; formatting → the formatting choice (`edited` = accept); the
   item's explicit decision; ignored by the compare settings → accept; otherwise the export dialog's
   undecided choice (`accept`, `reject` or `track`). Every revision must have one; a revision whose `resolutionStatus` is not
   `supported` makes the export fail naming the change (`UnsupportedRevisionError`).
2. With reviewer comments: `anchorComments` puts their range markers into the redline
   ([Comments](#comments)).
3. Unzip the redline; parse `document.xml`, `footnotes.xml`, `endnotes.xml` (per the revision's part).
4. Per part, plan `planConsistentLook` and `planRangeOrder` (before the rewrite, which discards the
   information they need), run `rejectRevisions`, then apply both plans.
5. With tracked revisions: `parkRevisions`.
6. Re-zip; `docxDiffAcceptRevisions` once.
7. `reconcileNotes` ([Notes](#notes)).
8. `getRevisions` of that must return `[]`, else throw (before step 9, so it also covers an
   export with tracked revisions).
9. With tracked revisions: `restoreRevisions`, with the export's author and date.
10. With comments: `addComments` (same author and date).

The steps that plan with decisions (comment anchors, the look, the range order) see a tracked
revision as the decision that keeps its content (`presentDecision`: accept an insertion or a move,
reject a deletion), since Word shows both sides; only `reject` revisions are rewritten.

### Reject rewrite

`src/engine/rejectRewrite.ts`. Markup is located by `constituentKeys` (element name + `w:id`); all
keys are located first, then rewritten. The rule for `w:ins`/`w:del` depends on **where the element
sits** (run content; `w:pPr/w:rPr` = paragraph mark; `w:trPr` = table row), not on the key's `kind=`:
a `content_delete` revision can also list the `ParaMark` key of the mark it removes.

| Markup | Rewrite on reject |
|---|---|
| `w:ins` around runs | rename to `w:del`; `w:t` → `w:delText`; `w:instrText` → `w:delInstrText` |
| `w:del` around runs | unwrap; `w:delText` → `w:t`; `w:delInstrText` → `w:instrText` |
| `w:rPrChange` | replace the parent `w:rPr` children with the stored old ones; drop the change |
| `w:pPrChange` | replace the `w:pPr` children with the stored old ones **first**, then the existing `w:rPr` (paragraph mark), then `w:sectPr`. Wrong order still gives the right text but fails `verifyDeliverable` (schema) |
| `w:sectPrChange` | existing `w:headerReference`/`w:footerReference` first, then the stored old children |
| paragraph mark `w:pPr/w:rPr/w:ins` | rename to `w:del` |
| paragraph mark `w:pPr/w:rPr/w:del` | remove |
| `w:moveFrom` | unwrap, `w:delText` → `w:t`; remove matching `w:moveFromRangeStart/End` |
| `w:moveTo` | as `w:ins` (→ `w:del`); remove matching `w:moveToRangeStart/End` |
| `w:trPr/w:ins` | rename to `w:del` (the row goes) |
| `w:trPr/w:del` | remove the marker (the row stays) |
| `w:cellIns` / `w:cellDel` | rename to `w:cellDel` / remove |
| `w:tblPrChange`, `w:trPrChange`, `w:tcPrChange`, `w:tblPrExChange` | replace the parent properties with the stored old ones, keeping the parent's revision markers and schema order; drop the change |
| `w:tblGridChange` | replace the `w:tblGrid` children with the stored old ones |
| anything else | `UnsupportedRevisionError` |

Tables: an inserted/deleted row is one `row_insert`/`row_delete` revision whose keys cover the row
marker (`kind=RowMark`) **and** every run and paragraph mark in the row, so the row's content needs no
extra rule. A restyled table gives `w:tblPrChange`, `w:tblGridChange`, `w:trPrChange` (whose old
`w:trPr` can be empty) and `w:tcPrChange`. The engine emitted no `w:cellIns`/`w:cellDel`/
`w:tblPrExChange` for our fixtures; those rules are unit-tested only.

**Key formats** (`parseConstituentKey` in `src/engine/ooxml.ts`): `kind=Content:<ns>:ins:<id>`,
`kind=Content:<ns>:del:<id>`, `kind=PropsChange:<ns>:rPrChange:<id>` (likewise `pPrChange`,
`sectPrChange`), `kind=ParaMark:<ns>:ins|del:<id>`, `kind=RowMark:…` (the row's `w:trPr/w:ins|del`), moves
`kind=Content:<ns>:moveFrom:<id>:name=<move name>` (likewise `moveTo`), and move range markers without
`kind=`: `<ns>:moveFromRangeStart:<id>:name=<move name>`, `<ns>:moveFromRangeEnd:<id>` (likewise
`moveTo…`). `(element name, w:id)` is unique within a part on the sample but nothing guarantees it
(content, paragraph-mark and row `w:ins` share the name): `ElementIndex` reports a key naming several
elements as ambiguous, and the export fails on it like on missing markup (`RevisionMarkupError`) —
never guess between duplicates.

**xmldom's `getElementsByTagNameNS` lists are live:** after any change to the document (even cloning
nodes into it) the next `item()`/`length` walks the whole document again. Copy a list into an array
before changing the document (35 s instead of 0.2 s on the sample otherwise).

### One consistent look

`src/engine/consistentLook.ts`, FR-39a. Text kept from the version the formatting choice did not pick
— a restored deletion or rejected move under the Edited's formatting; an accepted insertion or move
under the Original's — is a *foreign* run or paragraph. Text both versions have is the reference, with
its look in each version (current properties = Edited; the `…Change` element's = Original). A foreign
run takes, in order:
1. the chosen-version look of the nearest run both versions have (in its paragraph first), if that run
   looked the same in the other version;
2. else the most common chosen-version look among the part's runs that had the same other-version look
   (on the sample: "Palatino, colour 0D0D0D, kern 0" → none, "… italic" → italic);
3. else the nearest kept run's look.

Paragraphs and paragraph marks the same way; a paragraph keeps its own list numbering. Runs holding
note references, fields or drawings get no neighbour's look. Out-of-range changes are left alone (the
tail keeps the Original's look). Without this step the sample's mixed-decision export had Palatino
words inside sans text and justified restored paragraphs.

### Range order

`src/engine/rangeOrder.ts`. The engine can place in-range content after the out-of-range region (on
the sample: the two false moves and the closing paragraph come after the deleted tail). The
out-of-range region starts at the first body element that holds only out-of-range revisions' markup;
each later body element holding an in-range **text** change (not just formatting) is moved, in order,
before it. Such a paragraph's mark inserted by an out-of-range revision is kept when every in-range
change in the paragraph is accepted, else rejected with it. On the sample, the detected range with
everything accepted gives exactly the Edited body, then the Original's tail, and the Edited's notes,
then the tail's notes 6–20.

### Notes

`src/engine/notes.ts`. Decisions can separate a footnote reference from its note. The engine reports a
reference that moved to another paragraph as deletion + insertion of the same note id, so rejecting one
and accepting the other leaves the note referenced twice (fails `verifyDeliverable`; the engine's
session API does the same); accepting the deletion of a note's whole text while its reference stays
leaves a note without a paragraph (schema error); a note whose reference is deleted while its own
deletion is rejected stays as an orphan. After the accept pass, `reconcileNotes` gives each extra
reference its own copy of the note, gives an empty note a paragraph, gives a referenced note that lost
its number (`w:footnoteRef`/`w:endnoteRef`) the number back, and removes notes the export no longer
references.

### Comments

`src/engine/comments.ts`, FR-27b. The main thread builds each comment's text (`exportComments` in
`src/model/comments.ts`) and sends it with the item's revision ids. Before the rewrite,
`anchorComments` puts `w:commentRangeStart` before the first and `w:commentRangeEnd` after the last
markup element of those revisions in `document.xml`, as siblings, never inside a `w:ins`/`w:del`:
the rewrite renames and unwraps those elements, and the accept pass keeps markers next to them (a
range whose text the decision removes collapses to a point). They go in before the other plans run,
which look at runs and body elements, not at these markers; the reference runs (`w:r` with
`w:commentReference`) are added only after the accept pass, so that the look never takes them for
text. Comment ids continue after the ids the package already uses: the engine keeps the inputs'
comments.

Where a comment is anchored:
- Run-level markup: just outside it. A paragraph mark, table row (`w:trPr`) or cell marker: the
  content of its paragraph, or of the row's or cell's paragraphs. Move range markers and property
  changes are not anchors.
- A move: only the side the export keeps (`w:moveTo` if accepted, `w:moveFrom` if rejected), not
  everything in between.
- A change in a footnote or endnote: the note's reference in the main document (one the export keeps,
  since a moved reference is a deletion plus an insertion). Comment markers inside notes fail
  `verifyDeliverable` (`Sem_MissingReferenceElement`).
- Markers in a table row the export removes go with the row: they go to the start of the paragraph
  after the table, or the end of the one before it.
- The accept pass merges a paragraph whose mark is removed into the next one, markers included, but
  drops such paragraphs when no paragraph with a kept mark follows them before the next table or the
  end of their container (the trailing deleted region on accept, a rejected inserted last paragraph).
  A range starting there becomes a point at the end of the last kept paragraph before them.

`addComments` adds the reference runs and the comments part (creating `word/comments.xml`, its
relationship and its content type if needed), by the export's author (FR-38c; initials from its
words; default "Reviewer"). A comment whose markers are gone anyway is placed at
the end of the document rather than lost (`onCommentsRelocated` tells the tests; none on the fixtures
or the sample, with a comment on every text revision under all-accept, all-reject and alternating
decisions). LibreOffice imports them as annotations on the commented text.

### Tracked changes

`src/engine/trackedRevisions.ts`, FR-38b. The accept pass resolves every revision it finds and
throws on run-level elements it does not know (`Internal error 20`, `AllParaContentIsDeleted` in the
engine's `RevisionProcessor.cs`), so renaming the markup out of its way fails. Instead
`parkRevisions` turns each tracked revision's markup (located by its keys, like the reject rewrite)
into bookmarks named `_DDK<n>`, which the accept pass keeps, and remembers the element's name and
attributes:

| Markup | Parked as |
|---|---|
| `w:ins`/`w:moveTo` around runs | unwrapped, between a bookmark pair |
| `w:del`/`w:moveFrom` around runs | unwrapped, `w:delText` → `w:t`, `w:delInstrText` → `w:instrText`, between a bookmark pair |
| paragraph mark `w:pPr/w:rPr/w:ins\|del\|moveFrom\|moveTo` | removed; an empty bookmark pair at the end of the paragraph |
| `w:trPr/w:ins\|del` | removed; an empty bookmark pair in the row's first paragraph |
| move range markers | an empty bookmark pair in their place |
| anything else (cell markers, property changes) | `UnsupportedRevisionError` |

Parked content is plain text the accept pass keeps (both sides, as Word's markup view), and a
parked mark is an ordinary one, so the paragraph is neither joined nor dropped. After the accept
pass and `reconcileNotes`, `restoreRevisions` wraps what lies between each pair again (the text
turned back into deleted text for deletions), or puts the marker back into the paragraph's
`w:pPr/w:rPr` or the row's `w:trPr` in schema order (creating them if needed), with the export's
`w:author` and `w:date`; the ids stay the redline's. A note that `reconcileNotes` copied (a moved
reference kept as deletion + insertion of the same note) has the bookmarks twice: the copy's markup
gets new ids. Bookmarks gone with what held them (a note whose reference another decision removed)
leave nothing to track. A bookmark pair whose end is no longer a later sibling of its start fails
the export (`RevisionMarkupError`).

Checked by: on the fixtures, every text revision tracked (accept in Word ≡ Edited, reject ≡ the
export with text rejected), and each revision tracked against the rest accepted or rejected
(accepting/rejecting it ≡ the export deciding it so); on the sample, every third text change tracked
with comments on all. `verifyDeliverable` reads tracked markup as Word's markup view, so a tracked
deleted field has "no instruction text" and a moved note reference counts twice: the engine's own
redline has the same findings, and the tests (`expectTrackedDeliverable`) allow only codes the
redline has. LibreOffice opens the exports with their tracked changes.

### Why not DocxSession

`DocxSession.acceptRevision`/`rejectRevision`/`acceptAllRevisions` cost ~100 ms per revision even
with `undoDepth: 0` (86 s for the sample's 822 revisions, 70 s for accept-all), and resolving one
revision can consume linked ones (paragraph marks, move halves), invalidating ids still to be processed
(16 `revision_not_found` on the sample). It is used only as the oracle in the fixture tests.

`docs/reference/reject-all-prototype.py` is the Python/lxml prototype of the reject rules from the
planning phase (reject-all on the sample gave exactly the Original text and passed
`verifyDeliverable`). Reference only; `rejectRewrite.ts` supersedes it.

## Saved review

`src/storage/reviewStore.ts`, FR-46 – FR-50. One review at a time: the state without the bytes under
`current-review` (rewritten while reviewing, debounced 300 ms, at once on `pagehide`), the files with
their SHA-256 under `current-review-files` (written once per comparison). Schema 1: engine version,
files, range, decisions, comments (added later; a record without them loads with none), formatting
choice, compare settings, formatting group expanded. A loaded record's state is sanitized (unknown
fields replaced by defaults). Resume compares the stored files again and applies the state only if
both hashes and the engine version match. A probe write at start-up detects unavailable storage; a write that throws (e.g. no `crypto.subtle` outside a secure context)
marks storage unavailable without stopping later writes.

## Service worker and deployment

- `vite-plugin-pwa`, Workbox `generateSW`: precaches the app shell and all 40 files of
  `wasm/_framework/` (`maximumFileSizeToCacheInBytes` 16 MB, since `dotnet.native.wasm` is 10.1 MB);
  the build fails if an engine file is missing from the manifest (Workbox only warns). Engine file
  names carry no hash; Workbox's per-file revisions handle updates.
- Workbox fetches revisioned entries past the HTTP cache, so the **first visit downloads the engine
  twice**. That is needed (the HTTP cache could serve an old file for 10 minutes after a publish), so
  the app registers the service worker only once the engine is ready (`src/serviceWorker.ts`,
  `injectRegister: false`).
- Updates: `skipWaiting` + `clientsClaim` + `cleanupOutdatedCaches`, no prompt and no reload (not
  `registerType: 'autoUpdate'`, which reloads open pages mid-review). An open tab keeps its version;
  safe because nothing loads lazily.
- The scope is the whole origin, which also serves the org's other Pages sites, so only the app's page
  (`/`, `/index.html`, any query) falls back to the precached `index.html` (`navigateFallbackAllowlist`).
- Without a service worker, a reload within 10 minutes of a publish that changed the engine can mix old
  and new engine files from the HTTP cache, which the .NET loader's hash check rejects; accepted, since
  engine updates are rare.
- Publishing: `scripts/publish.sh` (README, "Publishing"). `public/.nojekyll` is required: Jekyll
  drops directories starting with `_`, i.e. the whole engine. Files the site needs besides the app (e.g.
  `CNAME`) go in `public/`, since the copy replaces the Pages clone's contents.
- Pages repository size: git deduplicates unchanged engine files, so a publish adds only the changed
  app files (~1 MB); a new engine version adds ~26 MB. GitHub's per-file limit (100 MB) is far off.

## Testing

- **Engine tests in Node** with the real WASM (`test/node-engine.ts`), in Vitest project `engine`.
  The sample-pair checks share one compare in `test/sample-pair.test.ts`; tests needing the sample go
  through `test/samples.ts` and skip when it is absent.
- **Fixtures** (`test/fixtures/`, generated by `make-fixtures.ts` as hand-written OOXML, one pair per
  markup kind: insert, delete, replace, run/paragraph formatting, section, move, move with edit,
  paragraph split/join, table cell edit, table rows, restyled table, footnote edit/removed, endnote
  added/edited, fields and hyperlink, link/bookmark/tab/break next to edits, restyle with edit,
  trailing deletion).
- **Inline edits** (`test/edits.ts`): scripted edits (insert a word, delete a word, edit inside an
  insertion, edit between two changes, type the Original back) applied with the reader and the edit
  model to editable blocks of every fixture (body, table cells, notes, a heading) and the sample.
  Accept all, reject all and alternating decisions ≡ `test/expectedText.ts` with the edited
  paragraphs' text from their segments (reject all ≡ Original); on the fixtures, each engine revision
  of the patched redline decided against the rest ≡ `DocxSession`'s decision (text and XML); an
  undecided edited item exported as a tracked change resolves in Word as the export deciding it.
- **Round trips** (`src/engine/exportDocx.test.ts`, `test/sample-pair.test.ts`): accept all ≡ Edited
  text, reject all ≡ Original text (`test/text.ts`, checked against `pandoc -t plain` in
  `test/text.test.ts`). Mixed decisions: on the fixtures, each single revision decided against the
  rest ≡ the engine's own `DocxSession` decision (text and XML); on the sample, alternating decisions ≡
  `test/expectedText.ts` (an independent text model of the redline).
- **Resolved column parity** (`test/fixture-pairs.test.ts`, `test/sample-pair.test.ts`): the column's
  text (`resolvedText`, built under jsdom) equals the export's text for all accepted, rejected and
  undecided and alternating decisions (`test/parity.ts`), with the full documents and the detected
  range, each state applied incrementally from the previous one. The consistent look is checked
  with `test/look.ts`: every property set in a mixed export occurs in the chosen version's export.
- **Deliverable checks:** every export passes `verifyDeliverable` (`passed` /
  `passedWithPreExistingFindings`, `test/deliverable.ts`) and converts with
  `scripts/check-libreoffice.sh`.
- **E2E** (Playwright, `e2e/`): engine loading and no third-party requests, compare, review, range,
  export dialog, resume, offline, the Resolved column (`resolved.spec.ts`); `PERF=1` adds timing checks (`e2e/perf.spec.ts`), `BIG_PAIR=1` the
  synthetic ~300-page pair (`test/big-pair.ts`).

## Reference sources

`refs/` (git-ignored; README explains how to clone them):
- `refs/Docxodus` — the engine (C#): `docs/architecture/ir_diff_engine.md` describes the algorithm,
  `Docxodus/RevisionProcessor.cs` the accept/reject logic, `Docxodus/DocxDiff.cs` and `Ir/Diff/` the
  compare, `npm/src` the JS wrapper.
- `refs/Python-Redlines` — Python wrapper around Docxodus / Open-XML-PowerTools; test fixtures.
- `refs/pandiff` — pandoc + `node-htmldiff` prose diff; reference for word-level HTML diff
  post-processing.
