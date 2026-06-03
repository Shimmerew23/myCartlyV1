# Plan 2B — PayPal Standard Checkout (Orders v2)

**Phase:** 2 · **Sub-plan:** 2B · **Date:** 2026-06-03
**Depends on:** 2A · **Refs:** [ADR 0004](../../adr/0004-paypal-standard-checkout-gcash-via-paymongo.md)

## Goal

Enable PayPal payments end-to-end on the Orders v2 REST API, server-side
create + capture, using a **redirect (approve URL) flow** — the same shape GCash
(2C) will use, so both providers share one frontend pattern. Env-gated; provider
HTTP mocked in tests. Order state transitions stay transactional.

> Flow choice: server-side create + redirect to the PayPal `approve` link (then
> capture on return) instead of JS Smart Buttons. Still Orders v2 Standard
> Checkout; chosen for consistency with the GCash redirect flow and simpler,
> testable frontend. Smart Buttons can be layered on later without backend change.

## Flow

1. `POST /api/orders` with `paymentMethod: "paypal"` → creates the DB order
   (`pending`), then `paymentService.createPayment` creates a PayPal order
   (Orders v2, `intent: CAPTURE`, `return_url`/`cancel_url` →
   `${FRONTEND_URL}/checkout/paypal/return?orderId=<dbId>`). Stores the PayPal
   order id in `paymentResult`. Returns `{ order, payment: { provider:'paypal',
   providerRef, approveUrl, status:'created' } }`.
2. Frontend redirects the buyer to `approveUrl`. Buyer approves on PayPal →
   PayPal redirects to our return URL.
3. Return page calls `POST /api/orders/:id/capture` → `paymentService.capturePayment`
   → PayPal capture → `markOrderPaid` (tx: status event `confirmed` + order
   `paymentStatus:'paid'`, `paidAt`, `status:'confirmed'`, capture id in
   `paymentResult`). Idempotent (already-paid → no-op success).
4. `POST /api/orders/webhook/paypal` (raw body) verifies the webhook and, on
   `PAYMENT.CAPTURE.COMPLETED`, runs the same `markOrderPaid` as a backstop.

## Tasks (TDD; PayPal HTTP mocked)

1. **`config/paypal.js`** — REST wrapper using global `fetch`:
   `getAccessToken()` (client_credentials, cached to ~expiry), `createOrder({
   amount, currency, referenceId, returnUrl, cancelUrl })`, `captureOrder(id)`,
   `refundCapture(captureId, amount, currency)`, `verifyWebhookSignature({
   headers, body })`. `isConfigured()` = env present. All read `PAYPAL_CLIENT_ID/
   SECRET/API_BASE/WEBHOOK_ID`.

2. **`paymentService` PayPal branch + helpers** (unit tests, mock `config/paypal`):
   - `createPayment('paypal')` → guard `isConfigured` (else 400 "PayPal not
     configured"); create PayPal order; return `{ provider, status:'created',
     approveUrl, providerRef }`.
   - `capturePayment({ order })` → capture; return normalized `{ status:'paid',
     captureId }` (or throw on failure).
   - `markOrderPaid(orderId, { provider, captureId }, client)` — transactional
     state change; idempotent if already paid.
   - `handleWebhook('paypal', { headers, rawBody })` → verify + dispatch.

3. **`orderController`** (integration tests, mock `config/paypal`):
   - `createOrder` already calls `paymentService.createPayment` — PayPal now
     returns approveUrl (order left `pending`).
   - `capturePayment` `POST /orders/:id/capture` (auth, owner) → capture + paid.
   - `paypalWebhook` `POST /orders/webhook/paypal` (raw) → `handleWebhook`.
   - routes + `express.raw()` for the webhook path in `server.js`.

4. **Frontend** — Checkout offers PayPal when `VITE_PAYPAL_ENABLED`/client cfg;
   on place-order with paypal, redirect to `payment.approveUrl`. New route
   `/checkout/paypal/return` captures via `POST /orders/:id/capture` and shows
   success/failure. (COD path unchanged.)

5. **Verify** — full backend suite green; boot smoke (paypal create returns 400
   "not configured" when env unset — graceful); ROADMAP 2B; commit + push.

## Definition of done
- PayPal create→approve→capture works (mocked in tests; live needs sandbox keys).
- Webhook confirms capture idempotently; order state transitions are transactional.
- Backend suite green; unconfigured env degrades gracefully (clear 400).
