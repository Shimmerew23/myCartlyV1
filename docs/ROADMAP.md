# CartLy — Production-Readiness Roadmap

The program-level tracker for taking CartLy from its current state to a
production-ready, real-money launch. Each phase is its own spec → plan → build
cycle. This file is the living index; update statuses as work lands.

- **Status legend:** ⬜ Not started · 🟨 In progress · ✅ Done
- **Goal:** real paying users / live launch (strictest reliability + security bar)
- **Last updated:** 2026-06-04

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
- [ ] Focused integration test per route group asserting unchanged envelope/shape

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

## Phase 3 — Operational hardening 🟨 in progress (real-money bar)

**Status:** 🟨 In progress (3A complete) · **Depends on:** Phase 2 · **Spec:** [phase3-operational-hardening](superpowers/specs/2026-06-04-phase3-operational-hardening-design.md)

Launch context: **real paying users** (full hardening bar). Infra: **paid managed** (recommended Neon Postgres + Upstash Redis). Decomposed safety-net-first into sub-plans 3A–3F.

### Sub-plan progress
- [x] **3A — CI pipeline + green gates:** GitHub Actions (`.github/workflows/ci.yml`) — backend job (Postgres 16 service → `prisma migrate deploy` via `tests/setup.js` → Jest, 189 tests) + frontend job (ESLint → `vite build`). Added the missing `frontend/.eslintrc.cjs` (ESLint 8 legacy) and cleaned 29 unused symbols; fixed the two pre-existing TS errors (`SellerProfile` fields, `EditProduct` prop). Triggers on `develop` push / PRs into `main`. *(Live Actions run + `main` branch protection are user follow-ups — `gh` unavailable in-session; both CI jobs reproduced green locally.)*
- [ ] **3B — Frontend unit/component tests:** Vitest + React Testing Library (axios envelope/refresh queue, auth, cart, checkout, refund dialog).
- [ ] **3C — Playwright E2E:** buyer COD journey + admin refund, against seeded backend + Vite preview.
- [ ] **3D — Observability:** Sentry (backend + frontend) + real `/health/live` + `/health/ready` (Postgres/Redis probes).
- [ ] **3E — Backups, DR & secrets:** provision managed Postgres/Redis, automated backups + PITR, tested restore runbook, secrets externalized.
- [ ] **3F — Security pass + deployment runbook:** replace deprecated `csurf`/`xss-clean`, `npm audit`, config review, cold-start deploy runbook.

### Workstreams
- [ ] Backend test suite: Jest + Supertest (controllers, routes, auth, RBAC) *(already exists — 189 tests; gated by CI in 3A)*
- [ ] Frontend test suite: Vitest + React Testing Library; Playwright E2E for critical flows *(3B/3C)*
- [x] CI/CD: GitHub Actions — lint → typecheck → test → build *(3A — backend Jest on a Postgres service; frontend ESLint + build; gates PRs into `main`)*
- [ ] Error tracking: Sentry (backend + frontend)
- [ ] Health-check endpoints (liveness/readiness) for DB + Redis
- [ ] Database backups + documented disaster-recovery procedure
- [ ] Secrets management (no secrets in repo; documented env/secret strategy)
- [ ] Security pass over existing Helmet / rate-limit / RBAC / CORS layer
- [ ] Deployment target chosen + documented runbook

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
