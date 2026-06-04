# Phase 3E — Backups, DR & Secrets — Design

> Part of [Phase 3 — Operational hardening](../../ROADMAP.md#phase-3--operational-hardening--in-progress-real-money-bar). Sub-plan 3E.

**Status:** Approved (design) — 2026-06-04
**Depends on:** 3A (CI), 3D (health probes used in restore verification)
**Launch context:** real paying users (strictest reliability + security bar)

## Goal

Make CartLy's production data recoverable and its secrets externalized, with the
recovery path **proven by automation**, not just documented. Deliver
committable, testable repo artifacts (backup/restore scripts, a CI restore
drill, an encrypted off-Neon weekly backup, secret-handling controls) plus two
operator runbooks. Provider-dashboard steps (Neon PITR retention, Upstash
provisioning, setting GitHub/Render secrets) are **documented as operator
checklists** — this phase does not execute them.

## Context

- **Backend:** Render (free plan, Singapore region), `backend/render.yaml`.
- **Frontend:** Vercel (`mcartly.vercel.app`).
- **Database:** Neon managed PostgreSQL (migrated ~2026-06-04). Neon provides
  continuous backups + point-in-time recovery (PITR) natively — this is the
  **primary** DR mechanism.
- **Redis:** Upstash (sessions, refresh-token store, logout blacklist, cache).
  Non-fatal / graceful degradation — **not** backed up (see Non-Goals).
- **Secrets today:** `backend/.env` gitignored; `render.yaml` holds no secrets
  inline (only `NODE_ENV`, `FRONTEND_URL`, `PORT`); `backend/.env.example` is the
  documented template; GitGuardian scans PRs.
- **The repo is PUBLIC.** This is the single most important constraint for
  backups: GitHub Actions artifacts on a public repo are publicly downloadable,
  so any backup uploaded there **must be encrypted** (see §4).

## Architecture overview

Three repo-deliverable workstreams plus two runbooks:

| Area | Deliverable |
|---|---|
| Backup/restore scripts | `backend/scripts/db-backup.sh`, `db-restore.sh`, `verify-restore.sh`; `backend/package.json` npm scripts |
| Automated verification | `restore-drill` job in `.github/workflows/ci.yml` |
| Off-Neon backup | `.github/workflows/db-backup.yml` (weekly, encrypted artifact) |
| Secrets controls | `backend/render.yaml` (`sync: false` declarations), `.gitleaks.toml`, `scripts/hooks/pre-commit` |
| Runbooks | `docs/runbooks/disaster-recovery.md`, `docs/runbooks/secrets-and-config.md` |
| Docs | `docs/ROADMAP.md`, `CLAUDE.md` updates |

## Components

### 1. Backup / restore / verify scripts (`backend/scripts/`)

POSIX `.sh` scripts (CI is Ubuntu; on Windows dev run via Git Bash / WSL). They
depend on `pg_dump`, `pg_restore`, `psql` (PostgreSQL client tools).

**`db-backup.sh`**
- Reads the source connection string from `--url <url>` or `$DATABASE_URL`.
- Runs `pg_dump -Fc` (custom format → enables `pg_restore`, selective +
  parallel restore).
- Writes a timestamped file `cartly-backup-<UTC-timestamp>.dump` to an output
  dir (`--out <dir>`, default `./backups`).
- Prints the absolute output path on success; non-zero exit on failure.

**`db-restore.sh`**
- Args: `--file <dump>` and target via `--url <url>` or `$DATABASE_URL`.
- Runs `pg_restore --clean --if-exists --no-owner --no-privileges` into the
  target.
- **Safety guard:** refuses to run unless `--yes` is passed. Additionally
  refuses if the target host matches a configured production host pattern
  (`PROD_DB_HOST_PATTERN`, default substring `neon.tech`) **unless**
  `--allow-prod` is *also* passed. Prevents accidental prod overwrite while
  still allowing a deliberate DR restore.

**`verify-restore.sh`**
- Args: source URL + target URL (`--source`, `--target`).
- Uses `psql -tAc` to count rows in key tables: `"User"`, `"Product"`,
  `"Category"`, `"Order"` (Prisma table names are quoted PascalCase).
- Exits non-zero if any table count differs between source and target, or if any
  count is zero (catches empty/failed restores).

**`backend/package.json`** — add:
- `"db:backup": "bash scripts/db-backup.sh"`
- `"db:restore": "bash scripts/db-restore.sh"`

### 2. Automated restore drill (`.github/workflows/ci.yml`)

New job `restore-drill` (independent; same triggers as existing jobs — push to
`develop`, PRs into `main`):

1. Postgres 16 service container (mirror the existing backend job's service +
   health-check options).
2. `npm ci` (backend) + `npx prisma generate`.
3. Create source DB; `npx prisma migrate deploy` against it.
4. `npm run seed` to populate deterministic data.
5. `npm run db:backup -- --url <source> --out ./backups`.
6. `psql` `CREATE DATABASE` for the restore target.
7. `npm run db:restore -- --file <dump> --url <target> --yes` (no `--allow-prod`;
   target is a local service DB so the guard passes).
8. `bash scripts/verify-restore.sh --source <source> --target <target>`.

Env mirrors the backend job (notably `JWT_SECRET`, not `JWT_ACCESS_SECRET` — the
canonical name `utils/jwt.js` reads). **Not** added to branch-protection required
checks initially (same caution applied to the `e2e` job until proven stable).

### 3. Weekly off-Neon encrypted backup (`.github/workflows/db-backup.yml`)

- Triggers: `schedule` (weekly cron) + `workflow_dispatch` (manual).
- Steps: install `postgresql-client` + `gnupg`; `pg_dump -Fc` of
  `secrets.DATABASE_URL` (Neon prod, stored as a GitHub Actions secret) piped to
  `gpg --batch --symmetric --cipher-algo AES256 --passphrase
  "$BACKUP_PASSPHRASE"` (`secrets.BACKUP_PASSPHRASE`); upload the resulting
  `*.dump.gpg` via `actions/upload-artifact` with `retention-days: 30`.
- **Encryption is mandatory** because the repo is public (artifacts are publicly
  downloadable). Only the encrypted ciphertext leaves Neon.
- Restore path (decrypt with the passphrase → `db-restore.sh`) is documented in
  the DR runbook.
- This is the **secondary** copy; Neon PITR remains primary DR.

### 4. Disaster-recovery runbook (`docs/runbooks/disaster-recovery.md`)

- **RPO/RTO targets** (stated explicitly; e.g. RPO ≈ Neon PITR granularity,
  weekly for the off-Neon copy; RTO target for a full restore).
- **Failure scenarios:** accidental data deletion/corruption, Neon outage,
  region loss, total Neon-account loss.
- **Restore procedures, in priority order:**
  1. Neon PITR restore-to-timestamp (primary).
  2. Neon branch restore from a retained branch/snapshot.
  3. Decrypt the weekly encrypted dump and `db-restore.sh` into a fresh
     Neon database/branch (secondary, for total-Neon-loss).
- **Post-restore checklist:** repoint `DATABASE_URL`, run `prisma migrate
  deploy`, hit `GET /health/ready` (must be 200), run `verify-restore.sh` /
  spot-check counts, smoke-test login + an order.
- **Redis/Upstash:** explicitly *not* backed up — sessions/refresh-tokens/
  blacklist/cache are ephemeral; loss logs users out but is non-fatal (consistent
  with graceful degradation). No restore step needed.
- **Restore-drill cadence:** the CI drill runs continuously; document a periodic
  manual full-restore rehearsal against a Neon branch.

### 5. Secrets runbook (`docs/runbooks/secrets-and-config.md`)

- **Env inventory table:** every variable (from `backend/.env.example` plus
  `SENTRY_DSN`, the frontend `VITE_*` vars, and `BACKUP_PASSPHRASE`) with:
  purpose, required vs optional, where stored (Render dashboard / Vercel env /
  Neon connection string / Upstash / GitHub Actions secrets), and
  graceful-degradation note where applicable.
- **Rotation procedures** per secret class, with blast-radius:
  - `JWT_SECRET` / `JWT_REFRESH_SECRET` → invalidates issued tokens (mass logout).
  - `SESSION_SECRET`, `CRYPTO_SECRET` → note any data-at-rest decryption impact.
  - `DATABASE_URL`, `REDIS_URL` → connection rotation, restart.
  - Google OAuth, PayPal, PayMongo keys → provider-side rotation + env update.
  - `BACKUP_PASSPHRASE` → old encrypted artifacts still need the old passphrase;
    document keeping a record.
- **New-environment bootstrap checklist** (ordered list of every secret to set
  before first deploy).
- **"No secrets in repo" controls:** `.gitignore` coverage, GitGuardian PR scan,
  gitleaks pre-commit hook (below).

### 6. render.yaml hardening + pre-commit secret scan

- **`backend/render.yaml`:** add all required secret env vars as `sync: false`
  entries (names only, values never committed) so a missing secret fails loudly
  at deploy and the manifest documents exactly what must be set: `DATABASE_URL`,
  `REDIS_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SESSION_SECRET`,
  `CRYPTO_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `GOOGLE_CALLBACK_URL`, `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_API_BASE`,
  `PAYPAL_WEBHOOK_ID`, `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`,
  `SMTP_*`, `CLOUDINARY_*`, `SENTRY_DSN`. Keep existing non-secret plain entries
  (`NODE_ENV`, `FRONTEND_URL`, `PORT`).
- **`.gitleaks.toml`:** minimal config (extends gitleaks defaults; allowlist the
  `.env.example` placeholders so they don't trip the scan).
- **`scripts/hooks/pre-commit`:** runs `gitleaks protect --staged --redact`;
  blocks the commit on a finding. Documented one-line install in the secrets
  runbook (hook installation cannot be force-enabled from the repo). Second layer
  before GitGuardian's PR scan.

### 7. Docs updates

- `docs/ROADMAP.md`: mark 3E `[x]` with detail + spec link; tick the Backups and
  Secrets workstream rows.
- `CLAUDE.md`: add a short "Backups, DR & secrets (Phase 3E)" subsection under
  the backend architecture notes (scripts, the two workflows, runbook locations,
  public-repo encryption rationale, Redis-not-backed-up).

## Testing strategy

- **Primary:** the `restore-drill` CI job proves backup → restore → verify on
  every push/PR.
- Scripts are runnable locally against the docker-compose Postgres for manual
  verification.
- No new Jest/Vitest tests — this phase is scripts + ops, not application code.
  `npm run lint` / `npm run build` are unaffected.

## Non-Goals (YAGNI)

- External object-storage backups (S3 / R2 / B2).
- Automated/secret-manager-driven secret rotation (Vault, Doppler, etc.).
- Multi-region failover / hot standby.
- Backing up Redis/Upstash (ephemeral by design).
- Executing provider-dashboard configuration (operator action; documented only).

## Definition of done

- `db-backup.sh` / `db-restore.sh` / `verify-restore.sh` exist and are wired to
  `npm run db:backup` / `db:restore`.
- The `restore-drill` CI job is green (seed → backup → restore → verify counts).
- `db-backup.yml` produces an **encrypted** weekly artifact (verified via a
  manual `workflow_dispatch` run, or at minimum lints/parses correctly).
- `render.yaml` declares all required secrets as `sync: false`.
- `.gitleaks.toml` + `scripts/hooks/pre-commit` present; install documented.
- `docs/runbooks/disaster-recovery.md` and `secrets-and-config.md` complete (no
  placeholders) — a new operator could restore the DB and stand up a fresh
  environment from them alone.
- ROADMAP + CLAUDE.md updated.
