# CartLy — Production-Readiness Roadmap

The program-level tracker for taking CartLy from its current state to a
production-ready, real-money launch. Each phase is its own spec → plan → build
cycle. This file is the living index; update statuses as work lands.

- **Status legend:** ⬜ Not started · 🟨 In progress · ✅ Done
- **Goal:** real paying users / live launch (strictest reliability + security bar)
- **Last updated:** 2026-06-01

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
| 1 | Database re-platform: MongoDB → PostgreSQL + Prisma | ⬜ | Phases 2–4 | [postgres-migration](superpowers/specs/2026-06-01-postgres-migration-design.md) |
| 2 | Payment re-platform: remove Stripe, add PayPal + GCash | ⬜ | Phase 3 | _tbd at phase start_ |
| 3 | Operational hardening (tests, CI/CD, monitoring, backups) | ⬜ | Phase 4 | _tbd at phase start_ |
| 4 | New features (real-time, search/recs, multi-currency/i18n) | ⬜ | — | _tbd at phase start_ |

---

## Phase 1 — Database re-platform 🟥 foundational

**Status:** ⬜ Not started

Swap the data layer from MongoDB/Mongoose to PostgreSQL/Prisma **with zero change
to the API contract** — identical routes, `ApiResponse` envelope, and JSON shapes,
so the frontend is untouched. Greenfield: clean schema design + rewritten seeder,
no live-data ETL.

### Workstreams
- [ ] Stand up Postgres (docker-compose service; remove `mongo`), `DATABASE_URL` env
- [ ] Prisma schema: model all entities with relations, native enums, indexes
- [ ] Break embedded docs into related tables (addresses, sellerProfile, product images/variants, order items, status events)
- [ ] Replace Mongoose queries with Prisma client across the barrel controllers
- [ ] Full-text search: Mongo text index → Postgres `tsvector` (GIN) + `pg_trgm` fuzzy/autocomplete
- [ ] Audit-log 90-day TTL → scheduled cleanup job (`pg_cron` or node-cron)
- [ ] Order/payment consistency → Prisma transactions (ACID)
- [ ] Rewrite seeder against Prisma
- [ ] Wire `prisma migrate` into startup + CI
- [ ] Focused integration test per route group asserting unchanged envelope/shape

### Definition of done
- All existing API routes return the same envelope and JSON shapes as before.
- Seeder produces the documented test accounts.
- App boots against Postgres; MongoDB fully removed from code and compose.
- Unchanged: bcrypt hashing, crypto tokens, JWT, Redis sessions/blacklist, Cloudinary.

---

## Phase 2 — Payment re-platform 🟥

**Status:** ⬜ Not started · **Depends on:** Phase 1

Remove Stripe; add PayPal + GCash; add refunds.

### Workstreams
- [ ] Remove Stripe: server SDK, client (`@stripe/*`), and the raw-body webhook route
- [ ] Integrate PayPal (checkout + webhooks)
- [ ] Integrate GCash (checkout + webhooks)
- [ ] Refund flows (full + partial), reflected in order `paymentStatus`
- [ ] Order + payment writes wrapped in DB transactions
- [ ] Update `paymentMethod` enum and remove Stripe-specific fields (`stripeAccountId`, etc.)

### Definition of done
- Checkout completes end-to-end on PayPal and GCash in test mode.
- Refunds update order state correctly and are auditable.
- No Stripe code or dependencies remain.

---

## Phase 3 — Operational hardening 🟩 (real-money bar)

**Status:** ⬜ Not started · **Depends on:** Phase 2

### Workstreams
- [ ] Backend test suite: Jest + Supertest (controllers, routes, auth, RBAC)
- [ ] Frontend test suite: Vitest + React Testing Library; Playwright E2E for critical flows
- [ ] CI/CD: GitHub Actions — lint → typecheck → test → build → `prisma migrate`
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
