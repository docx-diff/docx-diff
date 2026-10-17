# CLAUDE.md

In-browser DOCX compare/review/export tool (React + TypeScript + Vite, published to GitHub Pages at https://docx-diff.github.io/ from a local build). The comparison engine is the `docxodus` npm package (.NET compiled to WASM), pinned to exactly `13.0.0`.

## Where things are

- `docs/requirements.md` — requirements, numbered `FR-<n>` (code comments cite them; keep the numbers stable, add `13e`-style sub-items instead of renumbering), non-goals, success metrics, open questions.
- `docs/architecture.md` — the technical design and the reasoning behind the engine facts below. Read it before changing the engine, export or range logic, and update it with the code.
- `docs/measurements.md` — sample-pair counts (most pinned by `test/sample-pair.test.ts`), timings, first-load size, success-metric outcomes. Update it when a change moves these numbers.
- `docs/false-moves-at-trailing-tail.md` (open question 4), `docs/closing-note-out-of-range.md` (fixed) — investigation notes.
- `docs/reference/reject-all-prototype.py` — Python prototype of the export rewrite (reference only).
- `refs/` (git-ignored) — reference sources: `refs/Docxodus` (engine C# source, `npm/src` wrapper, `docs/architecture/ir_diff_engine.md`), `refs/Python-Redlines`, `refs/pandiff`. See README for re-cloning.
- `docs/*.docx` — the sample document pair (committed). Tests reach it through `test/samples.ts` (`SAMPLES_DIR`, default `docs/`) and skip when it is absent. The Draftable reference screenshot is not in the repo.

## Node version (check before running anything)

The project runs on **Node 24.22.0** (Active LTS), managed by **asdf**. It is pinned in three places; change all three together:

| File | Setting | Effect |
|---|---|---|
| `.tool-versions` | `nodejs 24.22.0` | asdf picks this version for `node`, `npm` and `npx` inside the repo |
| `package.json` | `"engines": { "node": "^24.22.0" }` | the supported range |
| `.npmrc` | `engine-strict=true` | `npm install` fails with `EBADENGINE` on a Node outside `engines` |

How it applies:
- `node`/`npm`/`npx` are asdf shims (`~/.asdf/shims`). A shim looks for the nearest `.tool-versions`, starting in the **current directory** and going up, then falls back to the user's global `~/.tool-versions`. So run commands with the repo (or a subfolder) as the working directory. A command run elsewhere gets the global default, which happens to be 24.22.0 now but can change independently.
- npm scripts, Vitest and the Playwright `webServer` (which runs `npm` in the repo) inherit the Node that started them, so they follow the pin as long as the top-level command did.
- Only `npm install` checks `engines`; `npm run` and `npx` do not. Confirm with `node --version` (expect `v24.22.0`) or `asdf current nodejs` (source should be this repo's `.tool-versions`) when output looks odd.
- Don't bypass a version error with `--engine-strict=false` or `ASDF_NODEJS_VERSION`; fix the asdf setup instead.

To bump the version:
1. Edit `.tool-versions`, `engines` in `package.json` (there is no CI: the site is built and published locally, see `scripts/publish.sh`).
2. `asdf install` in the repo. If it says `node-build: definition not found`, the plugin's version list is stale: run `asdf plugin update nodejs`, then `git -C ~/.asdf/plugins/nodejs/.node-build pull --ff-only`, and retry.
3. `rm -rf node_modules && npm install`, then run typecheck, `npm test` and `npm run test:e2e`.

Why 24: Node 20 is end-of-life, and the current Vite 8, Vitest 5, jsdom 30 and `vite-plugin-static-copy` 4 require Node ≥ 22. Node 26 is not LTS yet (expected late October 2026).

## Commands

- `npm run dev` / `npm run build` / `npm run preview` — Vite; `BASE_PATH=/<subpath>/` sets the base path (default `/`, which is what is published).
- `scripts/publish.sh` — the deployment (no CI): checks, `BASE_PATH=/` build, copy of `dist/` into the local clone of `docx-diff/docx-diff.github.io` (`PAGES_DIR`, default `../docx-diff.github.io`), commit there. Pushing is the user's call. The build must contain `.nojekyll` (`public/.nojekyll`): Jekyll would drop `wasm/_framework/`. The copy replaces everything in the clone, so files the site needs besides the app (e.g. `CNAME`) go in `public/`. The service worker falls back to `index.html` only for the app's own page (`navigateFallbackAllowlist`): its scope is the whole origin, which also serves the org's other Pages sites.
- `npm test` — Vitest: project `unit` (jsdom, `src/**/*.test.ts(x)`) and project `engine` (Node, `src/engine/**/*.test.ts` and `test/**/*.test.ts`, real WASM). One file: `npx vitest run src/engine/client.test.ts`. The sample-pair checks share one compare in `test/sample-pair.test.ts`; the ~300-page timing check runs only with `BIG_PAIR=1`.
- `npm run test:e2e` — Playwright (Chromium) against a build served by `vite preview` at `/`. `PERF=1` adds the timing checks in `e2e/perf.spec.ts`.
- `npm run typecheck` — `tsc --noEmit`.
- `node test/fixtures/make-fixtures.ts` — regenerates the synthetic fixture pairs in `test/fixtures/` (one per markup kind; hand-written OOXML, deterministic bytes). Commit the `.docx` files.
- `scripts/check-libreoffice.sh <files>` — converts exports to `.odt` with headless LibreOffice (own temporary profile) and fails on errors. `EXPORT_DIR=<dir>` makes the export tests (`src/engine/exportDocx.test.ts`, `test/sample-pair.test.ts -t export`) write their exports there.
- `vite-plugin-static-copy` v4 keeps source directory structure unless `rename: { stripBase: true }`; without it the engine lands at `dist/wasm/_framework/node_modules/…` and fails to load.

## Engine facts that are easy to get wrong

Verified during planning and the build (details in `docs/architecture.md`); don't re-derive them, and don't regress them.

- **Compare with `docxDiffCompare`**, never `compareDocuments`, with exactly `{ preAcceptInputRevisions: true, compareHeadersFooters: false, trackNumberingChanges: false, detectMoves: true }` (`src/engine/settings.ts`).
- **Never apply decisions through `DocxSession`** (`acceptRevision`/`rejectRevision`/`acceptAllRevisions`): ~100 ms per revision, ~70 s for accept-all on the sample, and ids get invalidated mid-way. Export = rewrite rejected revisions in the XML so that accepting gives the original version, then one stateless `docxDiffAcceptRevisions` (~1 s).
- **`DOMParser` does not exist in Web Workers.** Worker-side XML goes through `@xmldom/xmldom`; the native `DOMParser` is only for the main thread.
- **xmldom's `getElementsByTagNameNS` lists are live:** after any change to the document (even cloning nodes into it), the next `item()`/`length` walks the whole document again. Copy a list into an array before changing the document (quadratic otherwise: 35 s instead of 0.2 s on the sample).
- **Schema order matters** when restoring properties: after a rejected `w:pPrChange`, the old properties come first, then `w:rPr`, then `w:sectPr`. Wrong order still gives the right text but fails `verifyDeliverable`.
- **The HTML has no revision ids.** We put them there by rewriting each revision's `w:author` to `rev:<revisionId>` before `convertDocxToHtml`; the untagged redline is the one exported.
- **The redline XML has no anchor ids.** Block anchors (`affectedAnchors[].unid`) match the rendered HTML's `data-anchor`; the range logic works on the HTML index.
- **The worker proxy `docxodus/worker` lacks revision APIs**; we use our own module worker importing `docxodus/core`.
- Formatting revisions are interleaved with content revisions in `getRevisions` output: skip them when pairing Replaced items or folding paragraph marks. Replaced pairs occur in **both** orders.
- Export = `rejectRevisions` (`src/engine/rejectRewrite.ts`, rule chosen by where the element sits, not by the key's `kind=`), with `planConsistentLook` (`src/engine/consistentLook.ts`, FR-39a) and `planRangeOrder` (`src/engine/rangeOrder.ts`: in-range content the engine placed after the out-of-range region goes back before it) planned before and applied after it per part → `docxDiffAcceptRevisions` → `reconcileNotes` (`src/engine/notes.ts`): decisions can separate a footnote reference from its note (the engine reports a reference that moved as delete + insert of the same note id), giving notes referenced twice (fails `verifyDeliverable`), orphaned, or left without a paragraph.
- Table rows come as `row_insert`/`row_delete` with a `RowMark` key (`w:trPr/w:ins|del`) plus keys for every run and paragraph mark of the row; the engine emits no `w:cellIns`/`w:cellDel` or `w:tblPrExChange` for our fixtures (the rules exist anyway).
- Moves can carry edits: `w:moveFrom` holds the Original wording and `w:moveTo` the Edited one (both sample moves do).
- The comparison range places a move by its **source** only (`classify` in `src/model/range.ts`): the sample's two moves go from just before the end point to after the deleted tail, and are in range.
- Blocks not in the Original that the engine placed **after a trailing deleted tail** sit just before the detected end point (`blockPositions(index, suggestedEndPoint)`), so the Edited's closing paragraph is in range. Pass the detected end point; the run of Original paragraphs the Edited lacks starts earlier on the sample (159 vs 168).
- Paragraph-mark revisions put `data-change-id` on the **block** (`p.rev-para-ins`/`rev-para-del`), not just on inline `ins`/`del`: styling by change class must target `:is(ins, del)` or it hits whole paragraphs.
- **The HTML converter drops tracked changes inside `w:hyperlink`** (it renders only the link's direct `w:r` children). `tagRedline` points such links to a missing relationship, which makes the converter render their children. Never restructure the XML before rendering: `data-anchor` unids hash each element's text and descendant element names, so the anchors would stop matching `affectedAnchors` (attributes don't count).
- A footnote/endnote only one version has is folded into the item of the revision that deletes/inserts its reference (`foldWholeNotes` in `src/model/changes.ts`), like bare paragraph marks; a note both versions have (edited, or reference moved) keeps its own items.
- Comparison output is deterministic (same inputs + engine version → identical bytes and revision ids); saved reviews rely on this.
- Docxodus runs under Node, so engine tests run in Vitest with the real WASM (`test/node-engine.ts`).
- `getVersion()` does not report the npm package version; use `__DOCXODUS_VERSION__` (injected by `vite.config.ts`), e.g. via `engineVersion()` in `src/engine/docxodus.ts`.

## Checks

- Round trip: accept-all export ≡ Edited text, reject-all export ≡ Original text (`test/text.ts`, checked against `pandoc -t plain` in `test/text.test.ts`). Mixed decisions: on the fixtures each single revision decided against the rest ≡ the engine's own `DocxSession` decision (XML too); on the sample, ≡ `test/expectedText.ts` (an independent text model of the redline).
- Exports must pass `verifyDeliverable` (`passed` / `passedWithPreExistingFindings`; `test/deliverable.ts`) and convert with `scripts/check-libreoffice.sh` (LibreOffice; Word isn't available).

## Conventions

- Solo local repo: commit on `main`.
- Unit tests sit next to the code (`foo.ts` + `foo.test.ts`); e2e tests in `e2e/`.
