# Phase 3C — Playwright E2E (Critical Flows) — Design

> Sub-plan of [Phase 3 — Operational Hardening](./2026-06-04-phase3-operational-hardening-design.md).
> Status: **design approved 2026-06-04**, spec under review.

**Goal:** Add a Playwright end-to-end suite that exercises CartLy's critical user journeys (buyer COD checkout, admin refund, seller dashboard smoke) against the production frontend build and a real seeded backend, and gate it in CI as a separate job.

**Architecture:** Playwright lives in the `frontend/` package and drives the **production bundle served by `vite preview`** (`:4173`) talking to a **real Express backend** (`:5000`) on a **seeded Postgres** database. This matches the Phase 3 spec's chosen approach — faster and simpler in CI than docker-compose, while still exercising the built bundle. docker-compose remains available for fuller local/nginx smoke.

**Tech stack:** `@playwright/test` (Chromium only), the existing Express + Prisma backend, Vite preview, Postgres.

---

## Decisions (locked during brainstorming)

- **Refundable-order test data: dedicated E2E seed.** A new `backend/utils/seedE2E.js` runs the normal seed (users + 8 products) and additionally inserts one known **PAID** order owned by `user@cartly.com`, so the admin-refund flow always has a stable, refundable order. (The standard seeder creates no orders, and a COD checkout produces a `pending`/non-refundable order.)
- **Browser scope: Chromium only.** These are functional flow tests, not cross-browser rendering checks. Firefox/WebKit can be added later if needed.
- **Approach: seeded backend + Vite preview** (not docker-compose) per the Phase 3 spec.
- **Location: in `frontend/`** — `playwright.config.ts` + `e2e/` directory.

---

## Cross-origin plumbing (the key gotcha)

The preview serves the built bundle on `http://localhost:4173`; the backend runs on `http://localhost:5000`. Therefore:

- The frontend must be **built with `VITE_API_URL=http://localhost:5000/api`** (Vite bakes env at build time; `preview` does not proxy `/api` like the dev server does).
- The backend must be started with **`FRONTEND_URL=http://localhost:4173`** so its CORS layer allows the preview origin (with credentials).
- Auth in the flows rides on the **`accessToken` in `localStorage`** (attached as a header by the axios interceptor), so the journeys do not depend on the httpOnly refresh cookie. `localhost:4173` and `:5000` are the same site (cookies are `SameSite=Lax` in non-production), so refresh would still work, but the flows are short enough not to rely on it.

---

## Components

### `backend/utils/seedE2E.js` (new)
- Imports and runs the existing seeder's logic (or requires `seeder.js` and calls it), then creates **one PAID order**:
  - Buyer = `user@cartly.com`; one order item referencing a seeded product; `paymentMethod: 'cod'`, `paymentStatus: 'paid'`, `status: 'delivered'`, a known `orderNumber` (e.g. `E2E-REFUND-0001`), `totalPrice` set, `paymentResult: { refundedAmount: 0 }`, plus the required `shippingAddress` fields and an initial `OrderStatusEvent`.
  - Idempotent enough for repeated CI runs (the seeder wipes tables first, so a clean insert each run).
- Runnable via `node utils/seedE2E.js` and invoked by Playwright `globalSetup`.

### `frontend/playwright.config.ts` (new)
- `testDir: './e2e'`, Chromium project, `baseURL: 'http://localhost:4173'`, headless, retries in CI, HTML reporter.
- `globalSetup`: runs the E2E seed against the test DB (e.g. `node ../backend/utils/seedE2E.js` with the test `DATABASE_URL`).
- `webServer`: an array starting (1) the backend (`npm --prefix ../backend start` with `NODE_ENV`, test `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL=http://localhost:4173`, etc.) and (2) `npm run preview -- --port 4173`. `reuseExistingServer: !process.env.CI`.

### `frontend/e2e/` test specs (new)
- `e2e/helpers.ts` — login helper (drive `/login` UI or seed `localStorage` token via API), seeded account constants, small utilities.
- `e2e/buyer-cod.spec.ts` — the buyer COD journey.
- `e2e/admin-refund.spec.ts` — the admin refund flow.
- `e2e/seller-smoke.spec.ts` — the seller dashboard smoke.

### `frontend/package.json`
- Add `@playwright/test` devDep; scripts `test:e2e` (`playwright test`) and `test:e2e:ui` (`playwright test --ui`).

### App source (`frontend/src/`)
- Add `data-testid` attributes **only where** a flow element cannot be reliably targeted by role/label/text. Keep additions minimal and behavior-preserving.

### `.github/workflows/ci.yml`
- New **`e2e` job**, `needs: [backend, frontend]`, Postgres 16 service, env mirroring the backend job plus `FRONTEND_URL`. Steps: checkout → setup-node → `npm ci` (backend + frontend) → `prisma generate` + `prisma migrate deploy` → build frontend with `VITE_API_URL=http://localhost:5000/api` → `npx playwright install --with-deps chromium` → `npm run test:e2e`. Upload the Playwright HTML report as an artifact on failure. Triggers unchanged (push `develop` / PRs into `main`).

---

## Test flows

1. **Buyer COD journey** (`buyer-cod.spec.ts`) — primary done-when:
   log in as `user@cartly.com` → open a seeded product → add to cart → go to cart, ensure the item is selected → proceed to checkout → shipping (form prefilled or filled) → carrier (no preference) → payment (COD is the default) → review → place order → assert landing on the order confirmation/detail page with an order number.

2. **Admin refund** (`admin-refund.spec.ts`) — second done-when:
   log in as `admin@cartly.com` → Admin Orders → locate the seeded paid order (`E2E-REFUND-0001`) → open its refund dialog → issue a full refund (blank amount) → assert success (payment status shows refunded / the row reflects it).

3. **Seller smoke** (`seller-smoke.spec.ts`):
   log in as `seller@cartly.com` → navigate to the seller dashboard → assert it renders (a known heading/widget is visible).

---

## Non-goals

- No PayPal/GCash E2E (external providers; COD only).
- No cross-browser (Chromium only) and no visual/snapshot testing.
- No docker-compose/nginx path in CI (kept for manual smoke only).
- No new product features or API/schema changes (other than the additive E2E seed script).

---

## Done when

- The **buyer COD journey** and the **admin refund** flow pass **headless in CI**.
- The seller smoke test passes.
- `seedE2E.js` reliably produces the refundable order; the `e2e` CI job is green and uploads its report on failure.
- Existing `backend`, `frontend` (lint + Vitest + build) jobs remain green.

---

## Risks / watch-items

- **Cross-origin/CORS:** if API calls fail in preview, verify the build used the E2E `VITE_API_URL` and the backend `FRONTEND_URL` allows `:4173` with credentials.
- **Flakiness:** prefer role/text locators and Playwright auto-waiting; add `data-testid` only where necessary; enable CI retries (e.g. `retries: 2`).
- **Server startup timing:** Playwright `webServer` should wait on the preview URL (and the backend health endpoint) before starting tests; give generous `timeout`.
- **CI minutes:** the e2e job adds browser install + two servers; acceptable as a separate job. Branch-protection required-checks stay as the two existing ones until `e2e` is proven stable, then optionally add it.
- **Seed/DB coupling:** `seedE2E.js` must target the same `DATABASE_URL` the backend uses in the job; run it in `globalSetup` after `migrate deploy`.
