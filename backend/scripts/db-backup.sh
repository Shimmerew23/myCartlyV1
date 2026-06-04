#!/usr/bin/env bash
# Logical backup of a CartLy PostgreSQL database (pg_dump custom format).
# Usage: db-backup.sh [--url <conn>] [--out <dir>]
#   --url  connection string (default: $DATABASE_URL)
#   --out  output directory (default: ./backups)
# On success prints the absolute path of the created dump as the only stdout line.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-pgurl.sh
. "$SCRIPT_DIR/lib-pgurl.sh"

URL="${DATABASE_URL:-}"
OUT_DIR="./backups"
while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [ -z "$URL" ]; then
  echo "Error: no connection string (pass --url or set DATABASE_URL)" >&2; exit 2
fi

URL="$(strip_schema_param "$URL")"
mkdir -p "$OUT_DIR"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="$OUT_DIR/cartly-backup-$TS.dump"
pg_dump --format=custom --no-owner --no-privileges --dbname="$URL" --file="$OUT_FILE"
echo "$(cd "$(dirname "$OUT_FILE")" && pwd)/$(basename "$OUT_FILE")"
