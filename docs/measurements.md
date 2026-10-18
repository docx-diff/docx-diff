# Measurements

Numbers measured while building docx-diff with `docxodus@13.0.0`: what the sample pair produces (the
tests pin most of these, mainly `test/sample-pair.test.ts`), timings, first-load size, and the outcome
of the success metrics in [`requirements.md`](requirements.md#success-metrics). Re-measure and update
this file after an engine upgrade.

## Sample pair

`docs/aramlo-part-2-2025-05-06.docx` vs `docs/aramlo-part-2-2025-05-06.edited-until-p257.docx`, with
the settings of `src/engine/settings.ts`.

**Revisions:** 796 — 378 formatting, 200 content delete, 167 content insert, 49 paragraph mark,
2 moves. (822 before `trackNumberingChanges: false`.) No header/footer or `numbering_change` revisions.
Two compares give byte-identical redlines and identical revision ids.

**Items** (`buildChangeItems`):
- Paragraph marks: 43 of the 49 are bare (`¶` only); 26 fold into a neighbour (2 of them into a move),
  leaving 17 Paragraph break items.
- Replaced: 110 delete→insert and 143 insert→delete neighbour pairs share an anchor (overlapping).
  Requiring touching text gives **141** Replaced items, all insertion first (anchor-only greedy
  pairing gave 147, some wrong).
- The unedited tail is **one** `paragraph_mark` delete revision: 117,771 characters, 579 anchors.
- 18 footnote deletion revisions: 15 (notes 6–20) belong to the tail and join its item; note 5's joins
  the body deletion of its reference; one each is in the Replaced items of notes 2 and 4.
- **613 items**: 378 formatting, 141 replaced, 48 deleted, 27 inserted, 17 paragraph break, 2 moved.
- After rendering: 4 Replaced items with identical text are relabelled as formatting (`pavāraṇā`,
  3× `Pāṭimokkha`) and 15 typed list numbers are combined with their automatic numbering → **598
  items**.
- With the default compare settings, **54** text changes are ignored (10 need the quote setting,
  including the ellipsis); 34 replacements have shared edges shown as plain text.

**Rendering and index:**
- The HTML (~1.1–1.2 MB) has 775 anchored blocks; 1,412 of 1,413 revision anchors are found in it (the
  miss is a section anchor). 747 blocks are Original body paragraphs (including 14 empty paragraphs
  between list items that received automatic numbering).
- Every content, move and paragraph-mark revision appears in the HTML with its id; 355 of 378
  formatting revisions do. The other 23 are paragraph-mark `rPrChange`s shown through the paragraph
  fallback. 195 deletion revisions render as 4,333 `<del>` elements.

**Range:** detected end point at Original paragraph index **168** (0-based); the tail covers the other
579. Out of range: only the tail deletion (with notes 6–20). In range after the tail: the two move
destinations, a bare paragraph-mark insertion (ignored by the whitespace setting) and the Edited's
closing paragraph "(Átnézve eddig, Stillness Flowing p.257)", positioned at 167.5. The run of Original
paragraphs the Edited lacks starts at 159 (the deleted wording of list items 7.– and the move sources).

**The two moves are false** ([open question 4](requirements.md#open-questions)): both carry the last
Original paragraphs before the tail (165–167: "Luang Porra mély benyomást tett…", "A szigorú
napirendet azért…") to after the deleted tail, with the editor's changes ("Hanyatlás
megakadályozásáról szóló tanítóbeszéd" → "Hanyatlás Megakadályozásáról Szóló Tanítóbeszéd", "azért
alakították ki, hogy biztosítsák" → "úgy alakították ki, hogy biztosítsa"). The redline has the move
sources between the deleted and inserted versions of the list items "7. …" to "/DN 16, AN 7.21-23/".
Moves count by their source and the export's range order puts them back, so with the detected range
and everything accepted the export is exactly the Edited body followed by the Original tail; with the
moves rejected, their Original wording stays before item 7. Analysis:
[`false-moves-at-trailing-tail.md`](false-moves-at-trailing-tail.md).

## Engine timings (Node)

Planning, Node 20.18, before `trackNumberingChanges: false` (timings unaffected in practice):

| Operation | Sample pair (60 pp., 822 revisions) | Synthetic ~300 pp. (90k words, 2,756 revisions) |
|---|---|---|
| Engine init | 0.15 s | — |
| `docxDiffCompare` | 2.9 s | 11.9 s |
| `getRevisions` | 1.3 s | 5.6 s |
| `convertDocxToHtml` | 3.1 s (1.1 MB HTML) | 6.1 s (2.1 MB HTML) |
| `docxDiffAcceptRevisions` (stateless) | 0.6 s | 1.1 s |
| Session `acceptAllRevisions` | **70 s** | — |
| Session per-revision accept/reject, 822 calls | **86 s**, 16 `revision_not_found` | — |
| Peak memory (RSS) | — | ~450 MB |

Under Node, `initialize` takes 0.14 s and the warm-up (`DocumentComparer.Warmup()`) 0.44 s.

**Compare pipeline**, sample pair: input revision check 0.3–0.6 s, compare 2.3–2.5 s, list 0.8–0.9 s,
tagging 0.3–0.4 s, render 2.7–2.9 s: **6.4 s** in the module worker in headless Chromium, ~7 s under
Node. Main-thread analysis 0.53 s under jsdom (`buildChangeItems` 7 ms).

**Synthetic ~300-page pair** (`test/big-pair.ts`: 89,723 words, 3,000 paragraphs, 2,411 revisions,
1.7 MB HTML; plain text, so faster than the planning pair): check 0.4 s, compare 4.1 s, list 4.8 s, tag
0.25 s, render 2.8 s; main-thread analysis 0.63 s (`buildChangeItems` 12 ms). Under the 1 s budget, so
item building stays on the main thread.

**Export** (reject rewrite + accept pass + note reconciliation + zero-revisions check): sample all
accepted 0.6 s, all rejected 1.3 s, alternating 0.9–1.4 s; with the consistent look 1.2–1.6 s.
~300-page pair: all accepted 0.59 s, all rejected 0.78 s, alternating 0.76 s (the rewrite itself
0.05–0.21 s); with the look 0.84 s. With the detected range, the look and a comment on each of the
sample's 234 in-range text changes 2.1–2.5 s (1.4–1.7 s for the same export without comments). Keeping
undecided changes as tracked changes (FR-38b; parking + restoring): sample with every text change
tracked 1.8 s, with every third tracked, the detected range, the look and comments on all 2.4 s. Snapshotting xmldom's live element lists took the look planning
from 3.6–35 s to 0.2 s on the sample.

## Browser

**UI** (headless Chromium, production build): sample pair from choosing the files to both panels shown
7.6–9.2 s (main-thread preparation well under 0.5 s; longest task 180–190 ms, inserting the HTML into
both panels). ~300-page pair: 12.8 s (preparation 56 ms; longest task 271 ms; no long tasks while
scrolling, so the HTML is inserted in one go).

**Review UI**, ~300-page pair (1,545 text changes): with `contain: strict` on the scrollers, list
scrolling ~33 ms per two frames (85 ms without), Previous/Next ~35 ms, a keyboard decision (decide,
move, scroll both panels) ~70 ms, Accept all one 222 ms task.

**Resolved column** (2026-10-18). Sample pair, `e2e/perf.spec.ts` with `PERF=1` (each time from the
key press or click to the frame after it, which includes the column's update):

| | Two columns | Three columns |
|---|---|---|
| Choosing the files → panels shown | 8.3 s | 8.1–9.2 s |
| One decision (`r` / `a`) | — | 22–30 ms / 13–24 ms |
| Reject all (every undecided change flips) | — | 122–130 ms |
| Accept all (marks only) | — | 63–69 ms |
| Longest main-thread task | 314–352 ms | 510–628 ms |

Under jsdom (`test/sample-pair.test.ts`, which logs them; slower than the browser): the first
`applyResolution` 370–390 ms; a bulk change with the detected range 73–88 ms, without a range
190–390 ms (the 579-paragraph tail's item flips and its run of paragraphs is restored and joined
again); one decision < 1 ms.

**Style sheet order** (fixed 2026-10-18): since dark mode, each panel's document style sheet was
filled in by a separate effect after the content was in its shadow root. Chromium then restyles the
whole document: the display's longest task on the ~300-page pair went from ~375 ms to ~1.2 s (over
the 1 s "frozen" limit of `e2e/perf.spec.ts`). Filling it in with the content brought it back to
406–450 ms (light and dark).

**First load**, local server gzipping like GitHub Pages, cache disabled, to "Engine ready":

| Connection | Time |
|---|---|
| none (localhost) | 1.3 s |
| 50 Mbit/s, 20 ms | 2.4 s |
| 10 Mbit/s, 40 ms | 7.5 s |

Payload: 44 requests, **7.9 MB gzipped** (25.9 MB uncompressed; `.br` files are not deployed).
Largest gzipped: `dotnet.native.wasm` 3.2 MB (10.1 MB raw), `Docxodus.wasm` 1.6 MB,
`DocumentFormat.OpenXml.wasm` 1.2 MB, `System.Private.CoreLib.wasm` 0.6 MB.

**Deployed site** (`https://docx-diff.github.io/`, 2026-10-17, headless Chromium, fresh profile):
"Engine ready" after 1.9–2.9 s, 44 requests, 7.9 MB. The service worker's precache then transfers
another 7.8 MB (46 requests; 44 entries, 26.2 MB uncompressed), active ~1–1.5 s after "Engine ready".
Offline reload: "Engine ready" after 0.8 s, everything from the service worker. GitHub Pages sends
`cache-control: max-age=600`.

## Success metrics outcomes

2026-10-17, production build in headless Chromium unless noted.

1. **Met.** End point detected at paragraph 168 (579 paragraphs unedited); only the tail deletion is
   out of range, the closing paragraph is in range (`test/sample-pair.test.ts`, `e2e/range.spec.ts`).
   The 378 formatting revisions are one collapsed group (`e2e/review.spec.ts`). The list also shows the
   two false moves.
2. **Met.** Accept all ≡ Edited, reject all ≡ Original, also against `pandoc -t plain`
   (`test/text.test.ts`, `test/sample-pair.test.ts`); with the range, Edited body + Original tail
   (`e2e/range.spec.ts`).
3. **Met** with LibreOffice (Word not available): the 13 sample-pair and fixture exports written with
   `EXPORT_DIR` convert with `scripts/check-libreoffice.sh`; the export tests check
   `verifyDeliverable`. The alternating sample export opened in LibreOffice Writer by hand without a
   repair prompt.
4. **Met, the sample pair with little margin.** `e2e/perf.spec.ts` (`PERF=1`, 7 runs), choosing the
   files to panels shown: sample pair **7.7–10.6 s** (one run over 10 s while the machine was busy),
   ~300-page pair **13.7–16.9 s**; export (reject every undecided change, dialog to file)
   **2.4–3.3 s**; longest main-thread task 344–537 ms. The engine takes ~8 s of the sample pair
   (compare 2.7 s, render 3.5 s; 15–20 % slower than earlier measurements, as is the plain worker
   timing in `e2e/engine.spec.ts`, so the machine rather than the app); the app adds ~0.5 s.
   Re-checked 2026-10-18 with the Resolved column: three columns 8.1–9.2 s for the sample pair; two
   columns 7.5–8.6 s, ~300-page pair 13.3–14.5 s, longest task 314–416 ms (after the style sheet fix
   above).
5. **Met.** A reload offers the saved review and restores decisions and range (`e2e/resume.spec.ts`).
6. **Met**, locally (`e2e/engine.spec.ts`, `e2e/offline.spec.ts`) and on the deployed site: no
   requests to other sites; a repeat visit offline is served by the service worker and compares.

**Resolved column** (FR-25b, 2026-10-18; the success metrics of its plan):
- **Met.** Text parity with the export on every fixture and the sample, for all accepted, rejected,
  undecided and alternating decisions, with and without the range (`test/fixture-pairs.test.ts`,
  `test/sample-pair.test.ts`; in the browser on a fixture, `e2e/resolved.spec.ts`).
- **Met.** Formatting does not follow the formatting choice: the column renders the one redline HTML
  and its updates depend on the item decisions only (formatting items are always accepted,
  `src/model/resolved.test.ts`).
- **Met.** Changes and markers select their item when clicked (`e2e/resolved.spec.ts`).
- **Met.** Comment bubbles: all shown on load, × and the icon toggle them, a reload reopens them
  (`e2e/resolved.spec.ts`).
- **Met.** On the sample a decision updates the column in 13–30 ms, Reject all in 122–130 ms,
  Accept all in 63–69 ms; first display with three columns 8.1–9.2 s, within the 10 s of metric 4
  (`e2e/perf.spec.ts`, `PERF=1`).
- **Met.** A fresh profile shows three columns with both sidebars collapsed; at 1024 px two columns
  with the toggle disabled (`e2e/resolved.spec.ts`).
