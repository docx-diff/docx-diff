# The Edited's closing paragraph is dropped as out of range

Investigation of 2026-10-17. Status: **fixed 2026-10-17** (review after task 8), as outlined under "Small
fix" below, with one correction: the position uses the detected end point (`blockPositions(index,
suggestedEndPoint)`), not the start of the run of Original paragraphs the Edited lacks, which on the
sample begins at 159 (the deleted wording of list items 7.– and the move sources), well before 168. The
bare paragraph mark comes into range too and is ignored by the whitespace setting. Related:
[false-moves-at-trailing-tail.md](false-moves-at-trailing-tail.md), which has the same root cause (the
engine places the Edited's last paragraphs after the deleted tail).

## Summary

The Edited sample ends with a paragraph the editor added:

> (Átnézve eddig, Stillness Flowing p.257)

The comparison range classifies this new paragraph as **outside the range**, so it is not listed as a
change and the export always **rejects** it: the exported document does not contain it. That is wrong: it is a
paragraph added in the Edited version, inside the part that was edited, and must be listed and decided
like any other insertion.

It is not a code bug but a **deliberate rule** of the PRD (§7.5), now judged wrong:

> Out of range with it: the tail deletion … and the 2 items the engine placed after the deleted tail — a
> bare paragraph-mark insertion and the Edited document's closing marker paragraph "(Átnézve eddig,
> Stillness Flowing p.257)". Rejecting the latter on export drops that marker, which is what a reviewer
> wants for a "reviewed up to here" note.

A test pins the current behaviour (`test/sample-pair.test.ts`, "the trailing region out of range and the
rest accepted gives the Edited text followed by the Original tail"):

```ts
// The Edited body ends with its "reviewed up to here" note, which the engine placed after the
// deleted tail: it is out of range, so the export drops it.
expect(editedBody.at(-1)).toBe('(Átnézve eddig, Stillness Flowing p.257)');
…
expect(body(exported)).toEqual([...editedBody.slice(0, -1), ...originalBody.slice(tailStart)]);
```

### Simple demonstration

Redline body order (sample pair) and the positions `blockPositions` gives on the Original's paragraph
axis. End point = 168; a block is out of range when its position is ≥ 168.

| Redline order | In Original? | Position | Class |
|---|---|---|---|
| … "A szigorú napirendet azért…" (move source) | yes | 167 | in range |
| "KORAI KELÉS" … "Összefoglalva: …" (deleted tail) | yes | 168 … 746 | out of range |
| "Luang Porra…", "A szigorú napirendet úgy…" (move destinations) | no | 746.5 | in range: a move counts by its source |
| bare paragraph-mark insertion | no | 746.5 | **out of range** |
| "(Átnézve eddig, Stillness Flowing p.257)" | no | 746.5 | **out of range** ← the problem |

## Why it happens

1. The Edited stops at p.257. The Original's remaining 579 paragraphs are one large deletion, and the
   engine writes it **before** the Edited's last paragraphs: emission walks the Edited document, and the
   whole unmatched end region's deletions come first
   ([details](false-moves-at-trailing-tail.md#how-the-engine-aligns-paragraphs-the-relevant-part)).
2. `blockPositions` (`src/model/range.ts`) puts a block the Original lacks "half a step after the Original
   paragraph before it". For "(Átnézve…)" that paragraph is the last one of the deleted tail (746), so its
   position is 746.5, after the end point.
3. `classify` puts every item with an anchor at or after the end point out of range. Out-of-range items
   are hidden from the list and rejected on export (FR-17).

Moves had the same problem and were special-cased (task 6.8: a move counts by its source). Insertions were
not, by design (the PRD quote above).

## Small fix (about half a day)

**Rule:** an Edited-only block that the engine placed **after the detected trailing region** belongs to
the end of the edited part. Give it the position just before the end point (e.g. `suggestedEndPoint −
0.5`), so it is in range for the detected end point and for any later one.

Points to settle when implementing:

- **Where to apply it.** In `blockPositions`, or as a post-pass that knows the detected region. The region
  is found by `detectTrailingRegion` from the items; positions are computed from the index alone. The
  simplest test: Edited-only body blocks that come after the last Original body paragraph, when that
  paragraph is wholly deleted.
- **Manual end point.** With a manual end point before the detected one, these blocks have position
  `suggestedEndPoint − 0.5`, which is after the manual end point, so they are out of range again. Decide
  whether that is right. Probably it is: the reviewer has said the comparison ends earlier.
- **Export order.** `src/engine/rangeOrder.ts` already moves each body element after the out-of-range
  region that holds an in-range text change back before that region, in order, and keeps a paragraph mark
  inserted by an out-of-range revision when the paragraph's in-range changes are accepted. So the export
  should give "…Luang Porra…", "A szigorú napirendet…", "(Átnézve…)", then the Original's tail. **Verify**
  with the export tests; this has not been run.
- **Side effect.** The bare paragraph-mark insertion at the same place also becomes in range and appears
  as a "Paragraph break" item. Check that this is acceptable or fold it.

Changes:

| Where | Change |
|---|---|
| `src/model/range.ts` | position rule above; update the doc comments of `blockPositions` and `classify` |
| `src/model/range.test.ts` | a case with an insertion after a wholly deleted tail |
| `test/sample-pair.test.ts` | "puts the tail … out of range": out-of-range counts change (only the tail deletion, plus the paragraph mark if not folded); the export test expects `body(exported)` = the whole `editedBody` followed by the Original's tail; the moves-rejected test likewise ends with "(Átnézve…)" before the tail |
| `tasks/…-prd---docx-diff.md` | §7.5: remove "Rejecting the latter on export drops that marker…" and state the new rule; the "Positions" bullet |
| `e2e/` | check whether a range test counts listed or out-of-range changes |

This fix does not touch the false moves. Cutting the Original's tail before comparing would fix both:
there the closing note is an ordinary insertion at the end and in range (verified by prototype; see the
redesign in [false-moves-at-trailing-tail.md](false-moves-at-trailing-tail.md#redesign-assessed-cut-the-originals-tail-before-comparing)).

## Key facts

| Fact | Value |
|---|---|
| Detected end point (sample) | Original body paragraph 168 (0-based); 579 paragraphs after it |
| Items out of range today | the tail deletion (with the deletions of notes 6–20 in the same item), one bare paragraph-mark insertion, the "(Átnézve…)" insertion |
| "(Átnézve…)" in the Edited | its last body paragraph (`editedBody.at(-1)`) |
| Same pair with the Original's tail cut | "(Átnézve…)" is an insertion right after the last edited paragraph, in range |

## References

- `src/model/range.ts`: `blockPositions`, `classify`, `rangeAnchors` (the special case for moves),
  `detectTrailingRegion`.
- `src/engine/rangeOrder.ts`: export order for in-range content placed after the out-of-range region.
- `src/engine/exportDocx.ts`: out-of-range revisions are rejected.
- `test/sample-pair.test.ts`, describe "comparison range".
- PRD `tasks/2026-10-15-203451-prd---docx-diff.md`: FR-17 (§4.3), §7.5 ("Out of range with it…", "Moves",
  "Export order", "Positions").
