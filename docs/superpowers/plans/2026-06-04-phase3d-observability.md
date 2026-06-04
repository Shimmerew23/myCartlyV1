# Phase 3D — Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add env-gated Sentry error tracking (backend + frontend) and real `/health/live` + `/health/ready` probes to CartLy.

**Architecture:** Two independent units. (1) Sentry is initialized only when a DSN env var is present — a complete no-op otherwise (matching the existing Cloudinary/Redis graceful-degradation pattern); backend errors are captured manually in the existing `errorHandler` for `>= 500` only. (2) Health probes live in a dedicated `healthController` + `healthRouter`, return plain JSON outside the `ApiResponse` envelope, and readiness fails (503) only when Postgres is unreachable (Redis down → still 200, reported `degraded`).

**Tech Stack:** Express, Prisma (Postgres), Redis (`redis` client), `@sentry/node`, React 18 + Vite 5, `@sentry/react`, Jest + Supertest, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-04-phase3d-observability-design.md`

**Working branch:** `develop` (per project git workflow — work on develop, user merges to main). All commit messages end with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

---

## File Structure

**Create:**
- `backend/config/sentry.js` — backend Sentry init (env-gated). Exports `initSentry()`.
- `backend/controllers/healthController.js` — `live` + `ready` probe handlers.
- `backend/tests/sentry.test.js` — asserts `initSentry()` is a safe no-op without a DSN.
- `backend/tests/health.test.js` — Supertest coverage of both probes.
- `frontend/src/lib/sentry.ts` — frontend Sentry init (env-gated). Exports `initSentry()`.
- `frontend/src/lib/sentry.test.ts` — asserts no-op without a DSN.
- `frontend/src/components/AppErrorFallback.tsx` — branded error-boundary fallback UI.
- `frontend/.env.example` — documents `VITE_API_URL`, `VITE_BACKEND_URL`, `VITE_SENTRY_DSN`.

**Modify:**
- `backend/server.js` — `require('./config/sentry').initSentry()` as the first executable line; mount `healthRouter` at `/health`.
- `backend/middleware/index.js` — require `@sentry/node`; add `Sentry.captureException(err)` in the `>= 500` branch of `errorHandler`.
- `backend/routes/index.js` — define + export `healthRouter`.
- `backend/tests/helpers/buildApp.js` — mount `healthRouter` so probes are testable.
- `backend/.env.example` — add documented `SENTRY_DSN=`.
- `backend/package.json` / `frontend/package.json` — new deps (via `npm install`).
- `frontend/src/main.tsx` — call `initSentry()`; wrap `<App />` in `<Sentry.ErrorBoundary>`.
- `CLAUDE.md`, `docs/ROADMAP.md`, and the memory index — document the new endpoints/config and mark 3D done.

---

## Task 1: Backend Sentry (config + error capture)

**Files:**
- Create: `backend/config/sentry.js`
- Create: `backend/tests/sentry.test.js`
- Modify: `backend/server.js:1-2`
- Modify: `backend/middleware/index.js` (top requires + `errorHandler` 5xx branch, ~line 1 and ~line 399)
- Modify: `backend/.env.example` (append Sentry section)
- Modify: `backend/package.json` (via npm install)

- [ ] **Step 1: Install `@sentry/node`**

Run from `backend/`:
```bash
npm install @sentry/node
```
Expected: `@sentry/node` appears in `backend/package.json` dependencies; `package-lock.json` updated.

- [ ] **Step 2: Write the failing test**

Create `backend/tests/sentry.test.js`:
```js
describe('initSentry', () => {
  const original = process.env.SENTRY_DSN;
  afterEach(() => {
    if (original === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = original;
  });

  it('is a safe no-op when SENTRY_DSN is unset', () => {
    delete process.env.SENTRY_DSN;
    const { initSentry } = require('../config/sentry');
    expect(() => initSentry()).not.toThrow();
  });

  it('does not throw when SENTRY_DSN is set', () => {
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';
    const { initSentry } = require('../config/sentry');
    expect(() => initSentry()).not.toThrow();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run from `backend/`:
```bash
npx cross-env NODE_ENV=test jest tests/sentry.test.js --runInBand
```
Expected: FAIL — `Cannot find module '../config/sentry'`.

- [ ] **Step 4: Create the Sentry config**

Create `backend/config/sentry.js`:
```js
const Sentry = require('@sentry/node');
const logger = require('../utils/logger');

// Initialize Sentry only when a DSN is configured. No DSN -> complete no-op,
// matching the app's Cloudinary/Redis graceful-degradation pattern.
function initSentry() {
  if (!process.env.SENTRY_DSN) {
    logger.info('Sentry: disabled (no DSN)');
    return;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0, // lean: errors only, no performance tracing
    release: process.env.npm_package_version || '1.0.0',
  });

  logger.info('Sentry: enabled');
}

module.exports = { initSentry };
```

- [ ] **Step 5: Run the test to verify it passes**

Run from `backend/`:
```bash
npx cross-env NODE_ENV=test jest tests/sentry.test.js --runInBand
```
Expected: PASS (2 tests).

- [ ] **Step 6: Initialize Sentry at the top of `server.js`**

In `backend/server.js`, change the first two lines from:
```js
require('dotenv').config();
require('express-async-errors');
```
to:
```js
require('dotenv').config();
require('./config/sentry').initSentry();
require('express-async-errors');
```

- [ ] **Step 7: Capture 5xx errors in `errorHandler`**

In `backend/middleware/index.js`, add to the top-of-file requires (near the other `require(...)` lines):
```js
const Sentry = require('@sentry/node');
```
Then, in `errorHandler`, find the existing 5xx logging branch (~line 399):
```js
  if (error.statusCode >= 500) {
    logger.error(`${error.statusCode} - ${error.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`, { stack: err.stack });
  } else {
```
and add the capture call immediately after the `logger.error(...)` line:
```js
  if (error.statusCode >= 500) {
    logger.error(`${error.statusCode} - ${error.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`, { stack: err.stack });
    Sentry.captureException(err); // no-op if Sentry.init() was never called
  } else {
```

- [ ] **Step 8: Document the env var**

Append to `backend/.env.example`:
```
# ============================
# ERROR TRACKING (Optional — leave blank to disable Sentry)
# ============================
SENTRY_DSN=
```

- [ ] **Step 9: Run the full backend suite to confirm no regression**

Run from `backend/`:
```bash
npm test
```
Expected: PASS — all existing tests plus the 2 new `sentry.test.js` tests green (Sentry capture is a no-op without a DSN, so error-path tests are unaffected).

- [ ] **Step 10: Commit**

```bash
git add backend/config/sentry.js backend/tests/sentry.test.js backend/server.js backend/middleware/index.js backend/.env.example backend/package.json backend/package-lock.json
git commit -m "feat(observability): env-gated Sentry error tracking (backend)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Backend health probes (`/health/live`, `/health/ready`)

**Files:**
- Create: `backend/controllers/healthController.js`
- Create: `backend/tests/health.test.js`
- Modify: `backend/routes/index.js` (add `healthRouter` + export it, ~line 1 area and the `module.exports` block at ~line 247)
- Modify: `backend/tests/helpers/buildApp.js` (mount `healthRouter`)
- Modify: `backend/server.js` (mount `healthRouter`)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/health.test.js`:
```js
const request = require('supertest');
const { buildApp } = require('./helpers/buildApp');
const { prisma } = require('../config/prisma');
const redis = require('../config/redis');

const app = buildApp();

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GET /health/live', () => {
  it('returns 200 alive', async () => {
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('alive');
    expect(res.body.timestamp).toBeDefined();
  });
});

describe('GET /health/ready', () => {
  it('returns 200 ready with postgres ok (redis degraded when not connected)', async () => {
    // In the test env Redis is never connected, so redis reports "degraded".
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks.postgres).toBe('ok');
    expect(res.body.checks.redis).toBe('degraded');
    expect(res.body.timestamp).toBeDefined();
  });

  it('returns 503 not ready when postgres is down', async () => {
    jest.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('not ready');
    expect(res.body.checks.postgres).toBe('down');
  });

  it('reports redis ok when a reachable client responds to ping', async () => {
    jest.spyOn(redis, 'getRedisClient').mockReturnValue({
      ping: jest.fn().mockResolvedValue('PONG'),
    });
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.checks.redis).toBe('ok');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `backend/`:
```bash
npx cross-env NODE_ENV=test jest tests/health.test.js --runInBand
```
Expected: FAIL — `/health/live` returns 404 (routes not mounted) / `Cannot find module '../controllers/healthController'`.

- [ ] **Step 3: Create the health controller**

Create `backend/controllers/healthController.js`:
```js
const { prisma } = require('../config/prisma');
const redis = require('../config/redis');

// Postgres is the system of record — required for readiness.
async function checkPostgres() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return 'ok';
  } catch (_err) {
    return 'down';
  }
}

// Redis is optional (graceful degradation) — never blocks readiness.
async function checkRedis() {
  try {
    const client = redis.getRedisClient();
    if (!client) return 'degraded';
    await client.ping();
    return 'ok';
  } catch (_err) {
    return 'degraded';
  }
}

// Liveness — is the process up? No dependency checks; used to decide restarts.
function live(_req, res) {
  res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
}

// Readiness — can the service serve traffic? 503 only if Postgres is down.
async function ready(_req, res) {
  const [postgres, redisState] = await Promise.all([checkPostgres(), checkRedis()]);
  const checks = { postgres, redis: redisState };
  const ok = postgres === 'ok';
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ready' : 'not ready',
    checks,
    timestamp: new Date().toISOString(),
  });
}

module.exports = { live, ready };
```

- [ ] **Step 4: Define + export `healthRouter` in `routes/index.js`**

In `backend/routes/index.js`, add a controller require near the other controller requires (after line 14, `warehouseCtrl`):
```js
const healthCtrl = require('../controllers/healthController');
```
Then, just before the final `module.exports` block (~line 247), define the router:
```js
// ============================================================
// HEALTH ROUTES (liveness / readiness — plain JSON, no envelope)
// ============================================================
const healthRouter = express.Router();
healthRouter.get('/live', healthCtrl.live);
healthRouter.get('/ready', healthCtrl.ready);
```
And add `healthRouter` to the `module.exports` object:
```js
module.exports = {
  authRouter,
  productRouter,
  reviewRouter,
  orderRouter,
  userRouter,
  cartRouter,
  categoryRouter,
  carrierRouter,
  adminRouter,
  feedbackRouter,
  warehouseRouter,
  healthRouter,
};
```

- [ ] **Step 5: Mount `healthRouter` in the test app**

In `backend/tests/helpers/buildApp.js`, add `healthRouter` to the destructured import from `../../routes/index`:
```js
const {
  authRouter, userRouter, productRouter, categoryRouter, cartRouter, orderRouter, adminRouter,
  reviewRouter, carrierRouter, feedbackRouter, warehouseRouter, healthRouter,
} = require('../../routes/index');
```
and mount it (before `notFound`):
```js
  app.use('/health', healthRouter);
  app.use(notFound);
```

- [ ] **Step 6: Run the test to verify it passes**

Run from `backend/`:
```bash
npx cross-env NODE_ENV=test jest tests/health.test.js --runInBand
```
Expected: PASS (4 tests).

- [ ] **Step 7: Mount `healthRouter` in `server.js`**

In `backend/server.js`, add `healthRouter` to the destructured import from `./routes/index`:
```js
const {
  authRouter, productRouter, reviewRouter, orderRouter,
  userRouter, cartRouter, categoryRouter, carrierRouter, adminRouter, feedbackRouter, warehouseRouter,
  healthRouter,
} = require('./routes/index');
```
Then mount it alongside the other routes (after the `warehouseRouter` mount, ~line 166, and above the existing inline `app.get('/health', ...)`):
```js
app.use('/api/warehouse', warehouseRouter);
app.use('/health', healthRouter);
```
Leave the existing `app.get('/health', ...)` handler unchanged — paths differ (`/health` vs `/health/live` `/health/ready`), so all three resolve and the legacy keep-alive ping keeps working.

- [ ] **Step 8: Sanity-check the mounted routes still pass**

Run from `backend/`:
```bash
npx cross-env NODE_ENV=test jest tests/health.test.js --runInBand
```
Expected: PASS (4 tests) — buildApp mirrors server.js mounting.

- [ ] **Step 9: Commit**

```bash
git add backend/controllers/healthController.js backend/tests/health.test.js backend/routes/index.js backend/tests/helpers/buildApp.js backend/server.js
git commit -m "feat(observability): /health/live + /health/ready probes (postgres required, redis optional)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Frontend Sentry + error boundary

**Files:**
- Create: `frontend/src/lib/sentry.ts`
- Create: `frontend/src/lib/sentry.test.ts`
- Create: `frontend/src/components/AppErrorFallback.tsx`
- Create: `frontend/.env.example`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/package.json` (via npm install)

- [ ] **Step 1: Install `@sentry/react`**

Run from `frontend/`:
```bash
npm install @sentry/react
```
Expected: `@sentry/react` appears in `frontend/package.json` dependencies; `package-lock.json` updated.

- [ ] **Step 2: Write the failing test**

Create `frontend/src/lib/sentry.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { initSentry } from './sentry';

describe('initSentry', () => {
  it('is a safe no-op when VITE_SENTRY_DSN is unset', () => {
    // vitest config does not set VITE_SENTRY_DSN, so this must not throw.
    expect(() => initSentry()).not.toThrow();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run from `frontend/`:
```bash
npx vitest run src/lib/sentry.test.ts
```
Expected: FAIL — cannot resolve `./sentry`.

- [ ] **Step 4: Create the Sentry init module**

Create `frontend/src/lib/sentry.ts`:
```ts
import * as Sentry from '@sentry/react';

// Initialize Sentry only when a DSN is configured. No DSN -> no-op,
// so dev/CI builds (and tests) run with error tracking disabled.
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    integrations: [], // errors only: no Session Replay, no browser tracing
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run from `frontend/`:
```bash
npx vitest run src/lib/sentry.test.ts
```
Expected: PASS (1 test).

- [ ] **Step 6: Create the branded error-boundary fallback**

Create `frontend/src/components/AppErrorFallback.tsx`:
```tsx
// Fallback shown when a render error bubbles to the app-level Sentry ErrorBoundary.
// Branded to the design system (navy #1A237E, Manrope, sharp radii).
export default function AppErrorFallback() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white px-6 text-center">
      <h1 className="font-['Manrope'] text-3xl font-bold text-[#1A237E]">
        Something went wrong
      </h1>
      <p className="mt-3 max-w-md font-['Plus_Jakarta_Sans'] text-gray-600">
        An unexpected error occurred. Please reload the page — if the problem
        persists, try again in a few minutes.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-6 rounded-[4px] bg-[#1A237E] px-6 py-3 font-['Plus_Jakarta_Sans'] text-sm font-semibold text-white transition-colors hover:bg-[#151b63]"
      >
        Reload page
      </button>
    </div>
  );
}
```

- [ ] **Step 7: Wire init + error boundary into `main.tsx`**

Edit `frontend/src/main.tsx`. Add imports at the top (after the existing imports):
```tsx
import * as Sentry from '@sentry/react';
import { initSentry } from './lib/sentry';
import AppErrorFallback from './components/AppErrorFallback';
```
Call `initSentry()` once, before the `createRoot` call:
```tsx
initSentry();
```
Wrap the existing provider tree in a `Sentry.ErrorBoundary`. Change:
```tsx
ReactDOM.createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
```
to:
```tsx
ReactDOM.createRoot(document.getElementById('root')!).render(
  <Sentry.ErrorBoundary fallback={<AppErrorFallback />}>
  <Provider store={store}>
```
and close it after the matching `</Provider>`:
```tsx
  </Provider>
  </Sentry.ErrorBoundary>
);
```

- [ ] **Step 8: Create the frontend env example**

Create `frontend/.env.example`:
```
# API base URL the SPA calls (include the /api suffix)
VITE_API_URL=http://localhost:5000/api
# Backend origin (used for non-/api links, e.g. OAuth)
VITE_BACKEND_URL=http://localhost:5000

# Error tracking (optional — leave blank to disable Sentry)
VITE_SENTRY_DSN=
```

- [ ] **Step 9: Lint, test, and build to confirm everything is clean**

Run from `frontend/`:
```bash
npm run lint && npm run test:run && npm run build
```
Expected: ESLint clean (`--max-warnings 0`); Vitest green (existing 26 + the new sentry no-op test); `tsc` type-check + Vite production build succeed.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/lib/sentry.ts frontend/src/lib/sentry.test.ts frontend/src/components/AppErrorFallback.tsx frontend/src/main.tsx frontend/.env.example frontend/package.json frontend/package-lock.json
git commit -m "feat(observability): lean env-gated Sentry + app error boundary (frontend)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Documentation + roadmap + memory

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/ROADMAP.md`
- Modify: `C:\Users\Sam\.claude\projects\E--GitHub-myCartlyV1\memory\phase3-progress-and-security-followup.md` and its `MEMORY.md` index line

- [ ] **Step 1: Document the endpoints + Sentry in CLAUDE.md**

In `CLAUDE.md`, in the backend Architecture/cross-cutting area, add a short paragraph describing observability. Insert after the **Auth model** paragraph (or near the other cross-cutting backend notes):
```markdown
**Observability** — Sentry error tracking is env-gated (`SENTRY_DSN` backend / `VITE_SENTRY_DSN` frontend); with no DSN it is a complete no-op (like Cloudinary/Redis). The backend inits Sentry as the first line of `server.js` (`config/sentry.js`) and captures only `>= 500` errors from the central `errorHandler`; the frontend inits lean (errors only, no replay/tracing) in `main.tsx` and wraps the app in `<Sentry.ErrorBoundary>`. Health probes: `GET /health/live` (always 200 — process liveness) and `GET /health/ready` (`healthController`, mounted via `healthRouter`) return plain JSON **outside** the `ApiResponse` envelope; readiness is 503 only when Postgres (system of record) is unreachable — Redis down is reported `degraded` but still 200, honoring graceful degradation. The legacy `GET /health` remains for the Render keep-alive ping.
```

- [ ] **Step 2: Mark 3D complete in ROADMAP.md**

In `docs/ROADMAP.md`:
- Change the status line `🟨 In progress (3A–3C complete)` → `🟨 In progress (3A–3D complete)`.
- Change the `- [ ] **3D — Observability:** ...` line to `- [x]` and append a detail clause:
```markdown
- [x] **3D — Observability:** Env-gated Sentry (`@sentry/node` + `@sentry/react`, no-op without a DSN; backend captures 5xx in `errorHandler`, frontend lean errors-only + `<Sentry.ErrorBoundary>`) and real probes `GET /health/live` / `GET /health/ready` (Postgres required → 503 when down; Redis optional → `degraded`). Spec: [phase3d](superpowers/specs/2026-06-04-phase3d-observability-design.md)
```
- In the "workstreams" checklist, change `- [ ] Error tracking: Sentry (backend + frontend)` → `- [x]` and `- [ ] Health-check endpoints (liveness/readiness) for DB + Redis` → `- [x]`.

- [ ] **Step 3: Update the memory file**

In `C:\Users\Sam\.claude\projects\E--GitHub-myCartlyV1\memory\phase3-progress-and-security-followup.md`:
- Update the `description:` to say `(3A–3D done)`.
- Add a `**3D complete**` bullet summarizing: env-gated Sentry (backend `config/sentry.js` first line of server.js, 5xx capture in errorHandler; frontend `lib/sentry.ts` lean + `<Sentry.ErrorBoundary>` + `AppErrorFallback`), health probes `/health/live` + `/health/ready` (`healthController`/`healthRouter`, Postgres-required 503, Redis `degraded`), new tests `backend/tests/health.test.js` + `sentry.test.js` + `frontend/src/lib/sentry.test.ts`.
- Change `**Remaining:**` to list only 3E and 3F.

Also update the matching index line in `C:\Users\Sam\.claude\projects\E--GitHub-myCartlyV1\memory\MEMORY.md` to reflect `3A+3B+3C+3D done`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/ROADMAP.md
git commit -m "docs(observability): document 3D Sentry + health probes; mark 3D complete

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
(The memory files live outside the repo and are not committed.)

---

## Task 5: Final verification

- [ ] **Step 1: Run the full backend suite**

Run from `backend/`:
```bash
npm test
```
Expected: PASS — all suites including `sentry.test.js` (2) and `health.test.js` (4).

- [ ] **Step 2: Run frontend lint + tests + build**

Run from `frontend/`:
```bash
npm run lint && npm run test:run && npm run build
```
Expected: all clean/green.

- [ ] **Step 3: Push develop**

```bash
git push origin develop
```
Expected: CI (Backend, Frontend, E2E) triggers on develop and goes green.

---

## Self-Review

**Spec coverage:**
- Unit 1 (backend Sentry config + 5xx capture + `.env.example`) → Task 1. ✓
- Unit 2 (health probes, controller + router, mounting, envelope-free, Redis degraded) → Task 2. ✓
- Unit 3 (frontend `lib/sentry.ts` lean, `<Sentry.ErrorBoundary>` + fallback, `main.tsx`, `.env.example`) → Task 3. ✓
- Unit 4 tests (backend live/ready/postgres-down/redis-ok; frontend no-op) → Tasks 1–3 (TDD steps). ✓
- Docs/ROADMAP/memory (Definition of Done) → Task 4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output. ✓

**Type/name consistency:** `initSentry` (both backend + frontend), `healthRouter`, `healthCtrl.live`/`.ready`, `live`/`ready`, `checkPostgres`/`checkRedis`, `AppErrorFallback`, env vars `SENTRY_DSN` / `VITE_SENTRY_DSN` — all consistent across tasks. The redis check uses `redis.getRedisClient()` (module-qualified) so the test's `jest.spyOn(redis, 'getRedisClient')` intercepts it; `prisma.$queryRaw` is spied on the shared singleton. ✓

**Note on the "deps up" readiness test:** in the test environment Redis is never connected, so `checks.redis` is `'degraded'` by default — the first ready test asserts exactly that (covering both the 200-ready path and the redis-degraded path), and a separate test mocks a reachable client to assert `'ok'`.
