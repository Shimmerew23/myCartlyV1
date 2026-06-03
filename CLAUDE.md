# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CartLy — a full-stack eCommerce platform: an **Express + PostgreSQL/Prisma** API (`backend/`) and a **React + TypeScript + Vite** SPA (`frontend/`). Two independent npm packages; there is no root package.json or monorepo tooling — each directory is managed separately. The backend has a **Jest + Supertest** integration suite (`backend/tests/`); the frontend has no test suite yet.

> The data layer was migrated from MongoDB/Mongoose to PostgreSQL/Prisma in Phase 1 (see `docs/ROADMAP.md` and `docs/superpowers/plans/`). Mongoose is fully removed. Some older docs/README sections may still say "MERN/MongoDB" — the code is the source of truth.

## Commands

Run these from inside `backend/` or `frontend/` respectively.

**Backend** (`cd backend`)
- `npm run dev` — start API with nodemon on `PORT` (default 5000)
- `npm start` — start API with plain node (production)
- `npm test` — Jest + Supertest integration suite (`cross-env NODE_ENV=test jest --runInBand`); `tests/setup.js` runs `prisma migrate deploy` against the `.env.test` database first
- `npm run seed` — wipe & reseed PostgreSQL via `utils/seeder.js` (creates the test accounts below)
- `npm run prisma:migrate` — create/apply a dev migration · `npm run prisma:deploy` — apply pending migrations · `npm run prisma:generate` — regenerate the client · `npm run prisma:studio` — DB browser

**Frontend** (`cd frontend`)
- `npm run dev` — Vite dev server on `http://localhost:5173` (`--host` exposes it on the LAN)
- `npm run build` — type-check + production build
- `npm run lint` — ESLint (`--max-warnings 0`; this is the only static-check gate, run it before declaring frontend work done)
- `npm run preview` — serve the built bundle

**Full stack via Docker** (from repo root)
- `docker-compose up --build` — brings up postgres, redis, backend, frontend, nginx (app served at `http://localhost`). Postgres is exposed on host port **5433** → container 5432.
- `docker-compose exec backend node utils/seeder.js` — seed inside the container

**Seeded test accounts** (password format `Role@123456`): `superadmin@CartLy.com`, `admin@CartLy.com`, `seller@CartLy.com`, `user@CartLy.com` — see README "Default Test Accounts" for the full list.

Backend requires `backend/.env` (copy from `backend/.env.example`). It needs `DATABASE_URL` (PostgreSQL), Redis, and Cloudinary credentials. Redis and Cloudinary failures are non-fatal (graceful degradation); a PostgreSQL connection failure aborts startup (it is the system of record). Tests use a separate database via `backend/.env.test` (`DATABASE_URL` → `cartly_test`).

## Architecture

### Backend — consolidated "barrel" modules

The backend deliberately collapses each layer into a single `index.js` re-export, and the bulk of business logic lives in a few large files. **Before adding code, find where the existing equivalent lives** — it is rarely in an obvious per-resource file:

- `middleware/index.js` (~600 lines) — *everything* cross-cutting: `authenticate`, `optionalAuth`, RBAC (`requireRole`, `requireSeller`, `requireAdmin`, `requireSuperAdmin`, `requireWarehouse`, `requireOwnership`), rate limiters, multer `upload` + `processImages` (Sharp→Cloudinary), `validate(schema)` with Joi `schemas`, `cacheMiddleware`, `auditLog`, error handling, perf timing.
- `controllers/index.js` (~900 lines) — most controllers (users, cart, reviews, admin, categories, coupons, feedback). Only `authController`, `productController`, `orderController`, `carrierController`, `warehouseController` are separate files. `controllers/index.js` re-exports everything.
- `routes/index.js` — *all* route definitions and their middleware chains, exported as named routers (`authRouter`, `productRouter`, …) that `server.js` mounts.
- `prisma/schema.prisma` — the single source of truth for the data model (all entities, relations, native enums, indexes). Migrations live in `prisma/migrations/`. The client is created in `config/prisma.js` (`prisma`, `connectPrisma`).
- `services/*.js` — the Prisma data layer that keeps the API contract frozen. Each service owns its queries **and** the serializers that rebuild the exact legacy JSON shapes (`_id`/`id` aliases, nested `rating`, populated `category`/`seller`, virtuals like `discountedPrice`/`inStock`). See `userService`, `productService`, `cartService`, `orderService`, `reviewService`. **When porting/adding an endpoint, go through these services — never return raw Prisma rows.**
- `jobs/auditCleanup.js` — daily deletion of `AuditLog` rows older than 90 days (started from `server.js`; replaces the old Mongo TTL index).

**Route middleware chain pattern** — routes compose middleware in order; mirror this when adding endpoints:
```
router.post('/', authenticate, requireSeller, uploadLimiter,
  upload.array('images', 10),
  processImages({ width, height, quality, folder: 'cartly/products' }),
  validate(schemas.product),
  auditLog('CREATE_PRODUCT', 'Product'),
  controller.createProduct);
```

**Response contract** — controllers return through `utils/ApiResponse.js`: `ApiResponse.success(res, data, msg)`, `.created(...)`, `.paginated(res, data, pagination)`. The JSON shape is always `{ statusCode, success, message, data, timestamp }`. Errors throw `ApiError` (`utils/ApiError.js`); `express-async-errors` lets controllers throw inside async handlers without try/catch, and `errorHandler` in middleware formats them. **Keep this envelope** — the frontend depends on it (see below).

**Images** — uploaded to Cloudinary (not local disk), with UUID-based `public_id`s stored alongside the URL (in the `ProductImage` table) so old assets can be deleted on replace. `processImages` does Sharp resize/WebP before upload. The Docker `uploads/` volume is legacy.

**Stripe webhook** — `/api/orders/webhook` needs the raw body, so `express.raw()` is registered for that path in `server.js` *before* the JSON body parser. Don't move the body-parser ordering.

**Auth model** — JWT access (15m) + refresh (7d) tokens; refresh tokens and a logout blacklist live in Redis. Five roles: `user` / `seller` / `admin` / `superadmin` / `warehouse`. Password hashing, token generation, lockout, and the user serializers live in `services/userService.js` (`config/passport.js` uses Prisma). Google OAuth via Passport; the callback sets cookies and redirects to `/oauth/callback?token=...` on the frontend (it does **not** return JSON). Emails are stored lowercase — the API lowercases on register and on login lookup.

**Order placement** is wrapped in a `prisma.$transaction` (validate stock → create order + items + initial status event → decrement stock → clear cart), so checkout is atomic. Status changes, returns, and the payment webhook are transactional too.

### Frontend — SPA, three concerns kept separate

- **Client state** = Redux Toolkit, four slices only: `auth`, `cart`, `products`, `ui` (`store/index.ts`). Use `useAppDispatch` / `useAppSelector` (typed hooks), not the raw react-redux hooks.
- **Server state** = React Query (TanStack v5) for fetching/caching API data.
- **HTTP** = the single axios instance in `src/api/axios.ts`. Always go through the `apiGet/apiPost/apiPut/apiDelete/apiUpload` helpers — they unwrap the backend's `{ data: { data } }` envelope and return the inner payload directly. The request interceptor attaches the `accessToken` from `localStorage`; the response interceptor auto-refreshes on 401 (with a queue to dedupe concurrent refreshes) and dispatches a `window` `auth:logout` event on failure that `App.tsx` listens for. `/auth/login` and `/auth/register` are intentionally excluded from refresh-retry so their 401s surface real messages.

**Routing & authorization** (`App.tsx`) — role gating is done declaratively by wrapping route groups in `<ProtectedRoute allowedRoles={[...]} />` nested inside layout routes (`MainLayout`, `SellerLayout`, `AdminLayout`, `WarehouseLayout`). Pages live under `pages/{admin,seller,warehouse}/` matching these groups. To add a gated page, place it in the right layout/`ProtectedRoute` block.

**Types** — shared TypeScript interfaces are centralized in `src/types/index.ts`. Forms use React Hook Form + Zod resolvers.

### Cross-cutting

- API base path is `/api/*`; frontend reads it from `VITE_API_URL`. In Docker, nginx (`nginx.conf`) reverse-proxies `/api/` → backend and `/` → frontend SPA, and applies its own rate-limit zones.
- The design system is editorial/luxury: Manrope + Plus Jakarta Sans fonts, navy `#1A237E` primary, sharp 2–8px radii (intentionally not rounded), 8px spacing grid, Framer Motion transitions. Defined in `frontend/src/index.css` + `tailwind.config.js`. Match it for new UI.

When adding a feature that spans the stack, the typical touch set is: model in `prisma/schema.prisma` (+ a migration), queries/serializers in the relevant `services/*.js`, controller (likely in `controllers/index.js`), route + middleware chain in `routes/index.js`, then frontend type in `types/index.ts`, a page under the right layout group, and data access via the axios helpers. Add a `tests/*.test.js` Supertest case asserting the response envelope/shape.
