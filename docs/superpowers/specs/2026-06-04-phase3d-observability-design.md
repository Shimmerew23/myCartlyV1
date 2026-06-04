# Phase 3D — Observability Design

**Status:** Approved (brainstorm) — ready for implementation plan
**Date:** 2026-06-04
**Phase:** 3D of Phase 3 (Operational Hardening)
**Depends on:** 3A (CI) complete; nothing from 3B/3C blocks this.

## Goal

Add production observability to CartLy with two independent units: (1) **Sentry error tracking** on backend and frontend, env-gated and graceful, and (2) **real liveness/readiness health probes** (`/health/live`, `/health/ready`) that report Postgres and Redis status.

## Guiding decisions (from brainstorming)

- **Sentry is env-gated and graceful.** No DSN configured → complete no-op, exactly like the existing Cloudinary/Redis graceful-degradation pattern. No hard dependency on having a Sentry account before this ships. Dev/CI/tests run untouched.
- **Readiness honors graceful degradation.** Postgres is the system of record: Postgres down → `503` not-ready. Redis is optional: Redis down → still `200` ready, reported as `degraded`.
- **Frontend Sentry is lean.** Errors only — `tracesSampleRate: 0.1`, **no** Session Replay, **no** browser tracing integration. Can be dialed up later.
- **Backend error capture is manual, in the existing `errorHandler`.** Reuses the handler's existing status-code classification; reports `>= 500` only (no 4xx noise). Chosen over Sentry's auto Express integration to fit the codebase's single-error-handler design and avoid `require`-ordering fragility.

## Architecture

Four units, each independently understandable and testable:

1. `backend/config/sentry.js` — backend Sentry init (env-gated)
2. Health probes — `backend/controllers/healthController.js` + `healthRouter` in `routes/index.js`
3. `frontend/src/lib/sentry.ts` — frontend Sentry init (env-gated) + `<Sentry.ErrorBoundary>`
4. Tests — `backend/tests/health.test.js` + a tiny frontend no-op test

---

## Unit 1 — Backend Sentry (`backend/config/sentry.js`)

**Responsibility:** Initialize the `@sentry/node` SDK when a DSN is present; otherwise be a no-op.

- New file `backend/config/sentry.js` exports `initSentry()`.
- Required as the **first line** of `backend/server.js`, before other app requires:
  ```js
  require('dotenv').config();
  require('./config/sentry').initSentry();
  require('express-async-errors');
  // ...rest unchanged
  ```
- `initSentry()` behavior:
  - Reads `process.env.SENTRY_DSN`.
  - **Absent:** `logger.info('Sentry: disabled (no DSN)')` and return. Complete no-op.
  - **Present:** call
    ```js
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0,          // lean: errors only, no tracing
      release: process.env.npm_package_version || '1.0.0',
    });
    ```
    then `logger.info('Sentry: enabled')`.
- **Error capture** — one addition to the existing `errorHandler` in `backend/middleware/index.js`, placed next to the existing `logger.error` call in the `statusCode >= 500` branch:
  ```js
  if (error.statusCode >= 500) {
    logger.error(/* existing */);
    Sentry.captureException(err); // no-op if Sentry.init was never called
  }
  ```
  `@sentry/node`'s `captureException` is safe to call when uninitialized (no-op), so no extra guard flag is required. All existing Prisma/JWT/Multer classification and Winston logging stay exactly as-is; capture is purely additive.
- `backend/.env.example` gains a documented entry:
  ```
  # Error tracking (optional — leave blank to disable Sentry)
  SENTRY_DSN=
  ```

**Dependency added:** `@sentry/node` in `backend/package.json`.

---

## Unit 2 — Backend health probes

**Responsibility:** Answer "is the process alive?" and "is the service ready to serve traffic?" for orchestrators/uptime monitors.

**New file `backend/controllers/healthController.js`** exporting `live` and `ready`. Probes return **plain minimal JSON, NOT the `ApiResponse` envelope** — orchestrators read the status code first, and the existing `/health` already sits outside the envelope.

### `GET /health/live` (liveness)
- Returns `200` unconditionally: `{ status: 'alive', timestamp: <ISO> }`.
- No dependency checks. Answers only "is the process up?" (orchestrator uses it to decide whether to *restart*).

### `GET /health/ready` (readiness)
- Probes dependencies **in parallel** (`Promise.all` / `Promise.allSettled`), each wrapped so a throw/rejection becomes a status string — never an unhandled 500:
  - **Postgres:** `await prisma.$queryRaw\`SELECT 1\`` → `'ok'`, else `'down'`.
  - **Redis:** `const c = getRedisClient(); await c?.ping()` → `'ok'`; if no client or ping fails → `'degraded'`.
- **Status code:** `200` when Postgres is `'ok'` (Redis state never affects the code); `503` when Postgres is `'down'`.
- **Body:**
  ```json
  {
    "status": "ready",            // or "not ready"
    "checks": { "postgres": "ok", "redis": "ok" },
    "timestamp": "<ISO>"
  }
  ```

### Wiring
- Add a `healthRouter` to `backend/routes/index.js` (exported named, like the others):
  ```js
  const healthRouter = express.Router();
  healthRouter.get('/live', healthController.live);
  healthRouter.get('/ready', healthController.ready);
  ```
- Mount in `backend/server.js`: `app.use('/health', healthRouter);` — placed so `/health/live` and `/health/ready` resolve, with the existing `app.get('/health', ...)` kept unchanged as a liveness alias (the Render keep-alive ping uses it). Mount the router **before** the inline `/health` handler is irrelevant since paths differ; keep both.

**No schema change. No new dependency.**

---

## Unit 3 — Frontend Sentry (`frontend/src/lib/sentry.ts`)

**Responsibility:** Initialize `@sentry/react` when a DSN is present (lean, errors-only); provide an error boundary.

- New file `frontend/src/lib/sentry.ts` exports `initSentry()`.
  - Reads `import.meta.env.VITE_SENTRY_DSN`. Absent → return immediately (no-op).
  - Present:
    ```ts
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.MODE,
      tracesSampleRate: 0.1,
      integrations: [],   // errors only: no Replay, no browserTracing
    });
    ```
- Call `initSentry()` at the top of `frontend/src/main.tsx`, before `ReactDOM.createRoot(...)`.
- Wrap `<App />` in **`<Sentry.ErrorBoundary fallback={<AppErrorFallback />}>`** in `main.tsx`. The fallback is a small branded component (navy `#1A237E`, Manrope, sharp radii — matching the design system) showing a friendly message and a "Reload" button (`window.location.reload()`).
  - This is the app's first real error boundary. With no DSN it still renders the graceful fallback on a render crash (no white page); with a DSN it also reports the error.
- `frontend/.env.example` gains:
  ```
  # Error tracking (optional — leave blank to disable Sentry)
  VITE_SENTRY_DSN=
  ```

**Dependency added:** `@sentry/react` in `frontend/package.json`. Bundle grows modestly; tree-shaken since no extra integrations are enabled.

---

## Unit 4 — Tests & verification

### Backend — `backend/tests/health.test.js` (Jest + Supertest)
- `GET /health/live` → `200`, body `{ status: 'alive' }` (+ `timestamp` present).
- `GET /health/ready` (deps up) → `200`, `checks.postgres === 'ok'`, body shape asserted.
- `GET /health/ready`, Postgres down → mock `prisma.$queryRaw` to reject → `503`, `status: 'not ready'`, `checks.postgres === 'down'`.
- `GET /health/ready`, Redis down / not configured but Postgres up → `200`, `checks.redis === 'degraded'`.

Sentry is not asserted (no-op without a DSN, which CI/tests never set). The `errorHandler` capture is a no-op when uninitialized, so existing error-path tests stay green.

### Frontend
- `npm run lint` and `npm run build` must stay clean (CLAUDE.md gates).
- Add a tiny Vitest test asserting `initSentry()` is a safe no-op when `VITE_SENTRY_DSN` is unset (does not throw).
- Existing Vitest suite unaffected (Sentry no-ops without a DSN in CI).

## Out of scope (deferred)

- Performance tracing / transactions (backend and frontend).
- Session Replay and PII masking config.
- Sentry alert rules / dashboard / project provisioning (operational setup, not code).
- Uptime monitoring wired to the probes; orchestrator/Render health-check configuration (3E / deployment runbook).
- Adding the probes or Sentry to CI required checks.

## Definition of done

- `@sentry/node` and `@sentry/react` added; both init paths are complete no-ops without a DSN and active with one.
- `/health/live` returns 200; `/health/ready` returns 200 (Postgres ok) or 503 (Postgres down) and reports Redis as `ok`/`degraded`.
- New backend health tests pass; full backend Jest suite green.
- Frontend lint + build clean; frontend Vitest suite green.
- `.env.example` (backend + frontend) document the new optional DSN vars.
- CLAUDE.md and docs/ROADMAP.md updated to mark 3D and describe the new endpoints/config.
