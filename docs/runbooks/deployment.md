# Deployment Runbook — CartLy

How to deploy CartLy from a cold start, deploy routine changes, and roll back.
The system of record is **PostgreSQL (Neon)**; see
[`disaster-recovery.md`](disaster-recovery.md) for data recovery and
[`secrets-and-config.md`](secrets-and-config.md) for the full env/secret
inventory.

## Stack & responsibilities

| Component | Platform | Responsibility |
|---|---|---|
| Backend API | Render (free, Singapore) | Express API + daily audit-cleanup job + keep-alive ping |
| Frontend SPA | Vercel (`mcartly.vercel.app`) | Static React build, calls the API at `VITE_API_URL` |
| Database | Neon (managed Postgres) | System of record; continuous backups + PITR |
| Redis | Upstash | Sessions / refresh tokens / logout blacklist / cache (ephemeral, graceful) |

CI (`.github/workflows/ci.yml`) gates merges into `main`; Render and Vercel
deploy from `main`.

## Cold-start first deploy (in order)

Do these once when standing up a fresh environment. Provider-dashboard steps are
manual; everything else is a command.

1. **Database — Neon.** Create a Neon project; copy the connection string into
   `DATABASE_URL` (Render). It carries `?sslmode=require`.
2. **Redis — Upstash.** Create an Upstash database; copy its connection string
   into `REDIS_URL` (Render).
3. **Backend secrets — Render.** Set every required secret on the Render service
   (the service follows `backend/render.yaml`, which declares secrets as
   `sync: false`). Follow the ordered list in
   [`secrets-and-config.md` → New-environment bootstrap](secrets-and-config.md#new-environment-bootstrap-checklist):
   generate `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SESSION_SECRET`, `CRYPTO_SECRET`
   (`openssl rand -base64 32` each) plus `NODE_ENV=production`, `PORT`,
   `FRONTEND_URL`, and any optional integrations (Google OAuth, PayPal, PayMongo,
   SMTP, Cloudinary, `SENTRY_DSN`).
   > The backend **refuses to start in production** if `JWT_SECRET`,
   > `JWT_REFRESH_SECRET`, or `SESSION_SECRET` is unset (`utils/validateEnv.js`).
4. **Apply the schema.** From `backend/`:
   ```bash
   npx prisma migrate deploy
   ```
5. **Deploy the backend** (Render auto-deploys from `main`, or trigger a manual
   deploy). Verify it is healthy:
   ```bash
   curl -fsS https://<backend-host>/health/live    # 200, process is up
   curl -fsS https://<backend-host>/health/ready   # 200 once Postgres is reachable
   ```
   `/health/ready` returns 503 if Postgres is down; Redis down reports
   `degraded` but still 200 (graceful degradation).
6. **Frontend env — Vercel.** Set `VITE_API_URL=https://<backend-host>/api`
   (and optionally `VITE_SENTRY_DSN`).
7. **Deploy the frontend** (Vercel auto-deploys from `main`).
8. **Smoke test** the live site: register + log in, browse the catalog, place a
   COD order, and (as admin) confirm the order appears. If all pass, the
   environment is live.

## Routine deploys

1. Work on `develop`; push. CI runs `backend`, `frontend`, `e2e`, and
   `restore-drill` jobs.
2. Open a PR `develop → main`. Branch protection requires the
   `Backend (Prisma + Jest)` and `Frontend (Lint + Build)` checks (strict /
   up-to-date) to be green.
3. Merge. Render and Vercel auto-deploy from `main`.
4. **Migrations:** if the change includes a Prisma migration, ensure
   `npx prisma migrate deploy` runs against prod (Render build/release step or a
   one-off `render … exec`) **before** the new code serves traffic.
5. Re-check `/health/ready` after the backend redeploys.

## Rollback

| What broke | Action |
|---|---|
| Bad backend deploy (code only) | Render dashboard → service → **Rollback** to the previous deploy |
| Bad frontend deploy | Vercel dashboard → Deployments → **Promote** the previous deployment |
| Data damaged by a deploy/migration | Code rollback is **not enough** — restore data per [`disaster-recovery.md`](disaster-recovery.md) (Neon PITR to a timestamp before the deploy) |

> A deploy that shipped a destructive migration needs a **data restore**, not
> just a code rollback. Treat schema-changing deploys with extra care.

## Render free-tier cold start

The free Render service sleeps after inactivity, so the first request after a
sleep is slow. The app mitigates this with a keep-alive ping to `GET /health`
every ~12 minutes in production (`server.js`). For a stricter SLA, upgrade the
Render plan rather than relying on the ping.

## Security posture (reference)

- **CSRF:** the API authorizes requests with a **JWT in the `Authorization`
  header**, which browsers never attach automatically cross-site — so the API is
  structurally not CSRF-susceptible and ships **no CSRF middleware**.
  `express-session` is used **only** for the Google OAuth handshake; its cookie
  is `httpOnly` and `secure` in production (and `SameSite=None` there because the
  OAuth redirect is cross-domain Vercel↔Render).
- **XSS:** defense is layered, not a single middleware — React output-encoding
  (frontend), Joi input validation (backend), and Helmet CSP (`server.js`). There
  is intentionally **no input-sanitization middleware** (encode on output, do not
  mutate input).
- **Production secret guard:** the backend refuses to boot in production if
  `JWT_SECRET` / `JWT_REFRESH_SECRET` / `SESSION_SECRET` are unset
  (`utils/validateEnv.js`).
- **Transport headers:** Helmet sets secure HTTP headers incl. a CSP; HPP guards
  against parameter pollution; CORS allows only the known frontend origins (+ LAN
  in dev).

## Residual `npm audit` follow-ups (low risk, tracked)

Resolved in Phase 3F where non-breaking. The following remain because their only
fix is a **breaking** transitive/major bump — none are shipped runtime code
except where noted, so they are tracked rather than forced:

- **Backend:** `uuid` (moderate) — fix is `uuid@14` (breaking). Re-evaluate when
  touching ID generation.
- **Frontend (dev/build-chain only, not in the shipped bundle):** `vitest` /
  `vite` / `vite-node` / `esbuild` / `@typescript-eslint/*` / `minimatch`. These
  resolve via major upgrades (Vite/Vitest majors); re-evaluate when upgrading the
  build toolchain.

Re-run `npm audit` in each package after any major dependency upgrade and prune
this list.
