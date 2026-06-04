#!/usr/bin/env bash
# Restore a CartLy custom-format dump into a TARGET database (destructive).
# Usage: db-restore.sh --file <dump> [--url <conn>] --yes [--allow-prod]
#   --file        path to a .dump produced by db-backup.sh
#   --url         target connection string (default: $DATABASE_URL)
#   --yes         required: confirms the target will be overwritten
#   --allow-prod  required IF the target host matches PROD_DB_HOST_PATTERN
# PROD_DB_HOST_PATTERN defaults to "neon.tech".
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-pgurl.sh
. "$SCRIPT_DIR/lib-pgurl.sh"

URL="${DATABASE_URL:-}"
FILE=""
CONFIRM="no"
ALLOW_PROD="no"
PROD_DB_HOST_PATTERN="${PROD_DB_HOST_PATTERN:-neon.tech}"
while [ $# -gt 0 ]; do
  case "$1" in
    --file) FILE="$2"; shift 2 ;;
    --url) URL="$2"; shift 2 ;;
    --yes) CONFIRM="yes"; shift ;;
    --allow-prod) ALLOW_PROD="yes"; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [ -z "$URL" ]; then echo "Error: no target connection string" >&2; exit 2; fi
if [ -z "$FILE" ]; then echo "Error: no --file" >&2; exit 2; fi
if [ ! -f "$FILE" ]; then echo "Error: file not found: $FILE" >&2; exit 2; fi
if [ "$CONFIRM" != "yes" ]; then
  echo "Refusing to restore without --yes (this overwrites the target database)" >&2; exit 3
fi
case "$URL" in
  *"$PROD_DB_HOST_PATTERN"*)
    if [ "$ALLOW_PROD" != "yes" ]; then
      echo "Refusing: target looks like production ($PROD_DB_HOST_PATTERN). Pass --allow-prod to override." >&2
      exit 3
    fi
    ;;
esac

URL="$(strip_schema_param "$URL")"
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$URL" "$FILE"
echo "Restore complete into target."
