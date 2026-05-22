#!/usr/bin/env bash
# Guard against regressions in the shadcn/Tailwind migration.
#
# Exits non-zero if either:
#   1. Any inline `style={{ ... }}` literal in pages/ or components/ contains a
#      hex color value — those should be Tailwind utility classes referencing
#      CSS variable tokens, not hardcoded hex.
#   2. Any file under apps/web/src/ imports from the deleted vendored
#      `theme/components/` tree.
#
# Run from the repo root.
set -u

WEB_SRC="apps/web/src"

if [ ! -d "$WEB_SRC" ]; then
  echo "✗ $WEB_SRC not found — run from repo root."
  exit 2
fi

fail=0

inline_hits=$(grep -rnE 'style=\{\{[^}]*#[0-9a-fA-F]{3,8}' "$WEB_SRC/pages" "$WEB_SRC/components" 2>/dev/null || true)
if [ -n "$inline_hits" ]; then
  echo "✗ Inline hex colors found in style={{ ... }} (FR-011 / SC-003 violation):"
  echo "$inline_hits"
  fail=1
fi

dead_import_hits=$(grep -rn "from ['\"].*theme/components" "$WEB_SRC" 2>/dev/null || true)
if [ -n "$dead_import_hits" ]; then
  echo "✗ Imports from deleted theme/components tree (FR-010 violation):"
  echo "$dead_import_hits"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "✓ check-inline-styles.sh — no inline hex literals, no dead-tree imports."
fi

exit "$fail"
