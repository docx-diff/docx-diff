# docx-diff

Compare two Word documents (`.docx`) side by side in the browser, accept or reject each change, and download a new `.docx` with your decisions applied.

- Runs entirely in the browser; documents never leave your computer.
- Two panels (original / edited) with changes highlighted, and a list of changes to review one by one or in bulk.
- Detects insertions, deletions, replacements, moved paragraphs and formatting changes, in the body, footnotes/endnotes and tables.
- Handles a partially edited document: the unedited remainder of the original is kept as it is.
- Deployed as a static site on GitHub Pages.

The comparison engine is [Docxodus](https://github.com/JSv4/Docxodus) (MIT), a .NET OOXML engine compiled to WebAssembly, used through its npm package `docxodus`.

## Status

Implementation has started: the project scaffold loads the engine in a Web Worker (task 1). Comparing and reviewing documents comes next.

- Requirements: [`tasks/2026-10-15-203451-prd---docx-diff.md`](tasks/2026-10-15-203451-prd---docx-diff.md)
- Task list: [`tasks/2026-10-15-203451-tasks-docx-diff.md`](tasks/2026-10-15-203451-tasks-docx-diff.md)

## Development

```sh
asdf install                      # once: installs the Node version pinned in .tool-versions
npm install                       # once
npx playwright install chromium   # once, for the e2e tests

npm run dev          # dev server at http://localhost:5173/
npm run build        # production build into dist/ (set BASE_PATH=/<repo>/ for GitHub Pages)
npm run preview      # serve dist/
npm test             # unit + engine tests (Vitest; engine tests run the real WASM under Node)
npm run test:e2e     # Playwright: builds with BASE_PATH=/docx-diff/ and tests in Chromium
npm run typecheck    # tsc --noEmit
```

Node is pinned to **24.22.0** (Active LTS) in `.tool-versions` (asdf). `package.json` `engines` plus `engine-strict` in `.npmrc` make `npm install` fail on a Node outside `^24.22.0`. Details in `CLAUDE.md` ("Node version").

The engine runtime (`node_modules/docxodus/dist/wasm/_framework/`, without the `.br` files) is copied into the build at `<base>/wasm/_framework/` and loaded from there by our own Web Worker (`src/engine/engine.worker.ts`).

## Sample documents

The sample documents used in development and some tests live **outside** this repository, in `../docs/` (reference material only, not committed). Tests that need them are skipped when they are missing. Set `SAMPLES_DIR` to use another location.

## Reference sources

`refs/` (git-ignored) holds local clones of the projects studied for this tool. To recreate it:

```sh
mkdir -p refs
git clone --depth 1 https://github.com/JSv4/Docxodus refs/Docxodus
git clone --depth 1 https://github.com/JSv4/Python-Redlines refs/Python-Redlines
git clone --depth 1 https://github.com/davidar/pandiff refs/pandiff
```

## License

Not yet chosen.
