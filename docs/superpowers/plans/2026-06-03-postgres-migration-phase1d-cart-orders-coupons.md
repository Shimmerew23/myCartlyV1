# Plan 1D — PostgreSQL Migration: Cart, Orders & Coupons

**Phase:** 1 (Database re-platform) · **Sub-plan:** 1D
**Date:** 2026-06-03
**Depends on:** 1A (foundation), 1B (auth/users), 1C (products/categories)
**Predecessors:** [1B](2026-06-02-postgres-migration-phase1b-auth-users.md), [1C](2026-06-02-postgres-migration-phase1c-products-categories-search.md)

## Goal

Port the **cart**, **order**, and **coupon** controllers from Mongoose to
Prisma with **zero API-contract change** — identical routes, `ApiResponse`
envelope, and JSON shapes. Order placement must be **atomic** (Prisma
`$transaction`): validate stock → create order + items + initial status event →
decrement product stock → clear cart, all-or-nothing.

Strictly preserve existing behavior, including quirks:
- `createOrder` accepts `couponCode` but **does not apply any coupon discount**
  (`discountAmount` stays `0`). Keep it that way — do not start applying coupons.
- Tax = 10% of subtotal; shipping = `$0` if subtotal > 100 else `$9.99`.
- `orderNumber` = `CUR-${Date.now()}-${String(count+1).padStart(6,'0')}`.
- Stripe PaymentIntent is created **after** the DB transaction commits (network
  call must not sit inside a DB transaction), then `paymentResult.id` is saved.

## Contract reference (must match exactly)

### Cart — response payload (`getCart`, `addToCart`, `updateCartItem`, `removeFromCart`)
```jsonc
{
  "items": [
    {
      "_id": "<cartItem id>",
      "product": { "_id": "...", "name": "...", "price": 9.99, "images": [...],
                   "slug": "...", "status": "active", "stock": 5,
                   "discountedPrice": 8.99, "rating": {...},
                   "seller": { "_id": "...", "name": "...", "sellerProfile": {...} },
                   "category": { "name": "..." } },
      "quantity": 2,
      "variant": { "name": "Size", "value": "M" },
      "price": 8.99,
      "addedAt": "..."
    }
  ],
  "subtotal": 17.98,      // sum(price * quantity)
  "itemCount": 2,         // sum(quantity)
  "coupon": null | { "code", "discountType", "discountValue", "validUntil" }
}
```
- `getCart`: filters out items whose product is missing or not `active`.
- `clearCart`: returns `data: null`, message `"Cart cleared"`, also clears coupon.
- `applyCoupon`: returns `{ coupon, subtotal }`.

### Order — serialized shape (every order handler)
Rebuild the Mongo doc from relational rows:
- `_id`/`id`, `orderNumber`, `user` (id, or `{_id,name,email}` when populated)
- `items[]`: `{ _id, product, seller, name, image, price, quantity, variant:{name,value} }`
  (from `OrderItem.variantName/variantValue` → nested `variant`)
- `shippingAddress` (JSON), `subtotal`, `shippingCost`, `taxAmount`,
  `discountAmount`, `totalPrice`, `currency`, `coupon` (JSON|null)
- `paymentMethod`, `paymentStatus`, `paymentResult` (JSON), `paidAt`
- `status`, `tracking` (JSON), `preferredCarrier`
- `statusHistory[]`: `{ status, timestamp, note, updatedBy, warehouseName }`
  (from `OrderStatusEvent`; `updatedBy` = `updatedById`)
- `cancelledAt`, `cancellationReason`, `deliveredAt`, `customerNote`,
  `internalNote`, `returnReason`, `createdAt`, `updatedAt`
- `createOrder` returns `{ order, clientSecret }`.

### Coupon — serialized shape (`getCoupons`, `createCoupon`)
- `_id`/`id`, `code`, `description`, `discountType`, `discountValue`,
  `minimumOrderAmount`, `maximumDiscountAmount`, `usageLimit`, `usageCount`,
  `userUsageLimit`, `usedBy[]` (`{ user, usedAt }` from `CouponUsage`),
  `validFrom`, `validUntil`, `isActive`, `applicableCategories`,
  `applicableProducts`, `createdBy` (= `createdById`), `createdAt`, `updatedAt`.

## Schema change

Add to `model Order` in `prisma/schema.prisma`:
```prisma
returnReason String?
```
New migration `add_order_return_reason`. (Refund fields `refundAmount`,
`refundedAt`, `invoiceUrl` are not touched by any 1D handler — defer to Phase 2.)

## Tasks (TDD — write the test first, watch it fail, implement, watch it pass)

1. **Schema: add `Order.returnReason`** + migration `add_order_return_reason`;
   `prisma generate`. (No test; verified by migrate status + later order tests.)

2. **`services/cartService.js`** (unit tests `tests/services/cartService.test.js`):
   - `CART_PRODUCT_SELECT` / include for item product summaries (name, price,
     images, slug, status, stock, discount, ratingAverage/Count, seller+profile,
     category name).
   - `serializeCartItem(item, product)` → `{ _id, product: serializeProductSummary,
     quantity, variant:{name,value}, price, addedAt }`.
   - `serializeProductSummary(p)` → Mongo-shaped summary incl. `discountedPrice`,
     `rating`, populated `seller`/`category` (reuse productService helpers).
   - `computeSubtotal(items)`, `computeItemCount(items)`.
   - `getOrCreateCart(userId)`; `loadCart(userId)` with items+products.
   - `serializeCart(cart)` → `{ items, subtotal, itemCount, coupon }`.

3. **Port cart controller** to Prisma in `controllers/index.js`
   (integration tests `tests/cart.test.js`): `getCart`, `addToCart`,
   `updateCartItem`, `removeFromCart`, `clearCart`, `applyCoupon`. Match the
   stock checks, variant-merge logic, and "filter inactive products" behavior.

4. **`services/orderService.js`** (unit tests `tests/services/orderService.test.js`):
   - `ORDER_INCLUDE` (items, statusHistory, user).
   - `serializeOrder(order)` (rebuild items.variant + statusHistory + JSON cols).
   - `generateOrderNumber()` (count-based, `CUR-…` format).
   - `computeTotals(subtotal)` → `{ shippingCost, taxAmount, totalPrice }`.

5. **Port order controller** `controllers/orderController.js` to Prisma
   (integration tests `tests/orders.test.js`):
   - `createOrder` in `prisma.$transaction`: load cart (selected items or all),
     validate each product (`exists`, `active`, stock), build order items,
     compute totals, create `Order` with nested `items` + initial
     `statusHistory` event, decrement stock, clear processed cart items. After
     commit: Stripe PI (only `paymentMethod==='stripe'`), save `paymentResult`,
     send confirmation email (best-effort). Return `{ order, clientSecret }`.
   - `getMyOrders`, `getSellerOrders` (filter `items.some.sellerId`), `getOrder`
     (owner/admin guard), `updateOrderStatus` (same transition map; tracking via
     Carrier lookup; stock restore on cancel; append status event),
     `requestReturn`, `stripeWebhook` (find by `paymentResult.id` JSON path).

6. **Port coupon controller** in `controllers/index.js`
   (integration tests `tests/coupons.test.js`): `createCoupon` (map
   `createdBy`→`createdById`, uppercase code), `getCoupons`, `deleteCoupon`,
   plus `serializeCoupon`.

7. **Wire routers + full verification:** mount `cartRouter`, `orderRouter`,
   `adminRouter` (for coupon endpoints) in `tests/helpers/buildApp.js`; run the
   full Jest suite green; boot the server and smoke-test
   `GET /api/cart`, `POST /api/orders`. Update `docs/ROADMAP.md` (1D ✅).

## Interim state / notes
- Reviews, carriers, warehouse, admin dashboard remain on Mongoose until 1E.
  `orderController` still `require`s the Mongoose `Carrier` for tracking-name
  resolution **only if** carriers aren't yet ported — port the Carrier read to
  Prisma here only if the Carrier model has the needed columns; otherwise keep
  the Mongoose Carrier read and finish it in 1E (note the interim coupling).
- `auditLog` + rate limiters already skip under `NODE_ENV=test` (from 1B/1C).
- Stripe stays in Phase 1 to preserve the contract; removed in Phase 2.

## Definition of done
- All cart/order/coupon routes return the unchanged envelope + JSON shapes.
- Order placement is atomic (stock + order + cart mutation in one transaction).
- Full Jest suite green; server boots against Postgres; smoke tests pass.
