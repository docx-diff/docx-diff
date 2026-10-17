# False moves at the edit boundary when the Original has a long deleted tail

Investigation of 2026-10-17. Status: **understood, not fixed**; tracked as open question 4 in
[requirements.md](requirements.md#open-questions) (decide whether to do the redesign). A redesign that cuts the Original's tail
before comparing was assessed but not started. The closing note that gets dropped is a separate issue:
[closing-note-out-of-range.md](closing-note-out-of-range.md).

## Summary

On the sample pair, two paragraphs that sit in the same place in both documents are shown as **moved**:

- "Luang Porra mély benyomást tett…"
- "A szigorú napirendet…"

Both were edited, and both are the last paragraphs before the Edited document ends. The Edited copy stops
at p.257 ("edited until p257"); the Original goes on for another 579 paragraphs, which the engine reports
as one large deletion (the trailing region, [architecture.md](architecture.md#comparison-range)).

Cause, in one sentence: an edited paragraph cannot anchor the alignment, so the two paragraphs end up in
the **same unmatched region as the ~580-paragraph deleted tail**. A region that large makes the engine
skip its in-place pairing. The two paragraphs fall out as delete + insert, and the cross-region move
detector, which sees two near-identical paragraphs, reports them as moves.

It is engine behaviour (Docxodus, .NET, pinned at `13.0.0`), not a bug in our code. Our range logic
already handles it: moves are classified by their source and stay in range, and `rangeOrder.ts` puts
them back before the tail on export. It only **looks** wrong to the reviewer.

### Simple demonstration

What the reviewer sees in the redline, in document order:

```
… 4. Ameddig csak elismeritek …                    unchanged
  5. / 6. …                                        edited in place
  7. … / Ameddig csak ez a hét … / /DN 16, AN 7.21-23/   deleted (Original wording)
  Luang Porra mély … (Original wording)            moveFrom   ← where the paragraph really is
  A szigorú napirendet azért … (Original wording)  moveFrom
  7. … / Ameddig csak ebben … / /DN 16, AN 7.23/   inserted (Edited wording)
  KORAI KELÉS … Összefoglalva: …                   deleted: the 579-paragraph tail
  Luang Porra mély … (Edited wording)              moveTo     ← placed after the whole tail
  A szigorú napirendet úgy … (Edited wording)      moveTo
  (Átnézve eddig, Stillness Flowing p.257)         inserted
```

The same documents with the Original's tail cut off (everything after "A szigorú napirendet…" removed):

```
  Luang Porra mély … Hanyatlás [del megakadályozásáról][ins Megakadályozásáról] …   edited in place
  A szigorú napirendet [ins úgy][del azért] alakították ki …                        edited in place
  (Átnézve eddig, Stillness Flowing p.257)                                         inserted
```

No moves.

## Key facts

| Fact | Value | How it was established |
|---|---|---|
| Word changes in "Luang Porra mély…" | 4 of 78 words (Megakadályozásáról, Szóló, Tanítóbeszéd capitalised; megfelelő → pontos) | word diff of `pandoc -t plain` output |
| Word changes in "A szigorú napirendet…" | ~20 of 76 words | same |
| Deleted tail of the Original | 579 paragraphs (end point 168), 15 footnote references (notes 6–20), 13 list paragraphs (numIds 29–32), styles `Cmsor2`, `Cmsor3`, `NormlWeb`, one section break; no images, hyperlinks, tables or comments | XML inventory |
| Moves with the full tail | 2 items (122 `w:moveFrom` elements) | compare of the sample pair |
| Moves with the tail cut | 0; both paragraphs edited in place | compare with a trimmed Original |
| Tail length at which the moves appear | **≤ 416** tail paragraphs kept → in place; **≥ 417** → moves (both paragraphs flip together) | bisection |
| Same, with "(Átnézve eddig…)" removed from the Edited | ≤ 370 → in place; ≥ 371 → moves | bisection |
| Is the 417th paragraph special? | No. It is an empty `Cmsor2` paragraph, but deleting it or removing its style does not change the result | experiment |
| Formatting of the two documents | Every paragraph of the redline carries a format change; the Edited was re-saved with different style ids (default `Normal` vs the Original's `Norml`; no `Cmsor2/3`, `NormlWeb`) | redline and `styles.xml` |
| Package the redline is built on | The **Original's**: default style `Norml`, all 120 styles of both inputs, numbering of both (numIds 1–32 and 1000–1001) | redline `styles.xml`/`numbering.xml` |

## How the engine aligns paragraphs (the relevant part)

From `refs/Docxodus/docs/architecture/ir_diff_engine.md` (§ `IrBlockAligner`) and
`refs/Docxodus/Docxodus/Ir/Diff/IrBlockAligner.cs`:

1. **Anchors.** Blocks whose content is unique on each side and identical are anchors. Pass A requires the
   same content and format; pass B requires the same content only (`CollectAnchors`, `KeyContentOnly`).
   An edited paragraph never anchors.
2. **Spine.** The longest increasing subsequence of anchors. Anchors off the spine become moves.
3. **Gaps.** The free blocks between two spine anchors form a gap. After the last anchor, the gap runs to
   the end of the document: here it holds the Edited's last few paragraphs and the Original's last ~590.
4. **Gap fill** (`FillOneGap`), in order:
   - in-order equal-content pairing;
   - `SameSlotPair` (k-th free with k-th free). It is skipped when one side has fewer than ⅓ of the
     other's paragraphs (count-parity guard), which is always the case here.
   - `SimilarityPair`: greedy, similarity ≥ 0.35 + 0.3 × relative displacement inside the gap
     (`PairLocalityPenalty`);
   - `JunctionPair`: an order-preserving LCS over the remaining free paragraphs. It is **skipped when
     free-left × free-right > 10,000** (`JunctionPairScaleCeiling`).
   - Leftovers become Deleted / Inserted.
5. **Cross-gap moves** (`DetectCrossGapMoves`). A deleted and an inserted paragraph with similarity
   ≥ 0.8 (`MoveSimilarityThreshold`) and ≥ 3 words become a move. A moved-and-edited paragraph is written
   as a complete `w:moveFrom` (Original wording) plus a complete `w:moveTo` (Edited wording).
6. **Emission** walks the Edited document. The insert half lands where it is in the Edited's order, which
   in the redline is after all the deleted content of that gap.

### Which guard gives way: a strong inference, not traced

The flip at an exact paragraph count, with both paragraphs flipping together despite very different
similarity (≈ 0.95 vs ≈ 0.75), fits the **`JunctionPair` scale ceiling** best: a product of two counts
crossing 10,000. The locality penalty changes smoothly and by ~0.00005 per added paragraph, so it would
not flip both paragraphs at the same count.

Not confirmed: the counts the engine actually sees. A simple estimate (gap after "4. Ameddig…": 592 × 8)
gives 4,736, under the ceiling, so the gap the engine uses must be larger than that estimate (the
anchors depend on its exact content hashes). Removing "(Átnézve…)" moved the threshold from 417 to 371,
which a product rule would only explain if that removal also changed what the earlier passes pair. To
confirm, build `refs/Docxodus` with a trace line in `JunctionPair` (printing `m`, `n` and whether it
returns early). This machine has the .NET 10 runtime but **no SDK**, so it could not be built here.

## Why our app is not wrong, only confusing

- `classify` in `src/model/range.ts` places a move by its **source** only, so both moves are in range
  (pinned by "keeps the two moves in range" in `test/sample-pair.test.ts`).
- `src/engine/rangeOrder.ts` moves in-range content the engine placed after the out-of-range region back
  before it on export, so accepting the moves gives the Edited wording in the right place.
- CLAUDE.md already records the behaviour: "the sample's two moves go from just before the end point to
  after the deleted tail, and are in range".

## Redesign assessed: cut the Original's tail before comparing

Goal: the engine never sees the deleted tail, so the boundary paragraphs are edited in place.

### Two ways to keep the tail away from the engine

| Option | Result of the prototype | Verdict |
|---|---|---|
| **A. Cut the tail from the Original**, compare, splice the tail back into the export | In-place edits, no moves, "(Átnézve…)" inserted at the end and in range. The trimmed redline keeps the Original's styles, numbering and default style, because the redline is built on the Original's package. **But** footnotes 6–20, referenced only from the cut tail, remain in the redline as deleted, unreferenced notes. | **Viable.** The cut must also remove those notes. |
| **C. Append the Original's tail to the Edited**, compare as usual | Correct text: no moves, the tail unchanged, "(Átnézve…)" inserted before the tail. But a plain splice gave 547 spurious `w:pPrChange` on the tail. Also copying the tail's styles and numbering into the Edited and making the default style explicit gave **2,877** `w:rPrChange` plus 547 `w:pPrChange`. The engine compares effective formatting, and the Edited package has different defaults. | **Ruled out.** |

### Constraints

- **The end point must be known before the compare**, but today it comes from the compare. A full compare
  is needed first, then a second one with the trimmed Original. Detect the tail from the first redline's
  XML: the trailing body paragraphs that are wholly deleted, mark included. The detection rules must stay
  those of `detectTrailingRegion` (a deletion that starts inside a paragraph the Edited keeps part
  of → the next paragraph). With no list or render for the first pass, the extra cost is about one
  compare: ~2.5 s on the sample (7.6 → ~10 s to panels), ~4 s on the synthetic ~300-page pair
  ([measurements.md](measurements.md)). Pairs without a tail need no second pass.
- **Only right for the detected tail.** With a manual end point in the middle of edited text, trimming the
  Original would make the Edited's later text show as insertions. A manual end point earlier than the
  detected one can still be classified on the trimmed compare as today. A later end point, or the range
  turned off, needs the full compare.
- **Revision ids differ between the trimmed and the full compare**, so switching between them loses
  decisions unless they are carried over by matching changes (or reset after a warning). This is the
  main open design question.
- **Saved reviews** (FR-46–49) must record which compare was used (trimmed at N, or full). Output is
  deterministic, so a resume that repeats the same steps reproduces the same ids.

### Work items and estimate (~6–8 days)

| # | Item | Estimate |
|---|---|---|
| 1 | Two-pass pipeline (`src/engine/pipeline.ts`): full compare → XML tail detection → trimmed compare; progress stage, timings, `CompareResult` carries the cut | ~1 day |
| 2 | Trim the Original (worker, `@xmldom/xmldom`): remove tail paragraphs and the notes only they reference; give the remaining last section the section properties of the section the cut falls in (the sample's tail contains a section break); balance bookmarks that cross the cut | ~1 day with fixtures |
| 3 | Splice the tail back into the export (after `docxDiffAcceptRevisions` / `reconcileNotes`): body elements before the final `w:sectPr`, notes with fresh ids, relationships for any links or images; pass `verifyDeliverable` and `scripts/check-libreoffice.sh`. Tail content we cannot splice → fall back to today's single compare | ~1–1.5 days |
| 4 | Range model and UI: auto mode = trimmed compare; later end point / range off = full compare (re-run or render the first pass on demand), with decisions carried over or reset; left panel shows a "not compared" divider instead of the greyed tail (FR-18); revise FR-19 | ~2 days |
| 5 | Saved review records the compare variant | ~0.5 day |
| 6 | Tests: rewrite the sample range and export tests (no moves, closing note in range, new counts); fixture pairs whose tail holds notes, lists and a section break; e2e range flows | ~1–1.5 days |
| 7 | Docs: `requirements.md` FR-14–19; `architecture.md` "Data flow", "Comparison range"; `measurements.md`; CLAUDE.md (the fact about the sample's moves) | ~0.5 day |

When it is worth doing: if false moves at the edit boundary show up in real use. On this sample they
appear only because the deleted tail is longer than ~416 paragraphs. A short tail gives in-place edits
already.

Alternative not pursued: report the cliff upstream to Docxodus (one more deleted paragraph at the end
turns two in-place edits into moves).

## Reproducing

Paths are relative to the repository root. Run Node commands from the repository so asdf picks Node
24.22.0. The scripts below were kept in the session scratchpad. They are reproduced here because the
scratchpad is temporary.

### Compare two files with the app's settings (`cmp.ts`)

```ts
// node cmp.ts <original.docx> <edited.docx> <redline.docx>   (run with the repo as the working directory)
import { readFileSync, writeFileSync } from 'node:fs';
import { initNodeEngine } from '<repo>/test/node-engine.ts';
import { COMPARE_SETTINGS } from '<repo>/src/engine/settings.ts';
const [a, b, out] = process.argv.slice(2);
const d = await initNodeEngine();
const red = await d.docxDiffCompare(new Uint8Array(readFileSync(a)), new Uint8Array(readFileSync(b)), COMPARE_SETTINGS);
writeFileSync(out, red);
```

Count moves: `unzip -p redline.docx word/document.xml | grep -o '<w:moveFrom ' | wc -l`.

### Trim the Original's body (`trim.py`)

```python
# python -I trim.py <in.docx> <out.docx> <paragraph text prefix> <extra>
# keeps body children up to the one starting with the prefix, plus <extra> more; keeps the final sectPr
import sys, zipfile
from lxml import etree
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
src, dst, prefix, extra = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
zin = zipfile.ZipFile(src)
root = etree.fromstring(zin.read('word/document.xml'))
body = root.find(W + 'body')
kids = list(body)
cut = next(i for i, k in enumerate(kids) if ''.join(x.text or '' for x in k.iter(W + 't')).startswith(prefix))
for k in kids[cut + 1 + extra:]:
    if k.tag != W + 'sectPr':
        body.remove(k)
zout = zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED)
for it in zin.infolist():
    data = zin.read(it.filename)
    if it.filename == 'word/document.xml':
        data = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    zout.writestr(it, data)
zout.close()
```

- `trim.py docs/aramlo-part-2-2025-05-06.docx orig-trim.docx "A szigorú napirendet" 0` → no moves.
- With `416` → no moves; with `417` → 2 moves.

Note: this trim does not remove footnotes 6–20, which then show up as deleted notes (see option A).

## References

- Engine design: `refs/Docxodus/docs/architecture/ir_diff_engine.md`. See the `IrBlockAligner` bullet
  (anchoring → LIS spine → gap fill → cross-gap moves), "What is reported as a move", and the settings
  table (`MoveSimilarityThreshold` 0.8, `MoveMinimumWordCount` 3, `BlockSimilarityThreshold` 0.35).
- Aligner source: `refs/Docxodus/Docxodus/Ir/Diff/IrBlockAligner.cs` (checkout `68d7ef9`; it may differ
  slightly from the npm `13.0.0` build):
  - `AlignBlocks` (l. 51) and `CollectAnchors` (l. 232): the anchors;
  - `FillOneGap` (l. 508): pass order;
  - `SimilarityPair` (l. 761) and `PairLocalityPenalty` (l. 850);
  - `SameSlotPair` (l. 893): count-parity guard;
  - `JunctionPairScaleCeiling` (l. 1452) and `JunctionPair` (l. 1469);
  - `DetectCrossGapMoves` (l. 2437).
- Our code: `src/model/range.ts` (`classify`, `rangeAnchors`, `detectTrailingRegion`),
  `src/engine/rangeOrder.ts`, `src/engine/pipeline.ts`, `src/engine/exportDocx.ts`.
- Tests: `test/sample-pair.test.ts`, describe "comparison range": "keeps the two moves in range…" and the
  export tests after it.
- [requirements.md](requirements.md): FR-14–19; [architecture.md](architecture.md): "Data flow",
  "Comparison range"; [measurements.md](measurements.md).
