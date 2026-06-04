#!/usr/bin/env bash
# Compare key-table row counts between a source and a restored target DB.
# Exits non-zero if any count differs, or if the source has no data.
# Usage: verify-restore.sh --source <conn> --target <conn>
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-pgurl.sh
. "$SCRIPT_DIR/lib-pgurl.sh"

SOURCE=""
TARGET=""
while [ $# -gt 0 ]; do
  case "$1" in
    --source) SOURCE="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [ -z "$SOURCE" ] || [ -z "$TARGET" ]; then
  echo "Error: --source and --target are required" >&2; exit 2
fi
SOURCE="$(strip_schema_param "$SOURCE")"
TARGET="$(strip_schema_param "$TARGET")"

count() { psql "$1" -tAc "SELECT count(*) FROM \"$2\";"; }

total=0
fail=0
for t in User Product Category Order; do
  s="$(count "$SOURCE" "$t")"
  d="$(count "$TARGET" "$t")"
  echo "$t: source=$s target=$d"
  if [ "$s" != "$d" ]; then echo "  MISMATCH for $t" >&2; fail=1; fi
  total=$((total + s))
done

if [ "$total" -eq 0 ]; then
  echo "Source has no data in key tables — not a valid backup to verify" >&2; exit 4
fi
if [ "$fail" -ne 0 ]; then echo "Verification FAILED" >&2; exit 5; fi
echo "Verification PASSED"
