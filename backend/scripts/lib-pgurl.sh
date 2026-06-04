# Shared helper for CartLy DB scripts.
# strip_schema_param: remove the Prisma-only `schema` query parameter from a
# PostgreSQL URL. libpq (pg_dump/pg_restore/psql) rejects `schema=...` but keeps
# params it understands (e.g. sslmode=require for Neon), so we drop ONLY schema.
strip_schema_param() {
  local url="$1" base query newq part
  base="${url%%\?*}"
  if [ "$base" = "$url" ]; then printf '%s' "$url"; return; fi
  query="${url#*\?}"
  newq=""
  local IFS='&'
  read -ra parts <<< "$query"
  for part in "${parts[@]}"; do
    case "$part" in
      schema=*) ;;                                   # drop Prisma-only param
      *) newq="${newq:+$newq&}$part" ;;              # keep everything else
    esac
  done
  if [ -n "$newq" ]; then printf '%s?%s' "$base" "$newq"; else printf '%s' "$base"; fi
}
