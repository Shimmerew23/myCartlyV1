# Plan 2A — Remove Stripe + Payment-Service Scaffold

**Phase:** 2 (Payment re-platform) · **Sub-plan:** 2A
**Date:** 2026-06-03
**Depends on:** Phase 1 (complete)
**Refs:** [ADR 0003](../../adr/0003-remove-stripe-add-paypal-gcash.md), [ADR 0004](../../adr/0004-paypal-standard-checkout-gcash-via-paymongo.md)

## Goal

Excise Stripe end-to-end and lay a provider-agnostic payment seam so 2B (PayPal)
and 2C (GCash/PayMongo) drop in cleanly. After 2A, checkout works with **COD**
(PayPal/GCash arrive in 2B/2C). Order placement stays atomic (Phase 1
`prisma.$transaction`). Keep the `ApiResponse` envelope.

## Stripe footprint (from the 2A scan)

Backend:
- `controllers/orderController.js` — lazy `stripe` init, `createOrder` PaymentIntent
  block (returns `clientSecret`), `stripeWebhook` handler.
- `routes/index.js` — `POST /orders/webhook` (raw body) → `orderCtrl.stripeWebhook`.
- `server.js` — `express.raw()` for `/api/orders/webhook`; Helmet CSP allows
  `api.stripe.com` / `js.stripe.com`.
- `prisma/schema.prisma` — `PaymentMethod` enum has `stripe`; `SellerProfile.stripeAccountId`.
- `.env.example` / `.env` — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- `package.json` — `stripe` dep.
- `tests/orders.test.js` — uses `paymentMethod: 'cod'` already (no Stripe assertions).

Frontend (Stripe is cosmetic — no `loadStripe`/Elements/clientSecret in use):
- `pages/Checkout.tsx` — `paymentMethod: 'stripe' | 'cod'` + Stripe labels/blurbs.
- `pages/Cart.tsx`, `pages/Login.tsx`, `components/layout/Footer.tsx` — Stripe text/badges.
- `package.json` — `@stripe/stripe-js`, `@stripe/react-stripe-js` (unused in code).

## Tasks (TDD where there's logic)

1. **Schema:** `PaymentMethod` enum → `paypal | gcash | cod` (drop `stripe`,
   `bank_transfer`); remove `SellerProfile.stripeAccountId`. Hand-written
   migration (strip Prisma's spurious FTS statements); `prisma generate`.
   - Enum value removal is safe (greenfield; no rows use them — verify with a count).

2. **`services/paymentService.js` (scaffold)** — provider-agnostic seam:
   `createPayment({ order, method, ... })`, `capturePayment`, `refundPayment`,
   `handleWebhook(provider, ...)`, dispatching by method. 2A implements only the
   `cod` path (no external call; order stays `paymentStatus: 'pending'`); PayPal
   and GCash branches throw `ApiError.badRequest('Provider not yet enabled')`
   until 2B/2C. Unit-test the dispatch + COD path.

3. **`orderController` cleanup:** remove the `stripe` import + PaymentIntent block
   + `stripeWebhook`. `createOrder` returns `{ order }` (no `clientSecret`) and
   routes payment through `paymentService` based on `paymentMethod`. Keep the
   create response shape otherwise identical. Add a generic
   `POST /orders/:id/pay` + webhook seam placeholder (real bodies in 2B/2C) — or
   defer the pay endpoint to 2B; 2A just stops creating Stripe intents.

4. **Routes/server:** remove the Stripe webhook route + the `express.raw()` line
   (re-added per provider in 2B/2C with their own raw-body needs); drop Stripe
   from the Helmet CSP.

5. **Deps/env:** remove `stripe` (backend) + `@stripe/*` (frontend); remove
   `STRIPE_*` from `.env.example`; add placeholders for `PAYPAL_*` / `PAYMONGO_*`.

6. **Frontend:** Checkout `paymentMethod` → `'cod'` (PayPal/GCash added in 2B/2C);
   replace Stripe labels/badges with neutral copy; `npm run lint` clean.

7. **Verify:** full backend suite green; `tests/orders.test.js` still passes
   (COD); boot + smoke (place a COD order). Update ROADMAP 2A ✅. Commit + push.

## Definition of done
- No Stripe code, deps, env, or CSP entries remain.
- `PaymentMethod` enum is `paypal|gcash|cod`; COD checkout works end-to-end.
- `paymentService` seam in place; backend suite green; frontend lints.

## Next
- **2B — PayPal Standard Checkout** (create/capture + webhook + Smart Buttons).
- **2C — GCash via PayMongo** (source/payment + webhook + redirect).
- **2D — Refunds** (full/partial, `paymentStatus`, admin action + audit).
