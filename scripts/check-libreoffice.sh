#!/usr/bin/env bash
# Converts each given .docx to .odt with headless LibreOffice and fails when a conversion fails
# or produces no output (FR-42). LibreOffice runs with its own temporary profile, so it neither
# needs nor disturbs a running LibreOffice.
#   scripts/check-libreoffice.sh export1.docx export2.docx …
# To check the sample-pair exports:
#   EXPORT_DIR=/tmp/exports npx vitest run test/sample-pair.test.ts -t export
#   scripts/check-libreoffice.sh /tmp/exports/*.docx
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 file.docx…" >&2
  exit 2
fi
command -v soffice >/dev/null || { echo "soffice (LibreOffice) not found" >&2; exit 2; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

failed=0
for file in "$@"; do
  name=$(basename "$file" .docx)
  if ! soffice -env:UserInstallation="file://$work/profile" --headless --convert-to odt --outdir "$work/out" "$file" >"$work/log" 2>&1; then
    echo "FAIL $file: soffice exited with an error" >&2
    cat "$work/log" >&2
    failed=1
  elif [ ! -s "$work/out/$name.odt" ]; then
    echo "FAIL $file: no output" >&2
    cat "$work/log" >&2
    failed=1
  else
    echo "ok   $file ($(stat -c %s "$work/out/$name.odt") bytes as .odt)"
  fi
done
exit "$failed"
