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
