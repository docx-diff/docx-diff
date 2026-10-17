#!/usr/bin/env bash
# Builds the site and commits it into the local clone of the GitHub Pages repository
# (github.com/docx-diff/docx-diff.github.io, served at https://docx-diff.github.io/). There is no CI:
# this script is the deployment. It does not push; it prints the command to do so.
#   scripts/publish.sh
# PAGES_DIR sets the clone (default: ../docx-diff.github.io next to this repo). SKIP_TESTS=1 skips
# the checks, for publishing again a commit that has just passed them.
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
pages=${PAGES_DIR:-$repo/../docx-diff.github.io}
cd "$repo"

[ -d "$pages/.git" ] || { echo "not a git clone: $pages" >&2; exit 2; }
pages=$(cd "$pages" && pwd)
# A published build must match a commit of this repo.
if [ -n "$(git status --porcelain)" ]; then
  echo "this repository has uncommitted changes; commit them first" >&2
  exit 1
fi
if [ -n "$(git -C "$pages" status --porcelain)" ]; then
  echo "$pages has uncommitted changes" >&2
  exit 1
fi

if [ "${SKIP_TESTS:-}" != 1 ]; then
  npm run typecheck
  npm test
  npm run test:e2e
fi

BASE_PATH=/ npm run build

# Replace everything but the clone's .git, so files dropped from the build leave the site too.
rsync -a --delete --exclude /.git dist/ "$pages/"
# Without it, GitHub Pages runs Jekyll, which drops directories starting with "_": the engine's wasm/_framework/.
[ -f "$pages/.nojekyll" ] || { echo "the build has no .nojekyll (public/.nojekyll missing?)" >&2; exit 1; }
[ -f "$pages/wasm/_framework/dotnet.js" ] || { echo "the build has no engine in wasm/_framework/" >&2; exit 1; }

source_commit=$(git rev-parse --short HEAD)
git -C "$pages" add -A
if git -C "$pages" diff --cached --quiet; then
  echo "Nothing changed: $pages already holds this build."
  exit 0
fi
git -C "$pages" commit -q -m "Publish docx-diff $source_commit"
git -C "$pages" log --oneline -1
echo
echo "Committed in $pages. To publish:"
echo "  git -C $pages push"
