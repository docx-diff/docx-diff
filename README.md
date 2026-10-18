# docx-diff

Compare two Word documents (`.docx`) side by side in the browser, accept or reject each change, and download a new `.docx` with your decisions applied.

- Runs entirely in the browser; documents never leave your computer.
- Two panels (original / edited) with changes highlighted, and a list of changes to review one by one or in bulk.
- Detects insertions, deletions, replacements, moved paragraphs and formatting changes, in the body, footnotes/endnotes and tables.
- Handles a partially edited document: the unedited remainder of the original is kept as it is.
- Served as a static site at <https://docx-diff.github.io/> (GitHub Pages); works offline after the first visit.

The comparison engine is [Docxodus](https://github.com/JSv4/Docxodus) (MIT), a .NET OOXML engine compiled to WebAssembly, used through its npm package `docxodus`.

## Usage

Open <https://docx-diff.github.io/>. The comparison engine (~8 MB) loads on the first visit; after that the app and the engine come from the browser's cache and also work offline.

1. Choose the **Original** and the **Edited** `.docx` (or drop them on the page). Both panels show the changes; scrolling is synced.
2. If the Edited document covers only the first part of the Original, the end of the edited part is detected and the rest of the Original is kept as it is. The range bar shows the end point; you can move it or compare the full documents.
3. Go through the changes list: accept or reject each change (keyboard: `j`/`k` or `↓`/`↑` to move, `a` accept, `r` reject, `u` undecided; `?` lists the shortcuts), or decide in bulk. Formatting changes are one group.
4. **Download…** applies your decisions; undecided changes are accepted, rejected or kept as Word tracked changes, as you choose, by the author you give (pre-filled from the Edited document). Otherwise the result is a `.docx` without tracked changes.

The review (files, decisions, range) is saved in the browser and offered again when you come back.

## Status

All planned features are done, and the success metrics are met. Open: whether to remove two misleading "Moved" items at the end of the edited part on long cut-short documents (`docs/false-moves-at-trailing-tail.md`).

## Documentation

- [`docs/requirements.md`](docs/requirements.md) — what the tool does: the numbered requirements (`FR-<n>`, cited in code comments), non-goals, success metrics, open questions.
- [`docs/architecture.md`](docs/architecture.md) — how it works: stack, module map, worker, data flow, change items, rendering, comparison range, export algorithm, saved review, service worker, testing.
- [`docs/measurements.md`](docs/measurements.md) — what the sample pair produces, timings, first-load size, success-metric outcomes.
- Investigations: [`docs/false-moves-at-trailing-tail.md`](docs/false-moves-at-trailing-tail.md) (open), [`docs/closing-note-out-of-range.md`](docs/closing-note-out-of-range.md) (fixed).
- [`CLAUDE.md`](CLAUDE.md) — working notes for Claude Code, including the engine facts that are easy to get wrong.

## Development

```sh
asdf install                      # once: installs the Node version pinned in .tool-versions
npm install                       # once
npx playwright install chromium   # once, for the e2e tests

npm run dev          # dev server at http://localhost:5173/
npm run build        # production build into dist/ (BASE_PATH sets the base path, default /)
npm run preview      # serve dist/
npm test             # unit + engine tests (Vitest; engine tests run the real WASM under Node)
npm run test:e2e     # Playwright: builds and tests in Chromium (also offline, through the service worker)
PERF=1 npx playwright test e2e/perf.spec.ts      # opt-in timing checks against the success-metric budgets
npm run typecheck    # tsc --noEmit
BIG_PAIR=1 npx vitest run test/big-pair.test.ts   # opt-in timing check on a synthetic ~300-page pair
node test/fixtures/make-fixtures.ts               # regenerate the synthetic fixture pairs (commit the .docx files)
EXPORT_DIR=/tmp/exports npx vitest run test/sample-pair.test.ts -t export   # write the sample-pair exports …
scripts/check-libreoffice.sh /tmp/exports/*.docx                           # … and convert them with LibreOffice
```

Node is pinned to **24.22.0** (Active LTS) in `.tool-versions` (asdf). `package.json` `engines` plus `engine-strict` in `.npmrc` make `npm install` fail on a Node outside `^24.22.0`. Details in `CLAUDE.md` ("Node version").

The engine runtime (`node_modules/docxodus/dist/wasm/_framework/`, without the `.br` files) is copied into the build at `<base>/wasm/_framework/` and loaded from there by our own Web Worker (`src/engine/engine.worker.ts`). A service worker (`vite-plugin-pwa`, configured in `vite.config.ts`) precaches the app and every engine file; the app registers it once the engine has loaded (`src/serviceWorker.ts`), since the precache downloads the engine again. There is no service worker in `npm run dev`.

## Publishing

There is no CI. The site is the repository [docx-diff/docx-diff.github.io](https://github.com/docx-diff/docx-diff.github.io), served by GitHub Pages at <https://docx-diff.github.io/>, and is built here:

```sh
git clone git@github.com:docx-diff/docx-diff.github.io.git ../docx-diff.github.io   # once
scripts/publish.sh                            # checks, build, copy into ../docx-diff.github.io, commit there
git -C ../docx-diff.github.io push            # publish
```

`scripts/publish.sh` refuses to run with uncommitted changes (in either repository), when the clone is not on the Pages repository's default branch or is behind it (pull first), or when `node_modules` holds another `docxodus` than the pinned one (run `npm install`). It runs typecheck, unit and e2e tests (`--skip-tests` skips them; `npm run publish` is `scripts/publish.sh --skip-tests`), builds with `BASE_PATH=/`, replaces the clone's files with `dist/` and commits them as `Publish docx-diff <commit>`, then asks whether to push (`--no-push` commits without asking and prints the push command). `PAGES_DIR` sets another clone. The build includes `.nojekyll` (from `public/`): without it GitHub Pages runs Jekyll, which drops the engine's `wasm/_framework/` directory. A new version reaches users on their next page load; an open tab keeps the version it loaded. Since the clone's files are replaced by `dist/`, files the site needs besides the app (e.g. a `CNAME` for a custom domain) go in `public/`. To check an update after pushing: with the site open from an earlier visit, reload twice (the first reload installs the new service worker), and see in DevTools → Application → Cache Storage that only the new build's `assets/` remain.

## Sample documents

The sample document pair used in development and in the tests is committed in `docs/`. Set `SAMPLES_DIR` to use another location; tests that need the pair are skipped when it is missing.

## Reference sources

`refs/` (git-ignored) holds local clones of the projects studied for this tool. To recreate it:

```sh
mkdir -p refs
git clone --depth 1 https://github.com/JSv4/Docxodus refs/Docxodus
git clone --depth 1 https://github.com/JSv4/Python-Redlines refs/Python-Redlines
git clone --depth 1 https://github.com/davidar/pandiff refs/pandiff
```

## License

MIT, see [`LICENSE`](LICENSE). Docxodus and the .NET runtime it ships are MIT-licensed as well.
