# CLAUDE.md

In-browser DOCX compare/review/export tool (React + TypeScript + Vite, deployed to GitHub Pages). The comparison engine is the `docxodus` npm package (.NET compiled to WASM), pinned to exactly `13.0.0`.

## Where things are

- `tasks/*-prd---docx-diff.md` — requirements. §7 holds the technical design and the engine facts measured during planning. Read it before changing the engine, export or range logic.
- `tasks/*-tasks-docx-diff.md` — the task list. Check off sub-tasks as they are completed.
- `tasks/reference/reject-all-prototype.py` — Python prototype of the export rewrite (reference only).
- `refs/` (git-ignored) — reference sources: `refs/Docxodus` (engine C# source, `npm/src` wrapper, `docs/architecture/ir_diff_engine.md`), `refs/Python-Redlines`, `refs/pandiff`. See README for re-cloning.
- `../docs/` (outside the repo) — the sample documents and the Draftable reference screenshot. Never copy them into the repo. Tests reach them through `test/samples.ts` (`SAMPLES_DIR`, default `../docs/`) and skip when they are absent.

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
1. Edit `.tool-versions`, `engines` in `package.json` (and later `.github/workflows/pages.yml`, which reads `.tool-versions` through `actions/setup-node`'s `node-version-file`).
2. `asdf install` in the repo. If it says `node-build: definition not found`, the plugin's version list is stale: run `asdf plugin update nodejs`, then `git -C ~/.asdf/plugins/nodejs/.node-build pull --ff-only`, and retry.
3. `rm -rf node_modules && npm install`, then run typecheck, `npm test` and `npm run test:e2e`.

Why 24: Node 20 is end-of-life, and the current Vite 8, Vitest 5, jsdom 30 and `vite-plugin-static-copy` 4 require Node ≥ 22. Node 26 is not LTS yet (expected late October 2026).

## Commands

- `npm run dev` / `npm run build` / `npm run preview` — Vite; `BASE_PATH=/<repo>/` sets the base path (default `/`).
- `npm test` — Vitest: project `unit` (jsdom, `src/**/*.test.ts(x)`) and project `engine` (Node, `src/engine/**/*.test.ts` and `test/**/*.test.ts`, real WASM). One file: `npx vitest run src/engine/client.test.ts`.
- `npm run test:e2e` — Playwright (Chromium) against a build served by `vite preview` under `/docx-diff/`.
- `npm run typecheck` — `tsc --noEmit`.
- `vite-plugin-static-copy` v4 keeps source directory structure unless `rename: { stripBase: true }`; without it the engine lands at `dist/wasm/_framework/node_modules/…` and fails to load.

## Engine facts that are easy to get wrong

Verified during planning (PRD §7); don't re-derive them, and don't regress them.

- **Compare with `docxDiffCompare`**, never `compareDocuments`, with exactly `{ preAcceptInputRevisions: true, compareHeadersFooters: false, trackNumberingChanges: false, detectMoves: true }` (`src/engine/settings.ts`).
- **Never apply decisions through `DocxSession`** (`acceptRevision`/`rejectRevision`/`acceptAllRevisions`): ~100 ms per revision, ~70 s for accept-all on the sample, and ids get invalidated mid-way. Export = rewrite rejected revisions in the XML so that accepting gives the original version, then one stateless `docxDiffAcceptRevisions` (~1 s).
- **`DOMParser` does not exist in Web Workers.** Worker-side XML goes through `@xmldom/xmldom`; the native `DOMParser` is only for the main thread.
- **Schema order matters** when restoring properties: after a rejected `w:pPrChange`, the old properties come first, then `w:rPr`, then `w:sectPr`. Wrong order still gives the right text but fails `verifyDeliverable`.
- **The HTML has no revision ids.** We put them there by rewriting each revision's `w:author` to `rev:<revisionId>` before `convertDocxToHtml`; the untagged redline is the one exported.
- **The redline XML has no anchor ids.** Block anchors (`affectedAnchors[].unid`) match the rendered HTML's `data-anchor`; the range logic works on the HTML index.
- **The worker proxy `docxodus/worker` lacks revision APIs**; we use our own module worker importing `docxodus/core`.
- Formatting revisions are interleaved with content revisions in `getRevisions` output: skip them when pairing Replaced items or folding paragraph marks. Replaced pairs occur in **both** orders.
- Comparison output is deterministic (same inputs + engine version → identical bytes and revision ids); saved reviews rely on this.
- Docxodus runs under Node, so engine tests run in Vitest with the real WASM (`test/node-engine.ts`).
- `getVersion()` does not report the npm package version; use `__DOCXODUS_VERSION__` (injected by `vite.config.ts`), e.g. via `engineVersion()` in `src/engine/docxodus.ts`.

## Checks

- Round trip: accept-all export ≡ Edited text, reject-all export ≡ Original text (`test/text.ts`).
- Exports must pass `verifyDeliverable` (`passed` / `passedWithPreExistingFindings`) and convert with `scripts/check-libreoffice.sh` (LibreOffice; Word isn't available).

## Conventions

- Solo local repo: commit on `main`.
- Unit tests sit next to the code (`foo.ts` + `foo.test.ts`); e2e tests in `e2e/`.
