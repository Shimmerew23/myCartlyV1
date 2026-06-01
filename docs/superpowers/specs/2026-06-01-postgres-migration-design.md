# Phase 1 Design — MongoDB → PostgreSQL + Prisma Migration

- **Date:** 2026-06-01
- **Phase:** 1 of the [production-readiness roadmap](../../ROADMAP.md)
- **Related ADRs:** [0001 Postgres](../../adr/0001-postgres-over-mongodb.md), [0002 Prisma](../../adr/0002-prisma-orm.md)
- **Status:** Design approved; ready for implementation planning

## Goal

Replace the backend data layer (MongoDB 7 + Mongoose 8) with PostgreSQL + Prisma
**without changing the API contract**. Same routes, same `ApiResponse` envelope
(`{ statusCode, success, message, data, timestamp }`), same JSON shapes — so the
React frontend requires no changes.

Greenfield migration: there is no production data to preserve. We design a clean
relational schema and rewrite the seeder. No live-data ETL.

## Non-goals

- No frontend changes (the contract is frozen).
- No payment changes (Phase 2).
- No new tests beyond focused per-route integration checks that assert the
  unchanged contract (the full suite is Phase 3).
- No changes to auth crypto, JWT, Redis usage, or Cloudinary.

## Architecture

### What stays the same
- Route definitions and middleware chains in `routes/index.js`.
- The `ApiResponse` / `ApiError` envelope and `errorHandler`.
- `authenticate`, RBAC, rate limiters, `processImages`, `cacheMiddleware`, `auditLog`.
- bcrypt password hashing, crypto reset/verify tokens, JWT sign/verify.
- Redis (refresh tokens, logout blacklist, response cache, rate limits).
- Cloudinary uploads and UUID public-id namespacing.

### What changes
- `config/db.js`: connect a Prisma client instead of Mongoose.
- `models/`: replaced by a Prisma schema (`prisma/schema.prisma`) + generated client.
- Controllers (`controllers/index.js` and the per-resource controllers):
  Mongoose query calls (`.find`, `.findById`, `.create`, `.aggregate`, populate)
  replaced with equivalent Prisma client calls.
- `utils/seeder.js`: rewritten against Prisma.
- `docker-compose.yml`: `mongo` service replaced with `postgres`; `DATABASE_URL` added.
- Mongoose dependency removed from `backend/package.json`; Prisma added.

## Data model (relational)

Embedded subdocuments become related tables; ObjectId refs become `uuid` foreign
keys; Mongo enums become native Postgres enums.

| Source (Mongo) | Target tables (Postgres / Prisma) | Notes |
|---|---|---|
| `User` | `User` | uuid PK; `role` enum; status/security/login fields as columns |
| `User.addresses[]` | `Address` (FK → User, 1‑N) | `isDefault` boolean |
| `User.sellerProfile` | `SellerProfile` (FK → User, 1‑1) | drop `stripeAccountId` in Phase 2; bank fields encrypted at app level |
| `User.oauth` | columns `googleId` (drop `facebookId` — Facebook removed) | |
| `Product` | `Product` | uuid PK; `slug` unique; `currency`; rating avg/count columns |
| `Product.images[]` | `ProductImage` (FK → Product, 1‑N) | `url`, `publicId`, `alt`, `isPrimary` |
| `Product.variants[]` | `ProductVariant` (FK → Product, 1‑N) | name/value/stock/price/sku |
| `Product.tags[]` | `text[]` column (or `Tag` join later) | start with array + GIN index |
| `Product.rating.distribution` | JSONB column | low-traffic display data |
| `Category` | `Category` | self-FK for parent if hierarchical |
| `Coupon` | `Coupon` | enum for discount type |
| `Carrier` | `Carrier` | |
| `Warehouse` | `Warehouse` (FK → User manager) | |
| `Order` | `Order` | uuid PK; `orderNumber` unique; pricing columns; `status`/`paymentStatus`/`paymentMethod` enums; shipping address + tracking as columns/JSON |
| `Order.items[]` | `OrderItem` (FK → Order, 1‑N) | product/seller snapshot fields denormalized (price/name at purchase time) |
| `Order.statusHistory[]` | `OrderStatusEvent` (FK → Order, 1‑N) | `warehouseName`, `updatedBy` FK |
| `Review` | `Review` (FK → Product, User) | |
| `Feedback` | `Feedback` | |
| `Cart` / cart items | `Cart` (FK → User), `CartItem` (FK → Cart) | |
| `AuditLog` | `AuditLog` | retention via scheduled cleanup, not TTL |

### Enums (native Postgres)
- `Role`: user, seller, admin, superadmin, warehouse
- `OrderStatus`: pending, confirmed, processing, shipped, out_for_delivery, delivered, cancelled, return_requested, returned, refunded
- `PaymentStatus`: pending, paid, failed, refunded, partially_refunded
- `PaymentMethod`: stripe, paypal, cod, bank_transfer — **Phase 1 keeps `stripe`** to preserve the frozen contract; Phase 2 removes `stripe` and adds `gcash`
- `Gender`, `CouponDiscountType` as needed

## Tricky areas and resolutions

### Full-text search
- Replace MongoDB text index with a Postgres `tsvector` (generated/maintained
  column on `Product` over name/description/tags) plus a GIN index.
- Use `pg_trgm` for fuzzy matching and autocomplete.
- Implemented via Prisma raw SQL (`$queryRaw`) where the query builder can't
  express it; the controller's public behavior (ranked results + autocomplete)
  is preserved.

### Audit-log retention (was Mongo TTL, 90 days)
- A scheduled job deletes `AuditLog` rows older than 90 days.
- Prefer `pg_cron` if the deployment Postgres supports it; otherwise a `node-cron`
  task in the backend process. Decision deferred to implementation per hosting.

### Transactions
- Order placement (create order + items + decrement inventory + apply coupon)
  wrapped in `prisma.$transaction` for atomicity — the ACID win from ADR 0001.

### ID format
- `uuid` primary keys (`@default(uuid())`). The frontend treats ids as opaque
  strings, so switching from ObjectId hex to uuid is contract-compatible.

### Aggregations / dashboards
- Mongo `$aggregate` pipelines (seller stats, admin dashboard, revenue) become
  Prisma `groupBy`/`aggregate` or raw SQL where richer grouping is needed.

## Infrastructure

- `docker-compose.yml`: add `postgres:16` service with a named volume; remove the
  `mongo` service. Backend depends on it.
- New env var `DATABASE_URL` (in `.env.example`); remove `MONGO_URI`.
- `prisma migrate deploy` runs on container start / in CI; `prisma generate`
  during build.
- Redis service unchanged.

## Migration sequence (high level)

1. Add Prisma + Postgres scaffolding; define `schema.prisma` for all entities.
2. Generate initial migration; bring up Postgres in compose.
3. Port controllers resource-by-resource (auth → users → products → cart →
   orders → reviews → admin → carriers → warehouse → feedback), each behind a
   focused integration test asserting the unchanged response envelope/shape.
4. Re-implement full-text search and audit-log cleanup.
5. Rewrite the seeder; verify seeded test accounts.
6. Remove Mongoose and Mongo from code, deps, and compose.

## Verification / definition of done

- Every existing route returns the same envelope and JSON shape as before.
- Seeder produces the documented test accounts (`Role@123456`).
- App boots and serves the SPA against Postgres; no Mongo references remain.
- `npm run lint` (frontend) and backend start are clean.
- Unchanged subsystems (auth crypto, JWT, Redis, Cloudinary) verified working.

## Risks

- **Aggregation parity:** complex dashboard pipelines are the most error-prone to
  port — covered by integration tests on those endpoints.
- **Search ranking differences:** Postgres FTS ranks differently than Mongo;
  acceptable as long as relevant results + autocomplete still return.
- **Hidden Mongo-isms:** `select: false` fields, sparse unique indexes, and
  populate chains must each be mapped deliberately (noted per table above).
