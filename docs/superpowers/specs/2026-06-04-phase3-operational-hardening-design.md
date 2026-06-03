# Phase 3 Design — Operational Hardening

- **Date:** 2026-06-04
- **Phase:** 3 of the [production-readiness roadmap](../../ROADMAP.md)
- **Depends on:** Phase 1 (Postgres/Prisma), Phase 2 (payments) — both complete
- **Status:** Design approved; ready for implementation planning

## Goal

Take CartLy from "feature-complete" to "safe to run for real paying users." Add
the operational safety net a real-money application requires: continuous
integration that gates merges, automated tests on both ends, error tracking,
real health probes, automated database backups with a *rehearsed* restore,
managed secrets, and a security pass that removes deprecated middleware.

This phase changes **how we ship and operate** the app. It does not add product
features and must not change the frozen API contract
(`{ statusCode, success, message, data, timestamp }`) or any existing JSON shape.

## Launch context & decisions

These framed the design (decided 2026-06-04):

- **Launch context:** real paying users, soon — strictest reliability/security bar, no corners cut.
- **Infrastructure:** move to **paid managed** services. Recommended pairing: **Neon** (PostgreSQL, automated backups + PITR) + **Upstash** (Redis), with the app hosted on Render. Final provider call is the user's at rollout; the DR procedure is written around provider backup tooling, not hand-rolled scripts.
- **Structure:** decompose into incremental sub-plans (like 1A–1F, 2A–2D), **safety-net first** — CI + tests before everything else, so every later change is gated.
- **Deprecated middleware:** `csurf` and `xss-clean` are unmaintained; they are **replaced within this phase** (3F), not deferred as tech-debt.

## Non-goals

- No new product features (those are Phase 4).
- No API contract or JSON-shape changes; no schema/data-model changes (health
  probes and Sentry are additive and read-only).
- No multi-currency work — the USD-catalog / PHP-settlement gap is documented as
  a launch caveat and remains Phase 4.
- Not chasing a coverage percentage. Tests target the highest-risk,
  logic-bearing code; "100% coverage" is explicitly out of scope.

## Sub-plan decomposition (safety-net first)

Each sub-plan is its own spec → plan → build → commit cycle.

| Sub-plan | Title | Rationale for ordering |
|---|---|---|
| **3A** | CI pipeline + green gates | First, so every later change is gated. |
| **3B** | Frontend unit/component tests (Vitest + RTL) | Build the frontend net the backend already has. |
| **3C** | Playwright E2E (critical flows) | Split out — E2E setup is heavier; runs as its own CI job. |
| **3D** | Observability (Sentry + real health probes) | See failures once code is well-tested. |
| **3E** | Backups, DR & secrets | Provision paid infra; make data recoverable. |
| **3F** | Security pass + deployment runbook | Final review + the cold-start deploy procedure. |

---

## 3A — CI pipeline + green gates

**What changes**

- `.github/workflows/ci.yml` with two jobs:
  - **backend:** `services: postgres` (and redis if needed), `npm ci`,
    `prisma migrate deploy` against the CI database, `npm test`
    (`cross-env NODE_ENV=test jest --runInBand`). Mirrors how `tests/setup.js`
    already provisions the test DB locally.
  - **frontend:** `npm ci`, `npm run lint`, `npm run build` (the build
    type-checks via `tsc`).
- **Triggers:** push to `develop`; PRs targeting `main`. Branch protection on
  `main` requires the workflow green. The user still performs the `main` merge
  (consistent with the develop-only workflow).

**Prerequisites — the two gates are currently broken and must be fixed here:**

- **Frontend ESLint config is missing.** ESLint 8.56 + `@typescript-eslint`
  6.x + `eslint-plugin-react-hooks` 4.x are installed but there is no config
  file, so `npm run lint` fails. Add `.eslintrc.cjs` (legacy format matching
  ESLint 8) wired to the installed plugins, `--max-warnings 0`.
- **Two pre-existing TS errors** break `npm run build` (the typecheck gate):
  - `seller/Profile.tsx` — `SellerProfile` type is missing `storeEmail`,
    `storePhone`, `returnPolicy`, `shippingPolicy`, `socialLinks`.
  - `seller/EditProduct.tsx` — `editId` prop type mismatch.
  Fix the types/props so the page compiles; verify against the backend
  serializer shapes so the fix is correct, not just type-silenced.

**Done when**

- CI runs green on a real PR into `main`.
- lint + typecheck + backend Jest all gate merges.
- `npm run lint` and `npm run build` both pass locally.

---

## 3B — Frontend unit/component tests (Vitest + RTL)

**What changes**

- Add dev deps: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`,
  `@testing-library/user-event`, `jsdom`. Add `vitest.setup.ts` and
  `test` / `test:run` scripts. Vitest reuses the Vite config (no second build
  toolchain).
- Cover the highest-risk, logic-bearing UI:
  - `api/axios.ts` — envelope unwrap (`{ data: { data } }`) and the 401
    auto-refresh **queue** (dedupe of concurrent refreshes; `auth:logout`
    dispatch on failure; login/register excluded from retry).
  - `auth` slice + login flow.
  - cart math (totals, item counts) and checkout payment-method selection.
  - the admin **refund dialog** built in 2D (amount validation, blank = full
    remaining, reason).
- Wire `npm run test:run` into the frontend CI job.

**Done when**

- A meaningful Vitest suite passes locally and in CI.
- The critical modules above have real assertions (not smoke-only).

---

## 3C — Playwright E2E (critical flows)

**What changes**

- Add `@playwright/test` + config. **Approach:** run against a **seeded local
  backend + Vite `preview` (the built bundle)** — faster and simpler in CI than
  docker-compose, while still exercising the production build. docker-compose
  stays available for fuller local smoke; revisit only if a flow depends on
  nginx-proxy behavior.
- Flows:
  - **Buyer:** browse → add to cart → checkout (COD) → order confirmation.
  - **Admin:** login → view orders → issue a refund.
  - **Seller smoke:** login → seller dashboard renders.
- Runs as a **separate CI job** (heavier; `needs:` the build job), against the
  seeded test database.

**Done when**

- The buyer COD journey and the admin refund flow pass headless in CI.

---

## 3D — Observability (Sentry + real health probes)

**What changes**

- **Sentry backend:** `@sentry/node`, initialized in `server.js`, **gated on
  `SENTRY_DSN`** (no-op when unset, so dev/test stay clean). Request/error
  handlers wired so unhandled 500s are captured with request context, placed to
  cooperate with the existing `errorHandler` (Sentry capture before the response
  formatter). PII/secret scrubbing configured.
- **Sentry frontend:** `@sentry/react`, initialized in `main.tsx`, gated on
  `VITE_SENTRY_DSN`, with an error boundary at the app root.
- **Health probes — replace the current static `/health`:**
  - `GET /health/live` — process liveness only (cheap; no I/O).
  - `GET /health/ready` — readiness: `SELECT 1` against Postgres and `PING`
    against Redis. Returns **200** only when Postgres is healthy. Redis is
    non-fatal by design, so a Redis outage returns **200** with
    `redis: "degraded"`; a Postgres failure returns **503**.
  - Keep the existing keep-alive self-ping but point it at `/health/live`.
  - Both probes return the `ApiResponse`-consistent envelope where practical;
    `/health/ready` uses HTTP status (200/503) so platforms can gate on it.

**Done when**

- A deliberately thrown error appears in Sentry from both backend and frontend.
- `/health/ready` returns 503 when Postgres is unreachable and 200 (with a
  `redis: "degraded"` flag) when only Redis is down.

---

## 3E — Backups, DR & secrets

**What changes**

- **Provision** the paid managed services (recommended Neon Postgres + Upstash
  Redis); update `DATABASE_URL` / Redis URL via the host's secret store.
- **Backups:** enable automated daily backups + PITR on the managed Postgres.
- **DR runbook** (`docs/runbooks/disaster-recovery.md`): documented restore
  procedure **and an actual test restore performed once** — restore a backup to
  a scratch database, verify row counts and a seeded login, and record the
  result. This satisfies the roadmap's "a backup can be restored" criterion.
- **Secrets:** production secrets live in the host secret store, never the repo;
  document a rotation policy; audit the repo to confirm no secrets are committed
  and that `backend/.env.example` (and frontend env) list **every** required
  variable — it is the onboarding contract.

**Done when**

- Automated backups are visible in the provider console.
- A restore has been executed successfully and recorded in the runbook.
- Secrets are documented, externalized, and confirmed absent from the repo.

---

## 3F — Security pass + deployment runbook

**What changes**

- **Dependency security:** `npm audit` on both packages; resolve high/critical
  findings. **Replace deprecated middleware:**
  - `csurf` (deprecated) → `csrf-csrf` / double-submit-cookie pattern.
  - `xss-clean` (unmaintained) → sanitization via the validated Joi `schemas`
    layer and/or a maintained sanitizer; confirm Helmet covers the gap.
- **Config review (no functional changes unless a hole is found):** Helmet CSP,
  CORS allowlist, Express + nginx rate-limit zones, RBAC matrix spot-check,
  JWT/refresh/Redis-blacklist flow, and production cookie flags
  (`Secure` / `HttpOnly` / `SameSite`).
- **Deployment runbook** (`docs/runbooks/deployment.md`): cold-start production
  deploy — provision/secrets, `prisma migrate deploy`, build, health
  verification, rollback procedure — plus the USD-catalog / PHP-settlement
  currency caveat (resolved in Phase 4).

**Done when**

- No unaddressed high/critical `npm audit` findings.
- `csurf` and `xss-clean` are removed and replaced with maintained equivalents;
  the suite stays green.
- The runbook is complete enough to deploy from a cold start.

---

## Definition of done (phase)

- CI is green and gates merges into `main`.
- Critical buyer/seller/admin flows are covered by E2E tests.
- Errors surface in Sentry (both ends); liveness/readiness probes behave
  correctly.
- Automated backups exist and a restore has been performed and recorded.
- No deprecated security middleware remains; no unaddressed high/critical audit
  findings.
- Deployment + DR runbooks exist.
- Throughout: the API contract and all JSON shapes are unchanged; the backend
  Jest suite and the new frontend suites stay green.

## Risks & notes

- **CI database parity:** CI must run `prisma migrate deploy` against a fresh
  Postgres each run; `pg_trgm`/`tsvector` features from Phase 1 need the
  extensions present (migrations already create them — verify in CI).
- **Sentry noise/cost:** gate by DSN and sample server transactions
  conservatively to stay within free/paid limits.
- **Deprecated-middleware swap (3F)** is the highest-risk change (touches CSRF
  on every mutating route) — covered by the now-existing test gates, landed in
  its own commit, and verified against the auth/refund integration tests.
- **Provider migration (3E)** changes connection strings only; the Prisma schema
  and app code are provider-agnostic.
