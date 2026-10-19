# Requirements

What docx-diff must do, as built. The numbered requirements (FR-1 … FR-53) are cited in code comments
and tests as `FR-<n>`; keep the numbers stable when editing (add `13e`, `39b`, … rather than
renumbering). How it is done: [`architecture.md`](architecture.md). Measured numbers and the success
metrics' outcomes: [`measurements.md`](measurements.md).

## Overview

A tool that compares two Word documents (`.docx`), an **Original** and an **Edited** version, lets a
reviewer go through every difference, accept or reject each one, and download a new `.docx` with
those decisions applied. It runs **entirely in the browser** as a static site on GitHub Pages;
documents never leave the user's machine. The layout follows Draftable's comparison view: the
document panels side by side with changes highlighted, and a list of changes on the right. By
default there are three: the Original, the **Resolved** text (the document as the export would
produce it with the current decisions) and the Edited; two columns (Original | Edited) are a toggle
away.

The motivating use case is editing translations: an editor revises a long manuscript (the sample
pair in `docs/`: `aramlo-part-2-2025-05-06.docx`, ~60 pages, 746 paragraphs, 20 footnotes) and
sometimes delivers only the part revised so far (`aramlo-part-2-2025-05-06.edited-until-p257.docx`,
the first ~76 paragraphs). The edited file may also have been restyled (in the sample, the Palatino
font and colours were removed throughout).

Goals: word-level differences in two synchronized panels; insertions, deletions, replacements,
formatting changes and moves, in the body, footnotes/endnotes and tables; decisions per change, for
all formatting at once, or for all changes; a clean export with a choice for undecided changes;
correct handling of a partially edited document; simple text edits in the Edited panel during the
review; the review remembered in the browser; documents up to ~300 pages; no backend.

## Functional requirements

### Loading documents

1. Two `.docx` files — **Original** (left) and **Edited** (right) — via file pickers and drag-and-drop.
2. Each file's name above its panel.
3. **Swap** exchanges Original and Edited and re-runs the comparison.
4. Non-`.docx` and corrupted files are rejected with a clear message, without crashing.
5. Files are processed locally only; no document content is sent over the network.
6. A progress indicator while the engine downloads and while a comparison runs. Until the app and
   its engine are ready, a "Loading…" modal with a spinner covers the page; it is in the static HTML,
   so it shows before the scripts load. While a comparison runs, a card in place of the drop zones
   shows a ring filling up with the percentage (estimated from the engine's stages), the stage and
   the seconds elapsed. All engine work runs in a Web Worker, so the UI stays responsive during
   comparison, rendering and export.

### Comparison

7. **Word-level** comparison (a changed word is highlighted as a whole word).
8. Change types in the list:
   - **Inserted** — text only in Edited
   - **Deleted** — text only in Original
   - **Replaced** — a deletion and an insertion that touch in the same paragraph (in either order),
     shown as **one** item; the engine reports two revisions, a decision on the item applies to both
   - **Formatting** — same text, different formatting (run, paragraph or section properties)
   - **Moved** — a block relocated, one linked item (source and destination)
   - **Paragraph break** — a paragraph break added or removed with no text change
9. A paragraph-mark revision next to a text change in the same paragraph is folded into that item
   and follows its decision; only those with no such neighbour are **Paragraph break** items. A
   paragraph-mark revision that carries real text (the engine reports a whole run of deleted
   paragraphs this way, e.g. the sample's cut-off tail) is an ordinary Inserted/Deleted item. A
   footnote/endnote that only one version has is folded into the item of the revision that deletes
   (inserts) its reference, so the note and its reference are decided together.
10. Compared parts: **main body**, **footnotes and endnotes**, **tables** (cell-level differences,
    not whole-table replacement).
11. Headers/footers, images and comments are not compared and are preserved unchanged in the export.
12. List-numbering labels that change only because of edits elsewhere ("(3)" → "(4)") are not changes.
13. An input that already contains tracked changes is compared in its *accepted* view, and the user
    is told so.

    13a. The text of both documents is normalized to Unicode NFC before comparing ("a" + U+0304, as
    some macOS input methods produce, matches "ā").

    13b. A change whose text is identical in both versions (e.g. a word set in several runs with
    different fonts in one version and one run in the other, which the engine reports as deletion +
    insertion) is a **Formatting** change, not Replaced. Likewise a typed list number ("1. ")
    replaced by automatic numbering with the same label: the typed number's deletion and the
    paragraph-properties change adding the numbering are one Formatting change.

    13c. A **Compare settings** dialog (toolbar), all options **on** by default: ignore **quote
    style** (straight, curly, low „ and upper ” quotes; single and double stay distinct; also `...`
    vs `…`); ignore **dashes** (hyphen, en dash, em dash, minus); ignore **whitespace** (spaces,
    tabs, line breaks, paragraph breaks, empty paragraphs). A change is ignored when the text of its
    paragraph(s) before and after that change is equal under the enabled options. A change that joins
    or splits words is never ignored. Within a change that is not ignored, words both sides share at
    its start or end under the enabled options are shown as plain text (the engine compares whole
    words, so a quote attached to an unchanged word comes along with the change next to it:
    `szövegek "az` → `szutták szövegei “az` highlights only `szövegek` → `szutták szövegei`).

    13d. Ignored changes are plain text in both panels, are not listed or counted (the number ignored
    is shown), are not part of navigation or bulk actions, and are exported as in the Edited — unless
    the reviewer explicitly decided the change before a setting made it ignored: an explicit decision
    wins (it is kept, and applies on export). Changing the settings does not re-run the comparison.
    The settings are remembered in the browser.

### Partially edited documents (comparison range)

14. After comparison, a **trailing unedited region** is detected: when the last paragraph of the
    Original body is wholly deleted, the deletion covering it marks the region, and its first wholly
    deleted paragraph is the proposed end point. A deletion that only removes some words from the
    last paragraph is an ordinary change. Small changes after it (e.g. a paragraph break inserted at
    the very end) do not prevent the detection.
15. The user is told ("The edited document appears to end at paragraph 76 of the original. The
    remaining N paragraphs are treated as unedited.") in the **Comparison range** dialog, a modal
    opened with the **⇥ Range** button next to Scroll lock in the toolbar; the button's tooltip
    says the same, and it shows ⚠ while a deletion spans the end point. The panels show the range
    all the time (FR-18); the message is not kept on screen.
16. The user can set the end point by paragraph number or by clicking a paragraph in the left panel,
    and can turn the range off (compare the full documents).
17. Every change after the end point — in the body and in notes referenced only from there — is
    **outside the range**: not listed, not counted, always **rejected** on export, so the unedited
    remainder appears in the export **unchanged**. A move counts by its source. Content not in the
    Original that the engine placed after a trailing deleted tail (e.g. the Edited's closing
    paragraph) is inside the range for the detected end point and any later one.
18. In the left panel, content after the end point is marked as outside the comparison (greyed, with
    a divider), not highlighted as deleted.
19. Changing the end point does not re-run the comparison; it only reclassifies the changes, and
    their decisions are kept.

### Side-by-side view

20. The documents as **continuous text** (no page boxes), with readable formatting: headings,
    paragraph styles, bold/italic, lists, tables, footnotes (at the end).
20a. A **Display** option in Compare settings, on by default: the text in every column is shown
    aligned to the left (the start of the line), never justified, as justified text reads poorly in
    narrow columns. Centred and right-aligned text keep their alignment. Kept in the browser with
    the other view settings.
20b. A **Display** option in Compare settings, on by default: paragraphs with no text (blank lines
    made with empty paragraphs) are not shown, in any column. Blank lines one version has and the
    other lacks make the synced panels drift apart between the paragraphs they align (FR-22); the
    sample's Original has 368, its Edited (converted with pandoc) none of its own. A paragraph
    followed by hidden ones keeps a gap after it, about one paragraph spacing. Kept in the
    browser with the other view settings.
21. Left panel: deleted text red, struck through; right panel: inserted text blue, underlined; moves
    their own colour; a small legend. Changes are marked within the text only, with no rules at the
    paragraph edge. Formatting changes have **no mark** in the panels (in a restyled document nearly
    every line has one); they are reviewed through the changes list and the current-change outline.
    In three-column view (FR-25c) the legend also explains the Resolved column's marks (FR-25b):
    **Decided** (yellow, with ✓) and **Undecided** (dotted underline); their tooltips say they apply
    to the Resolved column.
22. The panels scroll **in sync** (the matching paragraph stays aligned in all of them, whichever is
    scrolled).
23. A "Scroll lock" toggle turns sync off.
24. The Original and Edited panels each have a narrow overview bar showing where the changes are;
    clicking scrolls there. The Resolved column has none.
    24a. A collapsible **outline** sidebar on the left lists the headings, indented by level, like a
    table of contents: the Edited's, or the Original's when the Edited has none (only one of them may
    use heading styles). Headings only one version has are struck through (Original only) or
    underlined (Edited only), and those outside the comparison range greyed. Clicking one
    scrolls **all** panels to it (whatever the scroll lock). Collapsed, it is a strip that opens it
    again. **Collapsed by default**; the state is remembered in the browser, not part of a saved
    review.
25. Accepted/rejected changes are distinguishable from undecided ones in the Original and Edited
    panels (dimmed, ✓ / ✗).
    25a. Light and dark colours: the app follows the browser's preference, and an icon button at the
    end of the top bar switches between them (remembered in this browser; switching back to the
    browser's preference follows it again). In dark mode the documents are dark too: their own text,
    highlight and shading colours are adapted, keeping their hue, so that they stay readable.

    25b. The **Resolved** column, between the Original and the Edited, shows the document as the
    export would produce it with the current decisions (FR-39, FR-40, FR-45), undecided changes
    counted as accepted (the export dialog's default, FR-38):
    - an accepted or undecided change shows the Edited's version, a rejected one the Original's; a
      replacement only its inserted or only its deleted text; a move its text at the destination in
      the Edited's wording, or (rejected) at the source in the Original's; table rows, paragraph
      breaks and footnotes/endnotes by the same rules (a note only one version has comes and goes
      with its reference);
    - in-range content the engine placed after the out-of-range region (on the sample: the two move
      destinations and the Edited's closing paragraph) is shown before the divider, where the
      export puts it; the out-of-range tail (FR-17) is shown as in the Original's panel: the
      Original's text, greyed, after the divider (FR-18);
    - changes not offered for decision (ignored, FR-13d; relabelled as formatting, FR-13b; a
      replacement's shared edges; out of range) appear as the export resolves them, unmarked;
    - the text keeps the formatting the side panels show (the Edited's wherever a formatting
      revision exists); it follows neither the formatting choice (FR-30) nor FR-39a. The export
      decides the formatting; the column's header tooltip says so.

    Marks, only on changes offered for decision: a **decided** change has a light yellow background
    and, after its last piece, the ✓ (accepted) or ✗ (rejected) of the side panels, at full
    strength (not dimmed); no red/blue/purple, strike-through or underline. A decision that leaves
    no text (an accepted deletion, a rejected insertion; the source of an accepted move, the
    destination of a rejected one) leaves a **marker** there: the ✓/✗ on yellow. An **undecided**
    change has a dotted underline in a muted colour, and an undecided deletion a small dotted
    marker. Changes and markers can be clicked to select their item (FR-29); the current change has
    the same outline as in the side panels. The column updates right after every decision, bulk
    ones included, without moving the text being read.

    25c. A **columns** icon button in the top bar, before the light/dark toggle, switches between
    **three columns** (Original | Resolved | Edited, the default) and **two** (Original | Edited).
    Its icon shows the view a click switches to; its tooltip says so ("Show two columns" / "Show
    three columns"). The choice is remembered in the browser, not part of a saved review. In a
    window **1024 CSS px wide or narrower** two columns are shown whatever the choice, and the
    button is disabled ("The window is too narrow for three columns"); the stored choice is kept.

### Inline edits in the Edited panel

Added 2026-10-19: the reviewer fixes small mistakes in the Edited's text during the review (a typo
in the editor's new wording, a word the editor forgot to change) without leaving the tool and
without a new comparison. Edited text counts as if the Edited document had contained it from the
start, in every panel, the changes list, the export and the saved review.

25d. **Editable** toggle in the Edited panel's header (pencil icon and label; `aria-pressed` while
    on; tooltip "Edit the Edited text (simple edits within a paragraph)" / "Stop editing"). Only the
    Edited panel has one; the Original panel and the Resolved column are never editable. It is
    **off** whenever a review is shown (after a comparison, a reload, on resuming) and is not
    remembered. While it is on, the panel has an accent outline, editable text an I-beam cursor
    (an arrow elsewhere), and the current change's card (FR-28a) and the ✓/✗ of decided changes
    (FR-25) are not shown in it. Works the same in two and three columns.

25e. While Editable is on, a click in the Edited panel's text places the cursor and does not select
    a change (FR-29 is suspended in that panel only). While the cursor is in the text the
    single-key shortcuts (FR-34) are off and the keys type; Escape leaves the text and they work
    again. Turning Editable off applies any edit still waiting (FR-25h) and restores
    click-to-select.

25f. **What can be edited:** the Edited panel's paragraphs in the body, table cells, footnotes and
    endnotes, and headings, before the comparison range's end point: typing, deleting and
    replacing selected text within **one** paragraph, and pasting **plain text** (line breaks and
    tabs become spaces). Not editable: the out-of-range tail (FR-17), paragraphs with any part of a
    move, paragraphs the Edited lacks, and paragraphs with content the export can't patch (fields,
    content controls, symbols, drawings, …). Inline objects (note references, list numbers, tabs,
    line breaks, images) stay where they are: the reviewer types around them. Paragraphs with an
    inserted or deleted paragraph mark are editable: while Editable is on, the Edited panel shows
    the paragraphs it joins one by one, and joins them again when it is turned off; the marks
    themselves can't be changed.

25g. **Blocked actions** leave the text unchanged and show a short message under the Edited
    header (`role="status"`, ~4 s): Enter / Shift+Enter ("Only simple edits within a paragraph are
    supported, to keep the comparison fast. Paragraph breaks can't be added here."), Backspace at
    the start or Delete at the end of a paragraph ("… Paragraphs can't be joined here."), a
    selection over more than one paragraph ("… Edits must stay within one paragraph."), deleting an
    inline object ("Footnote references and other objects can't be deleted here."), a click in a
    paragraph that can't be edited (the reason: outside the comparison range, a moved passage, a
    field or object). Dragging text is blocked silently.

25h. **Update:** 300 ms after the last keystroke in a paragraph (or when the cursor leaves it, or
    Editable is turned off; never during a composition such as a dead key) that paragraph's changes
    are updated, in every view, without a new comparison. Only the edited part is compared again,
    word by word (FR-7), against the paragraph's Original text; the rest of the paragraph's changes
    stay exactly as they were. Typed text is normalized to NFC (FR-13a). The cursor and selection
    stay where they were in the text, and no panel moves the text being read.

25i. **Which change an edit belongs to.** An edit never changes a decision, merges changes or moves
    text between them; where the text came from decides:
    - text of an existing change's text, and text typed inside it or continuing one of its words,
      stays in **that** change, which keeps its id, decision and comment (a typo fixed inside the
      editor's insertion; an edit inside a rejected change keeps it rejected);
    - everything else the edit adds or removes is a **new** change, **accepted**; a new deletion and
      a new insertion that touch are one new Replaced change. A new change grows with what is typed
      or deleted touching it later, keeping its id, decision and comment; it is never joined with a
      change of the comparison's, even when they touch;
    - a change whose text the edit removes completely, or that no longer differs from the Original
      (the Original's text typed back), disappears; its decision and comment stay in the review
      state for a revert (FR-25m, 25n).
    New and changed changes behave like any other (decisions, comments, navigation, the Resolved
    column, the overview bars, totals, FR-13b–13d, the range) and are not marked as the reviewer's.

25j. Typed text takes the formatting of the character before it, else after it. When an edit
    changes part of a word (a deletion and insertion of the whole word, FR-7), each character of
    the new word takes the formatting of the replaced word's at the same place.

25k. An edited heading stays in the outline (FR-24a) with its new text.

25l. **No undo:** the browser's undo and redo do nothing in the Edited panel; the first Ctrl+Z of an
    editing session says "Undo isn't available here: use ↺ to revert your edits."

25m. **Revert this change:** a change the reviewer's edits created or changed has a ↺ button in its
    card (list and inline card; tooltip "Revert my edit of this change") and, while Editable is off,
    a ↺ icon after its last piece in the Edited panel (in editable text it would trap the cursor).
    After a confirmation it reverts only that change: a new change disappears with its decision and
    comment; a change of the comparison's gets its text as compared back, keeping its id, decision
    and comment. Other edits in the paragraph stay.

25n. **Revert paragraph** (↺ ¶, "Revert my edits in this paragraph": the cursor's paragraph while
    Editable is on, else the current change's) and **Revert all** (↺ all, "Revert all my edits") in
    the Edited header restore the paragraph(s) as compared, the comparison's changes with their
    decisions and comments. Both ask for confirmation, work whether or not Editable is on, and are
    disabled only when there is nothing to revert.

25o. Swap (FR-3), a new comparison and Close review (FR-48) discard the edits. With edits, Swap and
    replacing a file with the toolbar's pickers ask first ("Swapping discards your edits in N
    paragraphs." / "Opening another file discards …").

25p. **Range warning:** edits don't re-detect the range. Moving the end point (FR-16) so that edited
    paragraphs newly fall outside it asks first ("Your edits in N paragraphs will be outside the
    comparison range. Their changes won't be offered for decision, and the export keeps the
    Original's text there."). The edits are kept either way.

25q. **Bold and italic:** Ctrl+B / Ctrl+I (⌘ too), or the header's **B** / **I** buttons (after
    Editable; disabled while it is off; without a selection: "Select text within one paragraph
    first."), on a selection within one paragraph: if all its visible text is bold (italic) it is
    made plain, otherwise all of it bold (italic); deleted text in it is left alone. Text both
    versions have and no formatting change yet gets a new **Formatting** change ("Bold added", …,
    one per action and paragraph), text with the editor's formatting change joins that change, and
    inserted text just changes its look. Formatting is decided by the formatting choice (FR-30), so
    with **Keep the Original's formatting** the export drops these too. Text typed later in or
    after it takes its look (FR-25j); the reverts (FR-25m, 25n) undo it.

25r. **Editing help:** a **?** at the end of the Edited header ("About editing") opens a popover on
    what can be edited and how edits become changes; the general Help (FR-34) shows the same text.

### Changes list

26. All changes in document order. Each item: number, type, removed and/or added text (truncated),
    location (body / footnote N / table), word count change ("−1 +1"). Formatting items describe
    what changed ("Bold removed, Font changed"). A move that carries edits shows both wordings.

    26b. The list can be **collapsed** (» in its header) to a narrow strip showing the number of
    undecided changes, which opens it again. **Collapsed by default**; the state is remembered in
    the browser.
27. **Accept** / **Reject** per item, the current decision shown; a decision can be changed or reset.

    27a. Each button has a joined arrow opening a menu: **Accept/Reject this** (the button's own
    action, `a`/`r`) and **Accept/Reject all undecided until here** (`A`/`R`), which decides the
    undecided items from the start of the list up to and including this one. Decided items keep
    their decision; no confirmation is asked.

    27b. **Accept/Reject this with comment** (in the same menu) decides the item and opens a comment
    box under its card; the comment can be edited there or removed, and is kept when the decision is
    reset or changed. The export adds each non-blank comment of an in-range item as a Word comment
    (by the export's author, FR-38c) on the change's text, or where the text was when the decision
    removes it:

        Accepted:            (or Rejected:, the item's final decision; Undecided: when kept as a tracked change, FR-38b)

        Changed from
        <the Original's text, or (nothing)>
        to
        <the Edited's text, or (nothing)>

        Comment:
        <the comment>

    A change in a footnote or endnote is commented on the note's reference; a move on the side the
    export keeps. A change with inline edits (FR-25i) quotes the edited wording.

    27c. In three-column view each such comment (non-blank, in range, not on a formatting item) is
    shown in a read-only **bubble** under its change in the Resolved column (under its marker when
    the decision removes the text), without the change being selected: the comment text only, not
    the export's wrapper. Bubbles float over the text below with a gap, scroll with it, and are
    pushed down so they never cover one another. An × closes a bubble; a small speech-bubble icon
    after the change (after its ✓/✗) shows or hides it, without selecting the change (tooltip
    "Show comment" / "Hide comment"; Enter and Space work too). All bubbles are open when a review
    is shown, after a reload or on resuming; closing one is not remembered. A new comment's bubble
    opens; a removed or blanked comment takes its bubble and icon away. A **Comments** button with
    the same icon in the column's header hides all bubbles while any is open, otherwise shows them
    all (pressed while any is open; disabled when there are none).

    27d. **Undecided with comment** (in both menus) leaves the item undecided, resetting a decision
    it has, and opens its comment box as in FR-27b: a comment for the change the export keeps as a
    tracked change (FR-38b), or that the undecided choice decides.
28. Clicking an item scrolls **all** panels to it and marks it as current.

    28a. The current change's **card** (as in the list: text, Accept/Reject with their menus,
    comment) also appears in the Edited's panel (never in the Resolved column), below the change with a gap so the next line stays
    readable, whichever way it was selected (panel, list, keyboard). It scrolls with the text; for a
    deletion it sits under the place the deleted text was. An × in its corner (or Escape) hides it
    until the next selection. A **Display** option in Compare settings turns it off (on by default;
    remembered in the browser, not part of a saved review). With it, changes can be reviewed with
    the list collapsed (FR-26b).
29. Clicking a change in any panel (or a marker in the Resolved column, FR-25b) selects its item;
    the clicked panel does not scroll.
30. **Formatting group:** all formatting changes in one collapsible group (on a light gray
    background), **collapsed by default**, with their count. The group itself is hidden by default; a **Fmt** button after Accept all /
    Reject all shows or hides it (the totals always name the formatting choice). Formatting is decided **once for the whole document**: **Keep the Original's
    formatting** / **Use the Edited's formatting** (default: the Edited's). Expanded, the group shows
    the individual items for review only; they have no Accept/Reject of their own.
31. Previous/Next skip formatting items while the group is hidden or collapsed and include them when expanded.
32. **Accept all** / **Reject all**, with confirmation, applying only to undecided changes.
33. **Previous change** / **Next change** buttons.
34. Keyboard shortcuts: `j`/`↓` next, `k`/`↑` previous, `a` accept, `r` reject, `A`/`R` accept/reject
    all undecided until the current change (FR-27a), `u` reset, `?` help. After `a`/`r`/`A`/`R` the
    selection moves to the next undecided change. Listed in a help popover.
35. Totals in the list footer: changes, accepted, rejected, undecided (text and formatting counted
    separately).
36. Responsive with thousands of items (virtualized list).

### Export

37. **Download…** produces a new `.docx`.
38. A dialog asks how to treat undecided changes: **Accept** (default), **Reject** or **Keep as tracked
    changes** (FR-38b), showing how many are undecided, and the formatting choice (FR-30).
    Out-of-range changes are not affected (FR-17). The dialog starts from the choice of the last
    download (remembered in the browser).

    38b. **Keep undecided changes as tracked changes:** every undecided in-range text change stays
    a Word tracked change (insertion, deletion, move, paragraph mark, table row), for a second
    reviewer to decide in Word; everything else is resolved as usual (decided changes, formatting
    by the formatting choice, ignored changes accepted, out-of-range changes rejected). Accepting all
    in Word gives the export with the undecided changes accepted, rejecting all the one with them
    rejected. An undecided change with inline edits is tracked with the edited wording.

    38c. **Author** of the export's comments (FR-27b) and tracked changes (FR-38b), a text field in
    the dialog; their date is the export's time. It is pre-filled with the Edited's author: the
    author of most of its own tracked changes, else its document properties' last author, else
    their creator; when the Edited names none, with the last author typed for a download (an Edited's own author
    is not remembered). Empty means
    "Reviewer". After a download in a review, that review's dialog starts from the author used.
39. The export is **clean**: no tracked-change markup, except the undecided changes with FR-38b.
    Accepted changes take the Edited version, rejected changes keep the Original.

    39a. **One consistent look:** decisions on text changes never mix formatting. All formatting
    follows the formatting choice. Text from the other version — an accepted insertion when the
    Original's formatting is kept, a restored deletion when the Edited's is used — takes the
    formatting of the neighbouring text in the chosen version. This applies inside the comparison
    range only: the unedited tail keeps the Original's look (decided 2026-10-16).
40. Accepting a move places the block at its new position only; rejecting it keeps it at its original
    position only.
41. The Original's styles, numbering, footnotes and other parts are kept, except where accepted
    changes alter them.
42. The export opens in **LibreOffice Writer** without errors or repair prompts and passes Docxodus'
    `verifyDeliverable`.
43. Default filename: `<edited-file-name>.reviewed.docx`.
44. Export of a ~300-page document in under 10 s.
45. Correctness: accept all ≡ Edited text (within the range, plus the unchanged tail); reject all ≡
    Original text; mixed decisions give each accepted change's Edited version and each rejected
    change's Original version. The Edited text is the one with the inline edits (FR-25d …): an
    accepted change gives the reviewer's wording.

### Saving the review

46. The review is saved automatically in IndexedDB: both input files, the range, every decision and
    comment, the formatting choice, the compare settings and the inline edits (FR-25d …), after each
    change.
47. On reopening, the app offers to resume ("Resume review of A → B?") or to start a new one.

    47a. Resuming compares the stored files again and replays the inline edits: the same changes,
    ids, decisions and comments as before. An edit whose paragraph no longer matches (it should not
    happen with the same files and engine version, FR-49) is skipped, and the resume notice says
    "N edits could not be restored."
48. The user can discard the saved review (also **Close review** in the toolbar).
49. Saved decisions are tied to the exact files (SHA-256) and the engine version; otherwise they are
    not applied.
50. Without browser storage (private window, quota) the tool keeps working and says the review will
    not be remembered.

### Deployment

51. Static files, deployable to GitHub Pages at the root or under a subpath (`BASE_PATH`). Published
    at `https://docx-diff.github.io/` from a local build (no CI); the build includes `.nojekyll`.
52. The engine's assets come from the same site (no third-party CDN at run time).
53. After the first visit the app and engine come from a service worker cache, so repeat visits start
    quickly and work offline (GitHub Pages lets browsers cache files for only 10 minutes).

## Non-goals

- Comparing headers/footers, images and comments (preserved, not diffed).
- Paginated (print-layout) rendering; character-level diff; search; filtering the list by type (the
  formatting group is the only grouping); an option to ignore formatting changes entirely.
- Exporting a `.docx` that still contains tracked changes, other than the undecided ones (FR-38b).
- Editing the Original; adding or removing paragraphs, paragraph breaks, line breaks or tabs; editing
  moved text or the out-of-range tail; paragraph formatting, fonts, colours, sizes, underline (only
  bold and italic, FR-25q); inserting or deleting notes, images, fields, hyperlinks or comments; rich
  paste; marking the reviewer's edits as their own layer or author; a re-comparison or a re-detected
  range after edits (FR-25d …).
- Exporting/importing a review as a file; sharing or collaboration.
- More than two documents, or formats other than `.docx`.
- Editing text or comments in the Resolved column; the current change's card there; an overview
  bar for it; a layout for phones or touch input (at 1024 px or narrower: two columns).
- Any server, account or upload.
- Testing in Microsoft Word (not available; LibreOffice and `verifyDeliverable` are the acceptance
  checks). Printing.

## Design

- **Toolbar:** file names / pickers, Swap, Scroll lock, Range (the comparison range's dialog), Previous / Next,
  Download…, Close review, Help (icon; the legend is in its popover). Compare settings, the columns toggle and
  the light/dark toggle are icon buttons with tooltips at the end of the header. A bar below the header
  appears only while picking the range's end point in the left panel.
- **Main area:** Original panel | Resolved column | Edited panel (three columns sharing the width),
  or Original | Edited; the side panels each with its overview bar. The Edited panel's header:
  its file name (shrinking first), then Editable, **B**, **I**, ↺ ¶, ↺ all and **?** (FR-25d …), the
  toggle showing only its pencil in a narrow panel. **Left sidebar:** the outline.
  **Right sidebar:** the changes list, Accept all / Reject all at the top, the formatting group,
  totals at the bottom. Both sidebars start collapsed, so the documents get the width.
- **Colours:** deletions red, insertions blue, moves purple; light yellow means a decided change in
  the Resolved column (so the formatting group and the formatting cards' edge are gray); never
  colour alone (strikethrough, underline, ✓/✗, dotted underline).
- **Empty state:** what the app does (compare, accept/reject, resume a saved review, download the resolved document), two drop
  zones with short instructions, a note that files stay on the user's computer (kept in the browser for
  resuming), and a sketch of the review screen: outline, Original → Resolved ← Edited, changes list, with a
  note that the two sidebars are collapsible.
- Primary target: desktop browser.

## Success metrics

1. With the sample pair, the edited-region end is detected automatically; the list then contains only
   changes in the edited part, with the formatting changes in the collapsed group.
2. Accept all → Edited text (+ unchanged tail); Reject all → Original text. Automated tests.
3. Exports open in LibreOffice without repair prompts and pass `verifyDeliverable`.
4. After the engine has loaded: a ~60-page pair compared and shown in under 10 s, a ~300-page pair in
   under 60 s; export under 10 s; the page never freezes.
5. A review can be closed and resumed with all decisions intact.
6. No network requests other than the site's own static assets; repeat visits work offline.

All six were met at the end of the initial build (2026-10-17); details in
[`measurements.md`](measurements.md#success-metrics-outcomes).

Inline edits (FR-25d …, 2026-10-19): edits round-trip in the export like the editor's text, keep
ids and decisions, and come back after a reload; on the ~60-page sample an update shows within
400 ms of the last keystroke, with no task over 50 ms while typing. On the ~300-page pair it takes
~500 ms, over that target (outcomes in [`measurements.md`](measurements.md#success-metrics-outcomes)).

## Open questions

1. Could the edited region also start later than the beginning (an edited middle section)? Only a
   trailing unedited region is supported.
2. Is the first-load download (~7.9 MB gzipped) acceptable, or is there a size budget?
3. Should the export offer a version with the undecided changes kept as tracked changes, for a second
   reviewer? Decided 2026-10-18: yes, FR-38b.
4. **False moves at the end of the edited part.** With a long deleted tail (more than ~416
   paragraphs), the engine reports the last edited paragraphs before it as moves to after the tail.
   Review and export are correct (moves count by their source, the export puts them back), but the
   list shows two "Moved" items on the sample that are in-place edits. A redesign that compares again
   with the Original's tail cut off fixes it (~6–8 days, with open design questions:
   [`false-moves-at-trailing-tail.md`](false-moves-at-trailing-tail.md)). Do it only if false moves
   show up in real use, or report the cliff upstream to Docxodus.
5. **The Resolved column and formatting.** The Resolved column shows the formatting of the redline
   HTML, not the formatting choice (FR-30) or FR-39a (FR-25b): the converter renders formatting
   revisions with the Edited's properties only, and rewriting `w:rPr` before rendering would change
   the `data-anchor` unids the range and scroll sync rely on. If following the choice is wanted
   later (deferred 2026-10-17), the candidates are: (a) a second HTML rendered from the tagged
   redline with only the formatting revisions rejected, which needs anchors that still match (or
   range and scroll sync keyed by `data-change-id`); (b) CSS overrides from the formatting
   revisions' old properties (run formatting only, not styles or numbering); (c) rendering the real
   export (exact, but ~1 s per decision and no ids for selection). FR-39a would come on top of any
   of them.
