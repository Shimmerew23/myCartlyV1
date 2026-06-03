# Plan 2C — GCash via PayMongo

**Phase:** 2 · **Sub-plan:** 2C · **Date:** 2026-06-03
**Depends on:** 2A, 2B · **Refs:** [ADR 0004](../../adr/0004-paypal-standard-checkout-gcash-via-paymongo.md)

## Goal

Enable GCash payments through PayMongo's **Sources** flow, reusing the redirect
pattern PayPal established in 2B (`payment.approveUrl` → frontend redirect). Order
state transitions stay transactional + idempotent (`markOrderPaid`). Env-gated;
PayMongo HTTP mocked in tests.

## Flow (PayMongo Sources, GCash)

1. `POST /api/orders` with `paymentMethod: "gcash"` → DB order (`pending`), then
   `paymentService.createPayment` creates a PayMongo **source** (type `gcash`,
   `amount` in centavos, `redirect.success`/`failed` →
   `${FRONTEND_URL}/checkout/gcash/return|cancel?orderId=<id>`). Stores the source
   id in `paymentResult`. Returns `{ order, payment: { provider:'gcash',
   status:'pending', approveUrl: checkout_url, providerRef: sourceId } }`.
2. Frontend redirects to `checkout_url` (GCash auth page).
3. PayMongo fires **`source.chargeable`** → our webhook creates a **payment** from
   the source (`POST /v1/payments`); GCash payments come back `paid` → `markOrderPaid`.
4. **`payment.paid`** webhook is an idempotent backstop (mapped to the order via
   the payment's `source.id`).
5. The `/checkout/gcash/return` page polls the order until `paymentStatus:'paid'`
   (confirmation is webhook-driven), then shows the order.

> Currency: PayMongo settles in **PHP**; amount is `round(totalPrice*100)` centavos
> with `currency:'PHP'`. The catalog defaults to USD — flagged in ADR 0004 (full
> multi-currency is Phase 4). Sandbox accepts PHP test amounts.

## Tasks (TDD; PayMongo HTTP mocked)

1. **`config/paymongo.js`** — Basic-auth (`sk` + ':') REST client:
   `createSource({ amount, currency='PHP', successUrl, failedUrl })` →
   `{ id, checkoutUrl, status }`; `createPaymentFromSource({ amount, currency,
   sourceId, description })` → `{ id, status }`; `refundPayment(paymentId, amount,
   reason)` (2D); `verifyWebhookSignature({ headers, rawBody })` (HMAC-SHA256 over
   `t.rawBody` vs the `Paymongo-Signature` `te`/`li` field); `isConfigured()`.

2. **`paymentService` GCash branch + webhook** (unit tests, mock `config/paymongo`):
   - `createPayment('gcash')` → guard `isConfigured`; create source; return
     `redirectUrl`/`approveUrl` = checkout_url, `providerRef` = source id.
   - `handleWebhook('paymongo', { headers, rawBody })` → verify; on
     `source.chargeable` create payment from source then `markOrderPaid`; on
     `payment.paid` map by source id and `markOrderPaid` (idempotent). Order
     lookup by `paymentResult.id == sourceId`.

3. **`orderController`** (integration tests, mock `config/paymongo`):
   `paymongoWebhook` `POST /orders/webhook/paymongo` (raw) → `handleWebhook`.
   Route + app-level `express.raw` for the path.

4. **Frontend** — Checkout GCash option gated on `VITE_GCASH_ENABLED`; place-order
   redirect already handled by the 2B `approveUrl` path. New `GcashReturn` page
   polls `GET /orders/:id` for `paymentStatus:'paid'` (a few attempts) then routes
   to the order; cancel view. Routes wired.

5. **Verify** — full backend suite green; boot smoke (gcash unconfigured → 400
   "GCash is not configured"; webhook route live); ROADMAP 2C; commit + push.

## Definition of done
- GCash create→redirect→(webhook)→paid works (mocked in tests; live needs keys).
- Webhook idempotent + transactional; unconfigured env degrades gracefully.
- Backend suite green. Next: 2D — refunds (PayPal + PayMongo).
