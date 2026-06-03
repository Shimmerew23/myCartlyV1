# Phase 3B — Frontend Unit/Component Tests (Vitest + RTL) — Design

> Sub-plan of [Phase 3 — Operational Hardening](./2026-06-04-phase3-operational-hardening-design.md).
> Status: **design approved 2026-06-04**, spec under review.

**Goal:** Build the frontend's automated safety net (the backend already has 189 Jest/Supertest tests) by adding a Vitest + React Testing Library suite that covers the highest-risk, logic-bearing UI, and wiring it into the existing frontend CI job.

**Architecture:** Vitest reuses the existing Vite toolchain (a `test` block in `vite.config.ts`, jsdom environment). HTTP is intercepted at the network layer with **MSW** so the real `axios` interceptors are exercised faithfully (and the same handlers carry forward to 3C Playwright). Tests are co-located next to source as `*.test.ts(x)`. Scope is deliberately the four critical modules named in the Phase 3 spec — real assertions, no coverage chasing.

**Tech stack:** Vitest, @testing-library/react, @testing-library/jest-dom, @testing-library/user-event, jsdom, msw. Existing: React 18, Redux Toolkit, React Query v5, react-router v6, axios, react-hook-form + zod.

---

## Decisions (locked during brainstorming)

- **HTTP mocking: MSW.** Realistic interception of the real axios instance (needed to test the 401→refresh→retry queue), reusable in 3C.
- **Scope: the Phase 3 spec's four critical modules only.** axios helpers + refresh queue; auth slice + login; cart math + checkout payment selection; admin refund dialog. No coverage thresholds, no broad smoke tests (3C/Playwright covers full flows).
- **Config: reuse Vite config** (no separate build toolchain).
- **Layout: co-located `*.test.ts(x)`.**

---

## Test infrastructure

### Files created

- `frontend/vitest.setup.ts` — global setup:
  - `import '@testing-library/jest-dom'`
  - start MSW: `beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))`, `afterEach(() => server.resetHandlers())`, `afterAll(() => server.close())`
  - `afterEach(() => { cleanup(); localStorage.clear(); })` (RTL cleanup + isolate token state)
  - jsdom gap stubs added only as tests surface them (e.g. `window.matchMedia`).
- `frontend/src/test/server.ts` — `export const server = setupServer(...handlers)`.
- `frontend/src/test/handlers.ts` — default MSW handlers for the endpoints the suites hit; individual tests override with `server.use(...)`.
- `frontend/src/test/renderWithProviders.tsx` — helper that mounts a component inside a fresh Redux store (real reducers, optional `preloadedState`), a fresh `QueryClientProvider` (retries disabled), and a `MemoryRouter` (configurable `initialEntries`). Returns RTL render result + the store.

### Files modified

- `frontend/vite.config.ts` — add a `test` block: `environment: 'jsdom'`, `globals: true`, `setupFiles: ['./vitest.setup.ts']`, `css: false`. Uses `defineConfig` from `vitest/config` (keeps the existing `@vitejs/plugin-react`).
- `frontend/package.json` — add dev deps above; add scripts `"test": "vitest"` and `"test:run": "vitest run"`.
- `frontend/.eslintrc.cjs` — ensure test globals/files don't trip lint (e.g. allow `src/test/**` and `*.test.*`; Vitest globals via env or `ignorePatterns` as needed). Lint must stay green (`--max-warnings 0`).
- `.github/workflows/ci.yml` — add `- run: npm run test:run` to the **frontend** job (no new job).

---

## Test suites (real assertions)

### 1. `src/api/axios.test.ts`
Exercises the real axios instance via MSW.
- `apiGet/apiPost/apiPut/apiDelete` unwrap the backend envelope `{ data: { data } }` and return the inner payload.
- Request interceptor attaches `Authorization: Bearer <accessToken>` from `localStorage`.
- A `401` on a normal endpoint triggers `POST /auth/refresh`, then **retries the original request** with the new token and resolves.
- **Concurrent 401s dedupe**: two in-flight requests both 401 → only **one** `/auth/refresh` call is made (assert handler hit count); both original requests then succeed.
- Refresh failure: clears `accessToken` from `localStorage` and dispatches the `auth:logout` window event; original promise rejects.
- `/auth/login` and `/auth/register` 401s are **not** retried (surface the real error).

### 2. `src/store/slices/authSlice.test.ts`
Pure reducer + thunk tests (login thunk via MSW).
- `setCredentials` sets user + token + `isAuthenticated`; `clearAuth` resets to logged-out; `updateUser` merges fields.
- `login.pending` sets `isLoading`, clears `error`; `login.fulfilled` stores user/token and flips `isAuthenticated`; `login.rejected` sets `error` and clears `isLoading`.

### 3. `src/store/slices/cartSlice.test.ts`
Pure reducer math via `handleCartUpdate` and the fulfilled cases.
- `fetchCart.fulfilled` / `addToCart.fulfilled` populate items and compute totals + item count correctly.
- `updateCartItem.fulfilled` / `removeFromCart.fulfilled` recompute totals.
- `clearCart.fulfilled` empties items and zeroes totals/count.

### 4. `src/pages/Checkout.tsx` — payment-method selection (`Checkout.test.tsx`)
Render `Checkout` with a populated cart (preloaded store + MSW for cart/carrier reads), advance to the payment step.
- The available payment options render as radios (`name="payment"`); **COD is the default** (`paymentMethod` initial `'cod'`).
- Selecting PayPal (or GCash) checks that radio, and the review step reflects the chosen method label.

### 5. `src/pages/admin/Orders.tsx` — refund dialog (`AdminOrders.test.tsx`)
Render admin Orders with a refundable order (`paymentStatus` in `['paid','partially_refunded']`), open the refund dialog.
- Blank amount → `confirmRefund` POSTs to `/orders/:id/refund` **without** `amount` (full remaining refund); assert request body.
- Invalid amount (`0` or non-numeric) → shows the validation error and makes **no** API call.
- Valid amount + reason → POSTs `{ amount, reason }`; success path closes the dialog.
- `remaining` shown = `totalPrice − paymentResult.refundedAmount`.

> A trivial pure unit (`src/utils/fuzzy.test.ts` for `findClosestMatch`) MAY be added as a cheap freebie but is not required for "done".

---

## CI wiring

The frontend job in `.github/workflows/ci.yml` becomes: `npm ci` → `npm run lint` → `npm run test:run` → `npm run build`. Because `main` now has branch protection requiring the `Frontend (Lint + Build)` check, the new tests automatically gate merges. (The job display name stays `Frontend (Lint + Build)` to avoid breaking the existing required-check context; the runbook note: it now also runs unit tests.)

---

## Non-goals (per Phase 3 spec)

- No coverage thresholds or coverage chasing.
- No broad smoke/snapshot tests across the whole component tree (3C Playwright covers end-to-end flows).
- No backend test changes; no API contract or schema changes.
- No E2E/browser automation (that is 3C).

---

## Done when

- `npm run test:run` passes locally and in CI with a meaningful suite (the five suites above), and `npm run lint` + `npm run build` stay green.
- Each critical module has real behavioral assertions (not render-only smoke).
- The frontend CI job runs the tests and gates `main`.

---

## Risks / watch-items

- **Testing axios's own interceptors:** MSW intercepts at the network boundary, so the real interceptor chain runs — but `import.meta.env.VITE_API_URL` must be defined in the test env (stub in setup) and the refresh call uses an absolute URL via `axios.post(...)` (handler must match it).
- **Heavy page renders (Checkout/admin Orders):** these pull store + React Query + router; the `renderWithProviders` helper plus targeted MSW handlers keep them deterministic. If a full-page render proves brittle, narrow to the smallest sub-tree that still asserts the behavior — keep the behavioral assertion, drop incidental UI.
- **ESLint `--max-warnings 0`:** test files and MSW handlers must satisfy the existing config; adjust `.eslintrc.cjs` test-file handling rather than weakening global rules.
- **jsdom gaps:** components using `matchMedia`/IntersectionObserver/framer-motion may need small stubs in setup; add them per-symptom, not preemptively.
