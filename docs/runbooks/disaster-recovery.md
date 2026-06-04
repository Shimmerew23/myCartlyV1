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
