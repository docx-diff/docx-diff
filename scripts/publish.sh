#!/usr/bin/env bash
# Builds the site and commits it into the local clone of the GitHub Pages repository
# (github.com/docx-diff/docx-diff.github.io, served at https://docx-diff.github.io/). There is no CI:
# this script is the deployment. After committing it asks whether to push.
#   scripts/publish.sh [--skip-tests] [--no-push]
# --skip-tests skips typecheck, unit and e2e tests, for publishing again a commit that has just
# passed them (`npm run publish` passes it). --no-push commits without asking and prints the push
# command instead. PAGES_DIR sets the clone (default: ../docx-diff.github.io next to this repo).
set -euo pipefail

skip_tests=0
push=1
for arg in "$@"; do
  case $arg in
    --skip-tests) skip_tests=1 ;;
    --no-push) push=0 ;;
    -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg (see --help)" >&2; exit 2 ;;
  esac
done

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
# The clone must be on the branch GitHub Pages serves (the remote's default branch) and have every
# commit made there, e.g. a CNAME that GitHub adds for a custom domain: otherwise the push is
# rejected, or the copy below deletes the file. Files the site needs belong in public/.
git -C "$pages" fetch -q origin
pages_branch=$(git -C "$pages" ls-remote --symref origin HEAD | sed -n 's|^ref: refs/heads/\(.*\)\tHEAD$|\1|p')
if [ "$(git -C "$pages" rev-parse --abbrev-ref HEAD)" != "$pages_branch" ]; then
  echo "$pages is not on origin's default branch ($pages_branch)" >&2
  exit 1
fi
if ! git -C "$pages" merge-base --is-ancestor "origin/$pages_branch" HEAD; then
  echo "$pages is behind origin/$pages_branch; pull first (git -C $pages pull --ff-only)" >&2
  exit 1
fi
# The build takes the engine from node_modules, which a clean working tree doesn't vouch for.
pinned=$(node -p 'require("./package.json").dependencies.docxodus')
installed=$(node -p 'require("./node_modules/docxodus/package.json").version')
if [ "$installed" != "$pinned" ]; then
  echo "node_modules has docxodus $installed, package.json pins $pinned; run npm install" >&2
  exit 1
fi

if [ "$skip_tests" != 1 ]; then
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
# No terminal to ask on (e.g. piped input): leave the push to the user, as with --no-push.
if [ "$push" = 1 ] && [ -t 0 ]; then
  read -r -p "Push to origin/$pages_branch? [y/N] " answer
  case $answer in
    [yY]|[yY][eE][sS]) git -C "$pages" push; exit 0 ;;
  esac
fi
echo "Committed in $pages. To publish:"
echo "  git -C $pages push"
