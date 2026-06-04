# Phase 3E — Backups, DR & Secrets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CartLy's production data recoverable and its secrets externalized, with the recovery path proven by an automated CI restore drill.

**Architecture:** Add POSIX shell scripts (`backend/scripts/`) for logical `pg_dump`/`pg_restore` backup/restore plus a row-count verifier, exercised by a new `restore-drill` CI job; add a weekly GitHub Actions workflow that produces an **encrypted** off-Neon dump artifact (the repo is public, so plaintext dumps must never be uploaded); harden `render.yaml` with `sync: false` secret declarations; add a gitleaks pre-commit hook; and write two operator runbooks (disaster-recovery, secrets-and-config).

**Tech Stack:** Bash, PostgreSQL client tools (`pg_dump`/`pg_restore`/`psql`), GitHub Actions, gnupg (AES256), gitleaks, Render Blueprint YAML, Prisma (seed for drill data).

**Spec:** [docs/superpowers/specs/2026-06-04-phase3e-backups-dr-secrets-design.md](../specs/2026-06-04-phase3e-backups-dr-secrets-design.md)

**Standing constraints (read before any commit):**
- Work on the `develop` branch. Commit explicit paths only — **never** `git add -A`/`git add .`. Never stage `.env`, `.env.test`, or `.claudeignore` (the latter is intentionally untracked).
- Every commit message ends with the trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- These are ops/scripts/docs, not app code — there are no Jest/Vitest tests to add. Verification is done by running the scripts/YAML parsers/local drills described in each task. `npm run lint`/`build` are unaffected.

**Critical gotcha (applies to every script):** Prisma connection URLs carry a `?schema=public` query parameter. `libpq` (used by `pg_dump`/`pg_restore`/`psql`) **rejects** `schema=...` but accepts params it knows (e.g. `sslmode=require`, which Neon needs). Every script therefore strips only the `schema` param via the shared `strip_schema_param` helper (Task 1) before invoking libpq tools. Do not strip the whole query string.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/scripts/lib-pgurl.sh` (create) | Shared `strip_schema_param` helper sourced by the other scripts |
| `backend/scripts/db-backup.sh` (create) | `pg_dump -Fc` a DB to a timestamped `.dump`; prints the path |
| `backend/scripts/db-restore.sh` (create) | `pg_restore` a dump into a target DB, with `--yes` + anti-prod guards |
| `backend/scripts/verify-restore.sh` (create) | Compare key-table row counts source vs target; non-zero on mismatch/empty |
| `backend/package.json` (modify) | Add `db:backup` / `db:restore` npm scripts |
| `.gitattributes` (modify) | Force `eol=lf` for `*.sh` + the hook so CI never gets CRLF |
| `.github/workflows/ci.yml` (modify) | Add the `restore-drill` job |
| `.github/workflows/db-backup.yml` (create) | Weekly encrypted off-Neon dump → 30-day artifact |
| `backend/render.yaml` (modify) | Declare required secrets as `sync: false` |
| `.gitleaks.toml` (create) | gitleaks config: defaults + allowlist for `.env.example` placeholders |
| `scripts/hooks/pre-commit` (create) | Local pre-commit secret scan via gitleaks |
| `docs/runbooks/disaster-recovery.md` (create) | DR runbook (RPO/RTO, restore procedures, post-restore checklist) |
| `docs/runbooks/secrets-and-config.md` (create) | Env inventory + rotation procedures + bootstrap checklist |
| `docs/ROADMAP.md` (modify) | Mark 3E done |
| `CLAUDE.md` (modify) | Add a "Backups, DR & secrets" note |

---

## Task 1: Backup / restore / verify scripts

**Files:**
- Create: `backend/scripts/lib-pgurl.sh`
- Create: `backend/scripts/db-backup.sh`
- Create: `backend/scripts/db-restore.sh`
- Create: `backend/scripts/verify-restore.sh`
- Modify: `backend/package.json` (scripts block)
- Modify: `.gitattributes`

- [ ] **Step 1: Ensure shell scripts stay LF**

Append to `.gitattributes`:

```gitattributes
# Shell scripts and git hooks must use LF (they run in Linux CI / git hooks)
*.sh text eol=lf
scripts/hooks/pre-commit text eol=lf
```

- [ ] **Step 2: Write the shared URL helper**

Create `backend/scripts/lib-pgurl.sh`:

```bash
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
```

- [ ] **Step 3: Write the backup script**

Create `backend/scripts/db-backup.sh`:

```bash
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
```

- [ ] **Step 4: Write the restore script**

Create `backend/scripts/db-restore.sh`:

```bash
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
```

- [ ] **Step 5: Write the verify script**

Create `backend/scripts/verify-restore.sh`:

```bash
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
```

- [ ] **Step 6: Add npm convenience scripts**

In `backend/package.json`, add these two lines to the `"scripts"` block (after the `"test"` line; add a comma to the previous line):

```json
    "test": "cross-env NODE_ENV=test jest --runInBand",
    "db:backup": "bash scripts/db-backup.sh",
    "db:restore": "bash scripts/db-restore.sh"
```

- [ ] **Step 7: Verify the scripts with a local drill**

Bring up a local Postgres and run a full backup→restore→verify cycle. From repo root:

```bash
docker-compose up -d postgres
# wait for health, then from backend/:
cd backend
SRC="postgresql://cartly:cartlypass@localhost:5433/cartly_ecommerce?schema=public"
TGT="postgresql://cartly:cartlypass@localhost:5433/cartly_restore?schema=public"
DATABASE_URL="$SRC" npx prisma migrate deploy
DATABASE_URL="$SRC" npm run seed
DUMP=$(bash scripts/db-backup.sh --url "$SRC" --out ./backups)
psql "postgresql://cartly:cartlypass@localhost:5433/cartly_ecommerce" -c "DROP DATABASE IF EXISTS cartly_restore;"
psql "postgresql://cartly:cartlypass@localhost:5433/cartly_ecommerce" -c "CREATE DATABASE cartly_restore;"
DATABASE_URL="$TGT" npx prisma migrate deploy   # create schema in target before data restore is OPTIONAL — restore --clean handles it; skip if it errors
bash scripts/db-restore.sh --file "$DUMP" --url "$TGT" --yes
bash scripts/verify-restore.sh --source "$SRC" --target "$TGT"
```

Expected final line: `Verification PASSED`. (If `psql`/`pg_dump` are not installed locally, this drill is also run in CI in Task 2 — note that and proceed; do not skip writing the scripts.)

Also confirm the guards work:

```bash
bash scripts/db-restore.sh --file "$DUMP" --url "$TGT"            # expect exit 3, "Refusing ... without --yes"
bash scripts/db-restore.sh --file "$DUMP" --url "postgres://x.neon.tech/db" --yes   # expect exit 3, "looks like production"
```

- [ ] **Step 8: Commit**

```bash
git add backend/scripts/lib-pgurl.sh backend/scripts/db-backup.sh backend/scripts/db-restore.sh backend/scripts/verify-restore.sh backend/package.json .gitattributes
git commit -m "feat(ops): pg_dump backup/restore/verify scripts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: CI restore drill

**Files:**
- Modify: `.github/workflows/ci.yml` (add a new `restore-drill` job after the `e2e` job)

- [ ] **Step 1: Add the restore-drill job**

Append this job to `.github/workflows/ci.yml` (keep two-space indentation; it is a sibling of `backend`/`frontend`/`e2e`):

```yaml
  restore-drill:
    name: DB Restore Drill
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: cartly
          POSTGRES_PASSWORD: cartlypass
          POSTGRES_DB: cartly_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U cartly"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      NODE_ENV: test
      DATABASE_URL: postgresql://cartly:cartlypass@localhost:5432/cartly_test?schema=public
      SOURCE_DB_URL: postgresql://cartly:cartlypass@localhost:5432/cartly_test?schema=public
      TARGET_DB_URL: postgresql://cartly:cartlypass@localhost:5432/cartly_restore?schema=public
      ADMIN_DB_URL: postgresql://cartly:cartlypass@localhost:5432/cartly_test
      JWT_SECRET: ci-drill-secret
      JWT_REFRESH_SECRET: ci-drill-refresh
      SESSION_SECRET: ci-drill-session
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: backend/package-lock.json
      - name: Install PostgreSQL 16 client
        run: sudo apt-get update && sudo apt-get install -y postgresql-client-16
      - run: npm ci
      - run: npx prisma generate
      - name: Migrate + seed source DB
        run: npx prisma migrate deploy && npm run seed
      - name: Backup source DB
        run: |
          DUMP=$(bash scripts/db-backup.sh --url "$SOURCE_DB_URL" --out ./backups)
          echo "DUMP_FILE=$DUMP" >> "$GITHUB_ENV"
      - name: Create empty target DB
        run: psql "$ADMIN_DB_URL" -c "CREATE DATABASE cartly_restore;"
      - name: Restore into target DB
        run: bash scripts/db-restore.sh --file "$DUMP_FILE" --url "$TARGET_DB_URL" --yes
      - name: Verify restore
        run: bash scripts/verify-restore.sh --source "$SOURCE_DB_URL" --target "$TARGET_DB_URL"
```

- [ ] **Step 2: Validate the workflow YAML locally**

Run (from repo root):

```bash
python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('ci.yml OK')"
```

Expected: `ci.yml OK` (no traceback). If `actionlint` is available, also run `actionlint .github/workflows/ci.yml` and expect no errors.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(ops): add DB restore-drill job (seed -> backup -> restore -> verify)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> The drill runs on push to `develop`. The controller confirms it goes green during final review; it is intentionally **not** added to branch-protection required checks yet (same caution as the `e2e` job).

---

## Task 3: Weekly encrypted off-Neon backup workflow

**Files:**
- Create: `.github/workflows/db-backup.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/db-backup.yml`:

```yaml
name: Weekly DB Backup

on:
  schedule:
    - cron: '17 3 * * 0'   # Sundays 03:17 UTC
  workflow_dispatch:

jobs:
  backup:
    name: Encrypted logical backup
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install PostgreSQL 16 client + gnupg
        run: sudo apt-get update && sudo apt-get install -y postgresql-client-16 gnupg
      - name: Dump + encrypt
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          BACKUP_PASSPHRASE: ${{ secrets.BACKUP_PASSPHRASE }}
        run: |
          set -euo pipefail
          if [ -z "${DATABASE_URL:-}" ] || [ -z "${BACKUP_PASSPHRASE:-}" ]; then
            echo "Missing DATABASE_URL or BACKUP_PASSPHRASE repository secret" >&2
            exit 1
          fi
          DUMP=$(bash backend/scripts/db-backup.sh --url "$DATABASE_URL" --out ./backups)
          gpg --batch --yes --symmetric --cipher-algo AES256 \
            --passphrase "$BACKUP_PASSPHRASE" \
            --output "$DUMP.gpg" "$DUMP"
          rm -f "$DUMP"
          echo "ARTIFACT=$DUMP.gpg" >> "$GITHUB_ENV"
      - name: Upload encrypted artifact
        uses: actions/upload-artifact@v4
        with:
          name: cartly-db-backup
          path: ${{ env.ARTIFACT }}
          retention-days: 30
```

- [ ] **Step 2: Validate the workflow YAML**

```bash
python -c "import yaml; yaml.safe_load(open('.github/workflows/db-backup.yml')); print('db-backup.yml OK')"
```

Expected: `db-backup.yml OK`.

- [ ] **Step 3: Prove the encrypt/decrypt round-trip works**

This is the logic the workflow relies on. From repo root:

```bash
printf 'cartly-backup-test-payload' > /tmp/3e.dump
gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase 'drill-pass' --output /tmp/3e.dump.gpg /tmp/3e.dump
gpg --batch --yes --decrypt --passphrase 'drill-pass' --output /tmp/3e.out /tmp/3e.dump.gpg
diff /tmp/3e.dump /tmp/3e.out && echo "ROUNDTRIP OK"
rm -f /tmp/3e.dump /tmp/3e.dump.gpg /tmp/3e.out
```

Expected: `ROUNDTRIP OK`. (If `gpg` is not installed locally, note it; the workflow installs it. Do not skip writing the workflow.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/db-backup.yml
git commit -m "ci(ops): weekly encrypted off-Neon DB backup workflow

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> Operator follow-up (documented in the secrets runbook, Task 6): set repository secrets `DATABASE_URL` (Neon prod) and `BACKUP_PASSPHRASE` before the first scheduled run; otherwise the job exits 1 by design.

---

## Task 4: Harden render.yaml with declared secrets

**Files:**
- Modify: `backend/render.yaml`

- [ ] **Step 1: Replace the file with declared secrets**

Overwrite `backend/render.yaml` with:

```yaml
services:
  - type: web
    name: mcartly-backend
    env: node
    region: singapore
    plan: free
    buildCommand: npm install
    startCommand: node server.js
    envVars:
      # --- Non-secret config (committed) ---
      - key: NODE_ENV
        value: production
      - key: FRONTEND_URL
        value: https://mcartly.vercel.app
      - key: PORT
        value: 10000
      # --- Secrets: set values in the Render dashboard; never committed ---
      - key: DATABASE_URL
        sync: false
      - key: REDIS_URL
        sync: false
      - key: JWT_SECRET
        sync: false
      - key: JWT_REFRESH_SECRET
        sync: false
      - key: SESSION_SECRET
        sync: false
      - key: CRYPTO_SECRET
        sync: false
      - key: GOOGLE_CLIENT_ID
        sync: false
      - key: GOOGLE_CLIENT_SECRET
        sync: false
      - key: GOOGLE_CALLBACK_URL
        sync: false
      - key: PAYPAL_CLIENT_ID
        sync: false
      - key: PAYPAL_SECRET
        sync: false
      - key: PAYPAL_API_BASE
        sync: false
      - key: PAYPAL_WEBHOOK_ID
        sync: false
      - key: PAYMONGO_SECRET_KEY
        sync: false
      - key: PAYMONGO_WEBHOOK_SECRET
        sync: false
      - key: SMTP_HOST
        sync: false
      - key: SMTP_PORT
        sync: false
      - key: SMTP_USER
        sync: false
      - key: SMTP_PASS
        sync: false
      - key: FROM_NAME
        sync: false
      - key: FROM_EMAIL
        sync: false
      - key: CLOUDINARY_CLOUD_NAME
        sync: false
      - key: CLOUDINARY_API_KEY
        sync: false
      - key: CLOUDINARY_API_SECRET
        sync: false
      - key: SENTRY_DSN
        sync: false
```

- [ ] **Step 2: Validate the YAML**

```bash
python -c "import yaml; yaml.safe_load(open('backend/render.yaml')); print('render.yaml OK')"
```

Expected: `render.yaml OK`.

- [ ] **Step 3: Commit**

```bash
git add backend/render.yaml
git commit -m "chore(ops): declare required secrets as sync:false in render.yaml

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: gitleaks config + pre-commit hook

**Files:**
- Create: `.gitleaks.toml`
- Create: `scripts/hooks/pre-commit`

- [ ] **Step 1: Write the gitleaks config**

Create `.gitleaks.toml`:

```toml
title = "CartLy gitleaks config"

[extend]
useDefault = true

[allowlist]
description = "Ignore documented env templates and their placeholder values"
paths = [
  '''backend/\.env\.example''',
  '''frontend/\.env\.example''',
  '''docs/runbooks/secrets-and-config\.md''',
]
regexes = [
  '''your_[a-z_]+''',
  '''change_in_production''',
  '''sk_test_your_paymongo_secret_key''',
  '''ci-[a-z]+-(secret|refresh|session)''',
]
```

- [ ] **Step 2: Write the pre-commit hook**

Create `scripts/hooks/pre-commit`:

```bash
#!/usr/bin/env bash
# Pre-commit hook: scan staged changes for secrets with gitleaks.
# Install once: cp scripts/hooks/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
set -euo pipefail

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks not installed — skipping secret scan." >&2
  echo "Install from https://github.com/gitleaks/gitleaks to enable it." >&2
  exit 0
fi

gitleaks protect --staged --redact --config .gitleaks.toml
```

- [ ] **Step 3: Verify syntax and (if available) behaviour**

```bash
bash -n scripts/hooks/pre-commit && echo "hook syntax OK"
python -c "import tomllib; tomllib.load(open('.gitleaks.toml','rb')); print('gitleaks toml OK')"
```

Expected: `hook syntax OK` then `gitleaks toml OK`. (Python ≥3.11 has `tomllib`; if unavailable, instead confirm the file parses with `gitleaks` in the next check.)

If `gitleaks` is installed, prove detection + allowlist:

```bash
# planted secret IS detected:
printf 'aws_secret = "AKIAIOSFODNN7EXAMPLEKEYISFAKE123456789"\n' > /tmp/leak.txt
gitleaks detect --no-git --source /tmp/leak.txt --config .gitleaks.toml; echo "exit=$?"   # expect non-zero exit (leak found)
# the .env.example placeholders are allowlisted:
gitleaks detect --no-git --source backend/.env.example --config .gitleaks.toml; echo "exit=$?"  # expect exit 0
rm -f /tmp/leak.txt
```

(If `gitleaks` is not installed, note it and rely on the syntax/toml checks above plus GitGuardian's PR scan.)

- [ ] **Step 4: Commit**

```bash
git add .gitleaks.toml scripts/hooks/pre-commit
git commit -m "chore(security): gitleaks config + pre-commit secret-scan hook

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Disaster-recovery runbook

**Files:**
- Create: `docs/runbooks/disaster-recovery.md`

- [ ] **Step 1: Write the runbook**

Create `docs/runbooks/disaster-recovery.md`:

````markdown
# Disaster Recovery Runbook — CartLy

How to recover CartLy's data after loss or corruption. The **system of record is
PostgreSQL (Neon)**; Redis (Upstash) is ephemeral and is intentionally not backed
up (see below).

## Recovery objectives

| Metric | Target | Backed by |
|---|---|---|
| RPO (max data loss) | ≤ minutes | Neon continuous backups / PITR |
| RPO (off-Neon copy) | ≤ 7 days | Weekly encrypted GitHub Actions dump |
| RTO (time to restore) | ≤ 1 hour | Neon PITR (minutes) or dump restore (≤ 1h) |

## Backup layers

1. **Neon PITR (primary).** Neon continuously retains WAL, enabling
   restore-to-timestamp and branch-from-history within the project's retention
   window. This is the first line of recovery for almost every incident.
2. **Weekly encrypted logical dump (secondary, off-Neon).** The
   `.github/workflows/db-backup.yml` workflow runs `pg_dump -Fc`, encrypts the
   output with `gpg` AES256 (passphrase = the `BACKUP_PASSPHRASE` repo secret),
   and uploads it as the `cartly-db-backup` artifact (30-day retention). Because
   the repo is **public**, only the encrypted ciphertext ever leaves Neon.
   Used when Neon itself is unavailable (account/region loss).

## Redis / Upstash — not backed up

Redis holds refresh tokens, the logout blacklist, sessions, and cache. All are
ephemeral. Losing Redis logs users out and clears caches but does not lose
business data — consistent with the app's graceful-degradation design. No restore
step is required; on a fresh Redis, the app reconnects and repopulates.

## Failure scenarios → procedure

| Scenario | Procedure |
|---|---|
| Accidental row/table deletion or bad migration | A — Neon PITR to a timestamp just before the event |
| Logical corruption discovered later | A — Neon PITR, or B — restore the weekly dump to a branch and compare |
| Neon project/region outage | A — Neon point-in-time / branch once service returns |
| Total Neon loss (account gone) | C — restore the encrypted weekly dump into a fresh database |

## Procedure A — Neon PITR / branch restore (primary)

1. In the Neon console, open the project → **Branches** / **Restore**.
2. Choose **restore to a timestamp** just before the incident, or create a new
   branch from that point in history.
3. Validate on the restored branch (row counts, spot-check recent orders).
4. Repoint the app: update `DATABASE_URL` in the Render dashboard to the restored
   branch's connection string.
5. Run the post-restore checklist below.

## Procedure B — Inspect a dump without touching prod

1. Download the latest `cartly-db-backup` artifact from the GitHub Actions run.
2. Decrypt: `gpg --batch --decrypt --passphrase "<BACKUP_PASSPHRASE>" --output restore.dump cartly-backup-*.dump.gpg`
3. Restore into a scratch DB (local or a Neon branch) and compare:
   ```bash
   bash backend/scripts/db-restore.sh --file restore.dump --url "<scratch-db-url>" --yes
   ```

## Procedure C — Restore the encrypted dump into a fresh database (secondary)

Use when Neon PITR is unavailable.

1. Provision a new PostgreSQL database (new Neon project, or any Postgres).
2. Download + decrypt the latest artifact (see Procedure B step 1–2).
3. Restore (the target host is real prod, so pass `--allow-prod`):
   ```bash
   bash backend/scripts/db-restore.sh --file restore.dump --url "<new-db-url>" --yes --allow-prod
   ```
4. Repoint `DATABASE_URL` in Render to the new database.
5. Run the post-restore checklist.

> The restore scripts strip the Prisma-only `?schema=public` param automatically
> (libpq rejects it) while keeping `sslmode=require` for Neon.

## Post-restore checklist

- [ ] `DATABASE_URL` (Render) points at the restored database.
- [ ] `cd backend && npx prisma migrate deploy` (schema is at the latest migration).
- [ ] `GET https://<backend>/health/ready` returns **200** (Postgres reachable).
- [ ] Row counts look sane vs. expectation (use `backend/scripts/verify-restore.sh`
      against the previous source if you still have it, or spot-check key tables).
- [ ] Smoke test: log in, open the catalog, place a test order.
- [ ] Note the incident + recovery in your ops log.

## Verifying backups actually work

- **Automated:** the `restore-drill` CI job (`.github/workflows/ci.yml`) runs on
  every push to `develop` — it seeds a DB, backs it up, restores into a scratch
  DB, and asserts key-table row counts match. A green drill proves the
  scripts work.
- **Manual rehearsal (quarterly):** run Procedure B against a Neon branch and
  confirm the post-restore checklist passes. Record the date.
````

- [ ] **Step 2: Verify no placeholders remain**

```bash
grep -nE "TBD|TODO|FIXME|<fill" docs/runbooks/disaster-recovery.md || echo "no placeholders"
```

Expected: `no placeholders`. (The angle-bracket tokens like `<scratch-db-url>` and `<BACKUP_PASSPHRASE>` are intentional operator-supplied values, not plan placeholders — they are fine.)

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/disaster-recovery.md
git commit -m "docs(ops): disaster-recovery runbook

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Secrets & config runbook

**Files:**
- Create: `docs/runbooks/secrets-and-config.md`

- [ ] **Step 1: Write the runbook**

Create `docs/runbooks/secrets-and-config.md`:

````markdown
# Secrets & Configuration Runbook — CartLy

The single source of truth for every environment variable: what it is, whether
it's required, where its value lives, and how to rotate it. **No secret values
are ever committed.** `backend/.env.example` and `frontend/.env.example` document
the variable names with placeholder values only.

## Where secrets live

| Environment | Store |
|---|---|
| Backend (prod) | Render dashboard → service → Environment (declared as `sync: false` in `backend/render.yaml`) |
| Frontend (prod) | Vercel project → Settings → Environment Variables |
| Database | Neon connection string (the value of `DATABASE_URL`) |
| Redis | Upstash connection string (the value of `REDIS_URL`) |
| CI / backups | GitHub repo → Settings → Secrets and variables → Actions |
| Local dev | `backend/.env` (gitignored) — copy from `backend/.env.example` |

## Backend environment inventory

| Variable | Required | Purpose | Notes / degradation |
|---|---|---|---|
| `NODE_ENV` | yes | Runtime mode | `production` in prod (committed in render.yaml) |
| `PORT` | yes | Listen port | Render uses `10000` (committed) |
| `FRONTEND_URL` | yes | CORS + OAuth redirects | committed in render.yaml |
| `DATABASE_URL` | yes | PostgreSQL (Neon) connection | **App aborts on connect failure** (system of record) |
| `REDIS_URL` | no | Redis (Upstash) connection | Non-fatal; sessions/blacklist/cache degrade gracefully |
| `JWT_SECRET` | yes | Signs access tokens (canonical name) | Rotating invalidates all access tokens |
| `JWT_ACCESS_EXPIRE` | no | Access token TTL | Defaults to 15m |
| `JWT_REFRESH_SECRET` | yes | Signs refresh tokens | Rotating logs everyone out |
| `JWT_REFRESH_EXPIRE` | no | Refresh token TTL | Defaults to 7d |
| `JWT_COOKIE_EXPIRE` | no | Cookie TTL (days) | Defaults to 7 |
| `SESSION_SECRET` | yes | express-session signing | Rotating invalidates sessions |
| `CRYPTO_SECRET` | yes | App-level crypto helpers | Keep stable; rotate only with a re-encryption plan |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no | Google OAuth login | OAuth disabled if unset |
| `GOOGLE_CALLBACK_URL` | no | OAuth callback | Must match Google console + deployed host |
| `PAYPAL_CLIENT_ID` / `PAYPAL_SECRET` | no | PayPal Orders v2 | PayPal returns graceful 400 if unset |
| `PAYPAL_API_BASE` | no | Sandbox vs live base URL | `https://api-m.paypal.com` in live |
| `PAYPAL_WEBHOOK_ID` | no | PayPal webhook verification | Required for webhook signature checks |
| `PAYMONGO_SECRET_KEY` | no | GCash via PayMongo | GCash returns graceful 400 if unset |
| `PAYMONGO_WEBHOOK_SECRET` | no | PayMongo webhook HMAC | Required for webhook verification |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | no | Email (Nodemailer) | Email features degrade if unset |
| `FROM_NAME` / `FROM_EMAIL` | no | Email sender identity | — |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | no | Image uploads | Non-fatal; uploads degrade if unset |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_MAX` | no | Rate limiting | Sensible defaults in code |
| `SENTRY_DSN` | no | Backend error tracking | No DSN → Sentry is a complete no-op |

## Frontend environment inventory (Vercel)

| Variable | Required | Purpose |
|---|---|---|
| `VITE_API_URL` | yes | Backend API base (`/api`) the SPA calls |
| `VITE_BACKEND_URL` | no | Backend origin for non-API links if used |
| `VITE_SENTRY_DSN` | no | Frontend error tracking; no DSN → no-op |

## GitHub Actions secrets (CI + backups)

| Secret | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | `db-backup.yml` | Neon prod connection for the weekly dump |
| `BACKUP_PASSPHRASE` | `db-backup.yml` | gpg AES256 passphrase encrypting the dump artifact |

> Branch CI jobs (`backend`, `e2e`, `restore-drill`) supply throwaway test
> secrets inline in `ci.yml`; they do not use repository secrets.

## Rotation procedures

General rule: set the new value in the relevant store, redeploy/restart, then
invalidate the old credential at its source.

- **`JWT_SECRET` / `JWT_REFRESH_SECRET`:** generate `openssl rand -base64 32`,
  update in Render, redeploy. Effect: all existing access/refresh tokens become
  invalid — **every user is logged out** and must re-authenticate.
- **`SESSION_SECRET`:** rotate like above; active express-sessions are
  invalidated.
- **`CRYPTO_SECRET`:** only rotate with a migration plan if any data was
  encrypted with it; otherwise rotating may make previously encrypted values
  unreadable. Keep stable unless compromised.
- **`DATABASE_URL`:** rotate the Neon role password in the Neon console, copy the
  new connection string into Render (and the GitHub `DATABASE_URL` secret),
  redeploy. Keep the old role until the new one is confirmed working.
- **`REDIS_URL`:** rotate the Upstash credentials, update Render, redeploy. Users
  are logged out (token store reset) but no data is lost.
- **Google OAuth (`GOOGLE_*`):** rotate the client secret in Google Cloud
  Console, update Render, redeploy.
- **PayPal (`PAYPAL_*`) / PayMongo (`PAYMONGO_*`):** rotate keys in the provider
  dashboard, update Render, redeploy; re-verify webhook IDs/secrets.
- **`BACKUP_PASSPHRASE`:** set a new passphrase as the GitHub secret for future
  backups. **Old encrypted artifacts can only be decrypted with the passphrase
  used when they were created** — record passphrases securely and keep the prior
  one as long as you retain artifacts encrypted with it.

## New-environment bootstrap checklist

Set every required secret before the first deploy. In order:

1. **Database:** create a Neon project → set `DATABASE_URL` (Render) → from
   `backend/`, `npx prisma migrate deploy`.
2. **Redis:** create an Upstash database → set `REDIS_URL` (Render).
3. **App secrets:** generate and set `JWT_SECRET`, `JWT_REFRESH_SECRET`,
   `SESSION_SECRET`, `CRYPTO_SECRET` (`openssl rand -base64 32` each).
4. **Core config:** set `NODE_ENV`, `PORT`, `FRONTEND_URL` (already committed in
   `render.yaml`; override if needed).
5. **Optional integrations** as needed: Google OAuth, PayPal, PayMongo, SMTP,
   Cloudinary, `SENTRY_DSN`.
6. **Frontend (Vercel):** set `VITE_API_URL` (and optionally `VITE_SENTRY_DSN`).
7. **Backups:** set GitHub Actions secrets `DATABASE_URL` and `BACKUP_PASSPHRASE`.
8. **Seeding:** **do not** run `npm run seed` against production — it wipes data
   and recreates the documented default accounts (the repo is public; those
   passwords are documented). Seed only local/test databases.

## Keeping secrets out of the repo

- `backend/.env`, `backend/.env.test`, and `frontend/.env` are gitignored.
  `.claudeignore` is intentionally untracked.
- **GitGuardian** scans every PR.
- **gitleaks pre-commit hook** (local second layer): install once with
  `cp scripts/hooks/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit`.
  Config is `.gitleaks.toml`. The hook no-ops if gitleaks isn't installed.
- If a secret is ever committed: rotate it immediately (see above) — assume it is
  compromised even after removal, because the repo is public.
````

- [ ] **Step 2: Verify no placeholders remain**

```bash
grep -nE "TBD|TODO|FIXME|<fill" docs/runbooks/secrets-and-config.md || echo "no placeholders"
```

Expected: `no placeholders`.

- [ ] **Step 3: Confirm gitleaks does not flag this runbook**

The runbook is allowlisted in `.gitleaks.toml` (Task 5). If gitleaks is installed:

```bash
gitleaks detect --no-git --source docs/runbooks/secrets-and-config.md --config .gitleaks.toml; echo "exit=$?"
```

Expected: `exit=0`. (Skip if gitleaks not installed.)

- [ ] **Step 4: Commit**

```bash
git add docs/runbooks/secrets-and-config.md
git commit -m "docs(ops): secrets & config runbook (inventory + rotation)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Update ROADMAP, CLAUDE.md, and project memory

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Mark 3E done in ROADMAP**

In `docs/ROADMAP.md`, change the 3E sub-plan line from:

```markdown
- [ ] **3E — Backups, DR & secrets:** provision managed Postgres/Redis, automated backups + PITR, tested restore runbook, secrets externalized.
```

to:

```markdown
- [x] **3E — Backups, DR & secrets:** Neon PITR as primary DR; repo `pg_dump`/`pg_restore`/verify scripts (`backend/scripts/`) exercised by a CI `restore-drill` job (seed → backup → restore → verify counts); a weekly **encrypted** off-Neon dump workflow (`.github/workflows/db-backup.yml`, gpg AES256, 30-day artifact — required because the repo is public); `render.yaml` secrets declared `sync: false`; gitleaks pre-commit hook; and two runbooks (`docs/runbooks/disaster-recovery.md`, `secrets-and-config.md`). Spec: [phase3e](superpowers/specs/2026-06-04-phase3e-backups-dr-secrets-design.md)
```

Also update the Phase 3 status line near the top of the Phase 3 section from `(3A–3D complete)` to `(3A–3E complete)`.

Then tick these two workstream rows (change `- [ ]` to `- [x]`) and annotate:

```markdown
- [x] Database backups + documented disaster-recovery procedure *(3E — Neon PITR + weekly encrypted dump; `docs/runbooks/disaster-recovery.md`; CI restore-drill)*
- [x] Secrets management (no secrets in repo; documented env/secret strategy) *(3E — `render.yaml` sync:false; gitleaks hook; `docs/runbooks/secrets-and-config.md`)*
```

- [ ] **Step 2: Add a CLAUDE.md note**

In `CLAUDE.md`, add this subsection immediately after the **Observability** (Phase 3D) paragraph in the backend architecture section:

```markdown
**Backups, DR & secrets** (Phase 3E) — The system of record (PostgreSQL/Neon) is recoverable two ways: **Neon PITR** (primary) and a **weekly encrypted off-Neon dump** (`.github/workflows/db-backup.yml` — `pg_dump -Fc` → `gpg` AES256 → 30-day GitHub artifact; encryption is mandatory because the repo is public). Backup/restore tooling lives in `backend/scripts/` (`db-backup.sh`, `db-restore.sh` with `--yes`/`--allow-prod` guards, `verify-restore.sh`) — all strip the Prisma-only `?schema=public` param that libpq rejects, exposed as `npm run db:backup`/`db:restore`. A CI `restore-drill` job proves backup→restore→verify on every push (not yet a required check). Redis/Upstash is **not** backed up (ephemeral sessions/blacklist/cache — graceful degradation). Secrets: `render.yaml` declares them `sync: false` (values only in dashboards), a gitleaks pre-commit hook (`scripts/hooks/pre-commit`) backs up GitGuardian's PR scan, and the runbooks `docs/runbooks/disaster-recovery.md` + `secrets-and-config.md` document restore procedures, the full env inventory, and rotation.
```

- [ ] **Step 3: Commit**

```bash
git add docs/ROADMAP.md CLAUDE.md
git commit -m "docs: mark Phase 3E complete (backups/DR/secrets)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 4: Update project memory (controller, not a subagent)**

After all tasks pass, the controller updates the memory file
`C:\Users\Sam\.claude\projects\E--GitHub-myCartlyV1\memory\phase3-progress-and-security-followup.md`:
add a `**3E complete**` bullet summarizing the deliverables, and update the
`description` + remaining-work line to reflect that only 3F remains. Update the
matching line in `MEMORY.md`.

---

## Self-Review

**Spec coverage:**
- Backup/restore/verify scripts + npm scripts → Task 1 ✅
- CI restore drill (seed → backup → restore → verify) → Task 2 ✅
- Weekly encrypted off-Neon backup → Task 3 ✅
- render.yaml `sync: false` hardening → Task 4 ✅
- gitleaks config + pre-commit hook → Task 5 ✅
- DR runbook (RPO/RTO, scenarios, procedures, post-restore checklist, Redis-not-backed-up) → Task 6 ✅
- Secrets runbook (env inventory, rotation, bootstrap, controls) → Task 7 ✅
- ROADMAP + CLAUDE.md + memory → Task 8 ✅
- Non-goals (object storage, auto-rotation, multi-region, Redis backup, dashboard execution) → not built ✅

**Placeholder scan:** No `TBD`/`TODO`/"implement later". Angle-bracket tokens in runbooks (`<new-db-url>`, `<BACKUP_PASSPHRASE>`) are intentional operator inputs and are explicitly excluded in the grep checks.

**Consistency:** Script names (`db-backup.sh`/`db-restore.sh`/`verify-restore.sh`/`lib-pgurl.sh`), the `strip_schema_param` helper, npm script names (`db:backup`/`db:restore`), env names (`DATABASE_URL`, `BACKUP_PASSPHRASE`, `PROD_DB_HOST_PATTERN`), artifact name (`cartly-db-backup`), and the `restore-drill` job name are used identically across tasks, the CI job, the workflow, and both runbooks. `JWT_SECRET` (not `JWT_ACCESS_SECRET`) is used in the CI job env, matching the canonical name `utils/jwt.js` reads.
