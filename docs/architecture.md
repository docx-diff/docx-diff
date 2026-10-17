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
- `src/engine/pipeline.ts` — `runCompare`: check inputs for revisions → NFC normalize → compare → list → tag → render, with stage timings.
- `src/engine/engine.worker.ts` / `src/engine/client.ts` — the worker and its main-thread client.
- `src/engine/ooxml.ts` — zip/XML helpers, `parseConstituentKey`, `ElementIndex` (element name + `w:id` lookup).
- `src/engine/normalizeText.ts` — text runs to NFC before comparing (FR-13a).
- `src/engine/tagRedline.ts` — `w:author` → `rev:<id>` before rendering; `unlinkHyperlinksWithChanges`.
- `src/engine/exportDocx.ts` — the export pipeline; `rejectRewrite.ts`, `consistentLook.ts`, `rangeOrder.ts`, `notes.ts` — its steps.

Model (pure TypeScript, main thread)
- `src/model/docIndex.ts` — the `DocIndex` built from the rendered HTML.
- `src/model/changes.ts` — `buildChangeItems`: revisions → `ChangeItem[]`.
- `src/model/equivalence.ts` — compare settings, ignored items, same-text relabelling, shared edges.
- `src/model/range.ts` — trailing-region detection, positions, in/out-of-range classification.
- `src/model/analyze.ts` — index + items + suggested end point from a worker result.
- `src/model/decisions.ts` — decision state and reducer; `finalRevisionDecisions` for export.
- `src/model/reviewList.ts` — list entries, navigation order, Previous/Next, next undecided.

UI (`src/ui/`, entry `src/App.tsx`)
- `useEngine`, `useComparison`, `useCompareSettings`, `useReviewStorage`/`useAutoSave`, `useKeyboardShortcuts` — the app's state hooks.
- `renderedDocument.ts` — prepares the HTML once for both panels; `DocumentPanel.tsx` + `panel.css` — one panel in a shadow root; `scrollSync.ts`, `reveal.ts`, `OverviewBar.tsx`.
- `ChangesList.tsx`, `ChangeCard.tsx`, `RangeControl.tsx`, `ExportDialog.tsx`, `CompareSettingsDialog.tsx`, `ResumePrompt.tsx`, `Toolbar.tsx`, `FileDropZones.tsx`, `LoadingModal.tsx` (same markup as the static modal in `index.html`).

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
   and the inputs' text is normalized to NFC (the engine matches exact code points).
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
  renderMoveOperations: true, stampAnchors: true })`, **once**. Both panels show this same HTML in a
  shadow root each: the left hides `<ins>` and move-to content via CSS, the right hides `<del>` and
  move-from content (`.doc[data-side=left|right]` in `panel.css`).
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
- **Joined and split paragraphs:** the HTML shows the redline's paragraphs as they are, so a paragraph
  whose mark is deleted still ends where it did; in Word, accepting merges it into the next one. Each
  panel moves the content of a paragraph whose mark its version lacks (right: deleted, left: inserted)
  to the start of the next shown paragraph, after its list label (`mergeJoinedParagraphs`). On the
  sample, typed "1. " numbers replaced by automatic numbering otherwise showed the text before its
  number.
- **Scroll sync** (`scrollSync.ts`): both panels have the same `data-anchor`s. The top-most visible
  anchor of the scrolled panel is aligned in the other, interpolating between blocks both panels show;
  the sync's own scroll events are ignored. `reveal.ts` centres a change's first shown element in each
  panel (or aligns a panel that shows none of it with the other).
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

## Export

`src/engine/exportDocx.ts`. The engine's stateless `docxDiffAcceptRevisions` resolves a whole
document correctly and fast (~1 s), including paragraph-mark merges and moves. So the export rewrites
every **rejected** revision into markup that *accepting* resolves to the Original version, then
accepts everything in one pass:

1. **Final decision per engine revision** (`finalRevisionDecisions` in `src/model/decisions.ts`), in
   this order: out of range → reject; formatting → the formatting choice (`edited` = accept); the
   item's explicit decision; ignored by the compare settings → accept; otherwise the export dialog's
   undecided choice. Every revision must have one; a revision whose `resolutionStatus` is not
   `supported` makes the export fail naming the change (`UnsupportedRevisionError`).
2. Unzip the redline; parse `document.xml`, `footnotes.xml`, `endnotes.xml` (per the revision's part).
3. Per part, plan `planConsistentLook` and `planRangeOrder` (before the rewrite, which discards the
   information they need), run `rejectRevisions`, then apply both plans.
4. Re-zip; `docxDiffAcceptRevisions` once.
5. `reconcileNotes` ([Notes](#notes)).
6. `getRevisions(result)` must return `[]`, else throw.

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
files, range, decisions, formatting choice, compare settings, formatting group expanded. A loaded
record's state is sanitized (unknown fields replaced by defaults). Resume compares the stored files
again and applies the state only if both hashes and the engine version match. A probe write at start-up
detects unavailable storage; a write that throws (e.g. no `crypto.subtle` outside a secure context)
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
  added/edited, fields and hyperlink, restyle with edit, trailing deletion).
- **Round trips** (`src/engine/exportDocx.test.ts`, `test/sample-pair.test.ts`): accept all ≡ Edited
  text, reject all ≡ Original text (`test/text.ts`, checked against `pandoc -t plain` in
  `test/text.test.ts`). Mixed decisions: on the fixtures, each single revision decided against the
  rest ≡ the engine's own `DocxSession` decision (text and XML); on the sample, alternating decisions ≡
  `test/expectedText.ts` (an independent text model of the redline). The consistent look is checked
  with `test/look.ts`: every property set in a mixed export occurs in the chosen version's export.
- **Deliverable checks:** every export passes `verifyDeliverable` (`passed` /
  `passedWithPreExistingFindings`, `test/deliverable.ts`) and converts with
  `scripts/check-libreoffice.sh`.
- **E2E** (Playwright, `e2e/`): engine loading and no third-party requests, compare, review, range,
  export dialog, resume, offline; `PERF=1` adds timing checks (`e2e/perf.spec.ts`), `BIG_PAIR=1` the
  synthetic ~300-page pair (`test/big-pair.ts`).

## Reference sources

`refs/` (git-ignored; README explains how to clone them):
- `refs/Docxodus` — the engine (C#): `docs/architecture/ir_diff_engine.md` describes the algorithm,
  `Docxodus/RevisionProcessor.cs` the accept/reject logic, `Docxodus/DocxDiff.cs` and `Ir/Diff/` the
  compare, `npm/src` the JS wrapper.
- `refs/Python-Redlines` — Python wrapper around Docxodus / Open-XML-PowerTools; test fixtures.
- `refs/pandiff` — pandoc + `node-htmldiff` prose diff; reference for word-level HTML diff
  post-processing.
