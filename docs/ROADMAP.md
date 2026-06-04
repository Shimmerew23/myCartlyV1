# CartLy — Production-Readiness Roadmap

The program-level tracker for taking CartLy from its current state to a
production-ready, real-money launch. Each phase is its own spec → plan → build
cycle. This file is the living index; update statuses as work lands.

- **Status legend:** ⬜ Not started · 🟨 In progress · ✅ Done
- **Goal:** real paying users / live launch (strictest reliability + security bar)
- **Last updated:** 2026-06-05

Related docs:
- Requirements baseline: [../REQUIREMENTS.md](../REQUIREMENTS.md)
- Decision records: [adr/](adr/)
- Detailed specs: [superpowers/specs/](superpowers/specs/)

---

## Phase sequencing

Phases are ordered so each unblocks the next: the database underpins
everything, payments depend on the new transactional DB, hardening wraps a
stable feature set, and new features build on the production-ready foundation.

| # | Phase | Status | Blocks | Spec |
|---|---|---|---|---|
| 1 | Database re-platform: MongoDB → PostgreSQL + Prisma | ✅ | Phases 2–4 | [postgres-migration](superpowers/specs/2026-06-01-postgres-migration-design.md) |
| 2 | Payment re-platform: remove Stripe, add PayPal + GCash | ✅ | Phase 3 | _tbd at phase start_ |
| 3 | Operational hardening (tests, CI/CD, monitoring, backups) | 🟨 | Phase 4 | [phase3-operational-hardening](superpowers/specs/2026-06-04-phase3-operational-hardening-design.md) |
| 4 | New features (real-time, search/recs, multi-currency/i18n) | ⬜ | — | _tbd at phase start_ |

---

## Phase 1 — Database re-platform ✅ complete

**Status:** ✅ Done (sub-plans 1A–1F) — app runs on PostgreSQL/Prisma alone; Mongoose fully removed.

Swap the data layer from MongoDB/Mongoose to PostgreSQL/Prisma **with zero change
to the API contract** — identical routes, `ApiResponse` envelope, and JSON shapes,
so the frontend is untouched. Greenfield: clean schema design + rewritten seeder,
no live-data ETL.

### Sub-plan progress
- [x] **1A — Foundation:** Postgres in compose (host 5433), Prisma schema (19 tables) + initial migration, `connectPrisma` wired into boot, Jest+Supertest harness.
- [x] **1B — Auth & Users:** `authenticate`/`optionalAuth`, full `authController`, Passport (Google/JWT), and user profile/address/seller-profile endpoints on Prisma. `userService` replaces Mongoose User instance methods. 45 backend tests green; frozen envelope verified. *(Wishlist population & seller-store deferred to 1C; rate limiters skip under `NODE_ENV=test`.)*
- [x] **1C — Products & Categories + search:** `productController` (list/get/CRUD/featured/related/my/seller-stats/wishlist), category CRUD, wishlist list + seller storefront on Prisma; `tsvector` + GIN + `pg_trgm` full-text search; `getMe` wishlist population restored. 75 backend tests green.
- [x] **1D — Cart & Orders + coupons:** cart controller + `cartService`, order controller + `orderService` (placement wrapped in `prisma.$transaction`: validate stock → create order/items/initial status event → decrement stock → clear cart, atomically), coupon CRUD, all on Prisma. Added `Order.returnReason`. 117 backend tests green.
- [x] **1E — Reviews, carriers, warehouse, feedback, admin, audit:** reviews (+`reviewService` rating recompute), feedback, carriers, warehouse (CRUD + scan/check-in), and full admin controller (dashboard/users/orders/products/audit) ported to Prisma. Completed `Carrier`/`Warehouse` models (migration). Audit-log 90-day TTL → `jobs/auditCleanup.js` (daily, wired into boot). 156 backend tests green.
- [x] **1F — Seeder rewrite & Mongoose removal:** `utils/seeder.js` rewritten on Prisma (8 categories, 5 documented accounts hashed, 8 sample products). Removed all Mongoose code (`models/*`, `config/db.js`, `connectDB`, dead requires), the `express-mongo-sanitize` layer, and the `mongoose`/`mongodb`/`express-mongo-sanitize`/`passport-facebook` deps + the `mongo` compose service. `errorHandler` + `auditLog` now Prisma-native. App boots on Postgres alone. 156 backend tests green.

### Workstreams
- [x] Stand up Postgres (docker-compose service; removed `mongo`), `DATABASE_URL` env
- [x] Prisma schema: model all entities with relations, native enums, indexes
- [x] Break embedded docs into related tables (addresses, sellerProfile, product images/variants, order items, status events)
- [x] Replace Mongoose queries with Prisma client across the barrel controllers
- [x] Full-text search: Mongo text index → Postgres `tsvector` (GIN) + `pg_trgm` fuzzy/autocomplete
- [x] Audit-log 90-day TTL → scheduled cleanup job (`jobs/auditCleanup.js`, daily `setInterval`, started in `server.js`)
- [x] Order/payment consistency → Prisma transactions (ACID) *(order placement, status changes, returns, webhook updates)*
- [x] Rewrite seeder against Prisma
- [x] Wire `prisma migrate` into startup + CI *(tests run `migrate deploy`; CI gating lands in Phase 3)*
- [x] Focused integration test per route group asserting unchanged envelope/shape *(`backend/tests/envelope.test.js` + `tests/helpers/envelope.js` — one representative endpoint per router asserts the `ApiResponse` envelope, paginated variant, error envelope, and `_id`/nested aliases)*

### Definition of done
- All existing API routes return the same envelope and JSON shapes as before.
- Seeder produces the documented test accounts.
- App boots against Postgres; MongoDB fully removed from code and compose.
- Unchanged: bcrypt hashing, crypto tokens, JWT, Redis sessions/blacklist, Cloudinary.

---

## Phase 2 — Payment re-platform ✅ complete

**Status:** ✅ Done (sub-plans 2A–2D) · **Depends on:** Phase 1

Remove Stripe; add **PayPal** (Standard Checkout, Orders v2) + **GCash via PayMongo**; add refunds.
Methods offered after Phase 2: PayPal, GCash, COD (Stripe + bank transfer dropped).

### Sub-plan progress
- [x] **2A — Remove Stripe + payment-service scaffold:** stripped the Stripe SDK/webhook/raw-body route + `@stripe/*` client + `stripeAccountId` + CSP entries; `PaymentMethod` enum now `paypal|gcash|cod` (migration); added provider-agnostic `services/paymentService.js` seam (COD live; PayPal/GCash guarded). `createOrder` returns `{ order, payment }`. Frontend checkout → COD; Stripe copy/badges removed. 161 backend tests green; COD order verified end-to-end. *(Note: frontend `npm run lint` has no ESLint config — pre-existing; and `seller/Profile.tsx`/`EditProduct.tsx` have pre-existing type drift, unrelated to payments.)*
- [x] **2B — PayPal Standard Checkout:** `config/paypal.js` (Orders v2 REST: token/create/capture/refund/verify); `paymentService` PayPal branch + transactional idempotent `markOrderPaid`; capture endpoint (`POST /orders/:id/capture`) + webhook (`POST /orders/webhook/paypal`, raw body). Redirect (approve-URL) flow — consistent with GCash. Frontend: gated PayPal option + `PaypalReturn` capture page. 173 backend tests green; env-gated (graceful 400 when unconfigured); live needs sandbox keys. *(Uses redirect flow, not JS Smart Buttons — see plan 2B.)*
- [x] **2C — GCash via PayMongo:** `config/paymongo.js` (Sources REST: create source/payment, refund, HMAC webhook verify); `paymentService` GCash branch (redirect/approve-URL flow, PHP) + PayMongo webhook (`source.chargeable` → create payment → `markOrderPaid`; `payment.paid` idempotent backstop); webhook endpoint (`POST /orders/webhook/paymongo`, raw body). Frontend: gated GCash option + `GcashReturn` polling page. 180 backend tests green; env-gated (graceful 400 when unconfigured); live needs PayMongo keys.
- [x] **2D — Refunds:** `paymentService.refundPayment` (provider dispatch — PayPal `refundCapture` / PayMongo `refundPayment` / COD manual; full + partial; transactional state); admin endpoint `POST /api/orders/:id/refund` (`requireAdmin` + `auditLog('REFUND_ORDER')`) + `schemas.refund`. Reflects `paymentStatus` `refunded`/`partially_refunded`, records `refundedAmount` + `refunds[]` in `paymentResult` (no migration — enum already had both values); full refund also sets order `status` refunded. Frontend: admin Orders refund dialog (full/partial + reason). 189 backend tests green (5 unit guards + 5 integration); env-gated (graceful 400 when unconfigured).

### Workstreams
- [x] Remove Stripe: server SDK, client (`@stripe/*`), and the raw-body webhook route *(2A)*
- [x] Integrate PayPal Standard Checkout (create/capture + webhook)
- [x] Integrate GCash via PayMongo (checkout + webhook)
- [x] Refund flows (full + partial), reflected in order `paymentStatus` *(2D)*
- [x] Order + payment writes wrapped in DB transactions *(carried over from Phase 1)*
- [x] Update `paymentMethod` enum (`paypal|gcash|cod`) and remove Stripe-specific fields (`stripeAccountId`, etc.) *(2A)*

> Currency note: catalog defaults to USD but PayMongo/GCash settle in PHP — flagged for launch; full multi-currency is Phase 4.

### Definition of done
- Checkout completes end-to-end on PayPal and GCash in test mode.
- Refunds update order state correctly and are auditable.
- No Stripe code or dependencies remain.

---

## Phase 3 — Operational hardening ✅ complete (real-money bar)

**Status:** ✅ Complete (3A–3F) · **Depends on:** Phase 2 · **Spec:** [phase3-operational-hardening](superpowers/specs/2026-06-04-phase3-operational-hardening-design.md)

Launch context: **real paying users** (full hardening bar). Infra: **paid managed** (recommended Neon Postgres + Upstash Redis). Decomposed safety-net-first into sub-plans 3A–3F.

### Sub-plan progress
- [x] **3A — CI pipeline + green gates:** GitHub Actions (`.github/workflows/ci.yml`) — backend job (Postgres 16 service → `prisma migrate deploy` via `tests/setup.js` → Jest, 189 tests) + frontend job (ESLint → `vite build`). Added the missing `frontend/.eslintrc.cjs` (ESLint 8 legacy) and cleaned 29 unused symbols; fixed the two pre-existing TS errors (`SellerProfile` fields, `EditProduct` prop). Triggers on `develop` push / PRs into `main`. *(Live Actions run confirmed green after fixing a `JWT_SECRET` env-name mismatch; repo made public and `main` branch protection enabled requiring both checks.)*
- [x] **3B — Frontend unit/component tests:** Vitest + React Testing Library + MSW (`frontend/src/**/*.test.ts(x)`, harness in `src/test/` + `vitest.setup.ts`). 26 tests: axios envelope unwrap + 401 refresh-queue dedupe/logout/auth-exclusion, auth slice + login thunk, cart math + coupon preservation + selection pruning, checkout payment-method selection, admin refund dialog (validation, full/partial payload, dialog close). Wired `npm run test:run` into the frontend CI job. Spec: [phase3b](superpowers/specs/2026-06-04-phase3b-frontend-tests-design.md)
- [x] **3C — Playwright E2E:** Chromium suite (`frontend/e2e/`) against `vite preview` + a seeded real backend. Buyer COD journey, admin full-refund (on a seeded paid order via `backend/utils/seedE2E.js`), seller dashboard smoke. Runs as a separate CI `e2e` job (`needs:` backend+frontend). Spec: [phase3c](superpowers/specs/2026-06-04-phase3c-playwright-e2e-design.md)
- [x] **3D — Observability:** Env-gated Sentry (`@sentry/node` + `@sentry/react`, no-op without a DSN; backend captures 5xx in `errorHandler`, frontend lean errors-only + `<Sentry.ErrorBoundary>`) and real probes `GET /health/live` / `GET /health/ready` (Postgres required → 503 when down; Redis optional → `degraded`). Spec: [phase3d](superpowers/specs/2026-06-04-phase3d-observability-design.md)
- [x] **3E — Backups, DR & secrets:** Neon PITR as primary DR; repo `pg_dump`/`pg_restore`/verify scripts (`backend/scripts/`) exercised by a CI `restore-drill` job (seed → backup → restore → verify counts); a weekly **encrypted** off-Neon dump workflow (`.github/workflows/db-backup.yml`, gpg AES256, 30-day artifact — required because the repo is public); `render.yaml` secrets declared `sync: false`; gitleaks pre-commit hook; and two runbooks (`docs/runbooks/disaster-recovery.md`, `secrets-and-config.md`). Spec: [phase3e](superpowers/specs/2026-06-04-phase3e-backups-dr-secrets-design.md)
- [x] **3F — Security pass + deployment runbook:** removed 8 dead/deprecated deps (`csurf`, `csrf`, `xss-clean`, `celebrate`, `express-validator`, `apicache`, `etag`, npm `crypto` shim) + dead `handleValidationErrors`; documented CSRF posture (bearer-token API → no CSRF middleware; dropped vestigial `X-CSRF-Token` from CORS) and layered XSS defense (React encoding + Joi + Helmet CSP); added a production fail-fast secret guard (`utils/validateEnv.js`) and removed the weak `SESSION_SECRET` default; `npm audit` remediated non-breaking — backend `nodemailer` 6→8 (SMTP command-injection fix), 9→1 advisory (residual `uuid`), frontend removed unused `swiper` (critical prototype-pollution) → 17→10 (rest dev/build-chain); stripped plaintext default passwords from README; cold-start/rollback runbook `docs/runbooks/deployment.md`. Spec: [phase3f](superpowers/specs/2026-06-05-phase3f-security-pass-design.md)

### Workstreams
- [x] Backend test suite: Jest + Supertest (controllers, routes, auth, RBAC) *(28 suites / 209 tests covering every route group + RBAC; gated by CI in 3A)*
- [x] Frontend test suite: Vitest + React Testing Library; Playwright E2E for critical flows *(3B done; 3C E2E done)*
- [x] CI/CD: GitHub Actions — lint → typecheck → test → build *(3A — backend Jest on a Postgres service; frontend ESLint + build; gates PRs into `main`)*
- [x] Error tracking: Sentry (backend + frontend) *(3D — env-gated/graceful)*
- [x] Health-check endpoints (liveness/readiness) for DB + Redis *(3D — `/health/live` + `/health/ready`)*
- [x] Database backups + documented disaster-recovery procedure *(3E — Neon PITR + weekly encrypted dump; `docs/runbooks/disaster-recovery.md`; CI restore-drill)*
- [x] Secrets management (no secrets in repo; documented env/secret strategy) *(3E — `render.yaml` sync:false; gitleaks hook; `docs/runbooks/secrets-and-config.md`)*
- [x] Security pass over existing Helmet / rate-limit / RBAC / CORS layer *(3F — dead-dep prune, CSRF/XSS posture documented, prod secret guard, npm audit remediated)*
- [x] Deployment target chosen + documented runbook *(3F — Render/Vercel/Neon/Upstash; `docs/runbooks/deployment.md`)*

### Definition of done
- CI is green and gates merges to `main`.
- Critical buyer/seller/admin flows covered by E2E tests.
- Errors surface in Sentry; health checks pass; a backup can be restored.

---

## Phase 4 — New features 🟦

**Status:** ⬜ Not started · **Depends on:** Phase 3 · Items are independent and reorderable.

### Workstreams
- [ ] Real-time order updates (WebSocket/SSE) + web push notifications
- [ ] Dedicated search (Algolia or Postgres-native) + product recommendations + abandoned-cart recovery
- [ ] Multi-currency display + i18n (multi-language) + localized tax/VAT

### Definition of done
- Per-feature acceptance criteria defined in that feature's spec at phase start.

---

## Deferred / out of scope (for now)

Tracked in [../REQUIREMENTS.md](../REQUIREMENTS.md) §5 but not in this program:
CMS, blog, multi-vendor payout system, PWA / React Native mobile app. Revisit
after launch.
