# Plan 1E — PostgreSQL Migration: Reviews, Admin, Feedback, Carriers, Warehouse, Audit

**Phase:** 1 (Database re-platform) · **Sub-plan:** 1E
**Date:** 2026-06-03
**Depends on:** 1A–1D
**Predecessor:** [1D](2026-06-03-postgres-migration-phase1d-cart-orders-coupons.md)

## Goal

Port the **last** Mongoose-backed controllers to Prisma — reviews, admin
(dashboard/users/orders/products/audit), feedback, carriers, warehouse — and
complete the stub `Carrier`/`Warehouse` Prisma models. Replace the Mongoose
AuditLog TTL with a scheduled cleanup job. **Zero API-contract change.** After
1E, only the seeder + Mongoose removal (1F) remain.

> Working-tree only this session — **no commits** (per user instruction).

## Contract references (frozen)

- **Review** → `{ _id, product (id string), user:{_id,name,avatar}, rating, title,
  body, images, isVerifiedPurchase, helpfulVotes, sellerReply?:{body,repliedAt},
  createdAt }`. Prisma stores `sellerReplyBody`/`sellerRepliedAt` → rebuild
  `sellerReply`. Creating/updating a review recomputes the product's
  `rating.{average,count,distribution}`.
- **Carrier** → `{ _id, name, code, trackingUrlTemplate?, logoUrl?, isActive,
  sortOrder, createdAt, updatedAt }`.
- **Warehouse** → `{ _id, name, code, address:{street,city,state,country,zipCode},
  manager:User, isActive, notes?, locationLabel, createdAt, updatedAt }`.
  `locationLabel` = `` `${name} — ${city}, ${state}` `` (virtual → serializer).
- **DashboardStats** → `{ users:{total,newThisMonth}, sellers:{total,pendingApprovals},
  products:{total,active}, orders:{total,thisMonth,byStatus:[{_id,count}]},
  revenue:{thisMonth,lastMonth,growth}, recentOrders:Order[], topSellingProducts:Product[],
  categoryStats:[{name,productCount}] }`.
- **Feedback** → `{ _id, user?:{_id,name,email,role,avatar}, guestName?, guestEmail?,
  category, subject, message, rating?, status, adminNote?, createdAt, updatedAt }`.
- Admin user/order/product lists keep the `paginated` envelope; users serialized
  via `userService.toSafeObject`, orders via `orderService.serializeOrder`,
  products via `productService.serializeProduct`.

## Schema changes

1. **Carrier** — replace the stub with: `name`, `code @unique`, `trackingUrlTemplate?`,
   `logoUrl?`, `isActive @default(true)`, `sortOrder @default(0)`, timestamps,
   `@@index([isActive, sortOrder])`.
2. **Warehouse** — extend the stub: `name`, `code @unique`, `address Json`,
   `isActive @default(true)`, `notes?` (keep existing `managerId?`/`manager`/timestamps).
3. New migration `carrier_warehouse_models` (hand-strip Prisma's spurious
   `searchVector`/trgm statements as in 1C/1D). Apply to dev; test DB gets it via
   `migrate deploy` in `tests/setup.js`.

## Tasks (TDD: red → green)

1. **Schema + migration** (Carrier/Warehouse) + `prisma generate`.

2. **`services/reviewService.js`** (unit tests): `serializeReview` (rebuild
   `user` ref + `sellerReply`), `recomputeProductRating(productId, client)`
   (aggregate approved reviews → set `ratingAverage/Count/ratingDistribution`).

3. **Port reviews** in `controllers/index.js` (integration tests `tests/reviews.test.js`):
   `getProductReviews` (filter approved, rating filter, sort map, paginate, user
   populate), `createReview` (dupe guard, verified-purchase via delivered order,
   recompute rating), `updateReview` (owner), `deleteReview` (owner/admin,
   recompute), `voteHelpful` (increment).

4. **Port feedback** (integration tests `tests/feedback.test.js`): `submitFeedback`
   (guest 300-char cap; optional auth), `getFeedbacks`, `updateFeedbackStatus`
   + `serializeFeedback`.

5. **Port carriers** `controllers/carrierController.js` → Prisma (tests
   `tests/carriers.test.js`): getActive/getAll (sort sortOrder,name), create
   (code lowercase, conflict), update, delete + `serializeCarrier`.

6. **Port warehouse** `controllers/warehouseController.js` → Prisma (tests
   `tests/warehouse.test.js`): createWarehouse (hash temp password via
   `userService.hashPassword`, create user+warehouse, email best-effort),
   getWarehouses, updateWarehouse (toggle manager isActive), deleteWarehouse
   (delete warehouse then user — FK order), scanOrder (by orderNumber/uuid),
   checkInParcel (actions → status transitions + statusHistory event with
   `warehouseName`) + `serializeWarehouse` (with `locationLabel`).

7. **Port admin** in `controllers/index.js` (tests `tests/admin.test.js`):
   `getDashboardStats` (Prisma counts/`groupBy`/`aggregate`; cache kept),
   `getAllUsers` (filters/search/sort/paginate, `toSafeObject`),
   `updateUser` (allowed fields; role only for superadmin),
   `deleteUser` (soft: isActive=false,isBanned=true; block superadmin),
   `approveSeller` (sellerProfile.isApproved + email),
   `getAllOrders`, `getAllProducts`, `getAuditLogs`, `adminUpdateProduct`.

8. **Audit cleanup job** `jobs/auditCleanup.js`: delete `AuditLog` older than
   90 days; schedule daily. Prefer `node-cron` if already a dep, else a guarded
   `setInterval` started in `server.js` (skip under `NODE_ENV=test`). Unit-test
   the delete query (`deleteOldAuditLogs(client)`).

9. **Wire + verify:** mount `reviewRouter`, `feedbackRouter`, `carrierRouter`,
   `warehouseRouter` in `tests/helpers/buildApp.js`; full Jest suite green; boot
   + smoke. Update ROADMAP (1E ✅). **Do not commit.**

## Interim coupling resolved
- `orderController` + `warehouseController` Carrier reads move onto Prisma here
  (the model is completed in task 1).

## Definition of done
- Reviews, admin, feedback, carriers, warehouse all on Prisma; unchanged
  envelope/shapes. Audit cleanup scheduled. Full suite green; server boots.
  Only 1F (seeder + Mongoose removal) remains.
