# Plan 1F — PostgreSQL Migration: Seeder Rewrite & Mongoose Removal

**Phase:** 1 (Database re-platform) · **Sub-plan:** 1F (final)
**Date:** 2026-06-03
**Depends on:** 1A–1E
**Predecessor:** [1E](2026-06-03-postgres-migration-phase1e-reviews-admin-warehouse.md)

## Goal

Finish Phase 1: rewrite the seeder on Prisma (producing the documented test
accounts) and **remove MongoDB/Mongoose entirely** — code, models, deps, and the
`mongo` compose service — so the app runs on PostgreSQL alone. Zero API-contract
change. Working-tree only — **no commits**.

## Scope (every Mongoose touch point — from the 1F scan)

Code still referencing Mongoose:
- `controllers/index.js` lines 1–4 — dead model requires (no `.find/.create`
  calls remain; verified). → delete the requires.
- `controllers/orderController.js` — `Carrier.findById` in `updateOrderStatus`
  (last Mongoose call). → port to `prisma.carrier.findUnique`; drop the require.
- `middleware/index.js` — dead `User` require (line 52 uses a local var); `auditLog`
  still does `AuditLog.create` (Mongoose) though admin reads from Prisma → port to
  `prisma.auditLog.create`; `errorHandler` has Mongoose `CastError`/`11000`/
  `ValidationError` branches → swap for Prisma `P2002`/`P2025`/validation.
- `server.js` — `connectDB` require+call, `📦 MongoDB: Connected` log, and the
  `express-mongo-sanitize` import+`app.use` (Mongo-specific). → remove.
- `config/db.js` — delete.
- `backend/models/*.js` + `models/index.js` — delete (all data is on Prisma).
- `utils/seeder.js` — rewrite on Prisma.

Infra/deps:
- `package.json` — remove `mongoose`, `mongodb`, `express-mongo-sanitize`,
  `passport-facebook` (FB OAuth already removed); update MERN description.
- `docker-compose.yml` — remove the `mongo` service, `mongo_data` volume, the
  backend `depends_on.mongo`, and the backend `MONGODB_URI` env.
- `backend/.env.example` — remove `MONGODB_URI`.

## Tasks

1. **Seeder rewrite** (`utils/seeder.js`): connect via Prisma; wipe in FK-safe
   order; seed 8 categories, users (superadmin/admin/2 sellers/1 user with
   `Role@123456`-style passwords hashed via `userService.hashPassword`), seller
   profiles, and the 8 sample products (split `images`→`ProductImage`, map
   `rating`→`ratingAverage/ratingCount`, `category`→`categoryId`,
   `seller`→`sellerId`). Print the test-account summary. **Verify:** `npm run seed`
   against the dev DB exits 0 and rows exist; then `GET /api/products` returns them.

2. **Remove Mongoose from code:** port the Carrier read + auditLog write +
   errorHandler to Prisma; delete the dead requires, `config/db.js`, and all
   `models/*`; strip `connectDB`/Mongo logs/`mongoSanitize` from `server.js`.

3. **Remove deps + compose:** prune the four packages (run `npm install` to
   reconcile the lockfile); delete the `mongo` service/volume/wiring; clean
   `.env.example`.

4. **Verify:** full Jest suite green; boot the server with **no Mongo running**
   (Postgres + Redis only) and confirm it serves requests; smoke-test. Update
   ROADMAP — mark 1F ✅ and **Phase 1 ✅ complete**. Leave uncommitted.

## Definition of done
- `npm run seed` populates Postgres with the documented accounts + sample data.
- No `mongoose`/`mongodb`/`mongo` references remain in `backend/` code, deps, or
  compose (except historical notes in plan docs).
- App boots and serves against PostgreSQL alone; full suite green; envelope
  unchanged. **Phase 1 done** → ready for Phase 2 (payments).
