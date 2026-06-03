# Plan 2D — Refunds (full + partial)

**Phase:** 2 — Payment re-platform · **Sub-plan:** 2D (final) · **Date:** 2026-06-04
**Depends on:** 2A (payment seam), 2B (PayPal), 2C (GCash/PayMongo)

## Goal

Let an **admin** issue **full or partial refunds** against a paid order through the
original provider, and reflect the result in the order's `paymentStatus`
(`refunded` / `partially_refunded`) — auditable and idempotent-safe.

## Scope

- Refund dispatch in the provider-agnostic seam (`services/paymentService.js`).
- PayPal (`refundCapture`) and GCash/PayMongo (`refundPayment`) — both clients
  already expose refund methods (built in 2B/2C). COD = manual refund (no
  provider call; cash returned out-of-band) so the order state can still settle.
- Admin endpoint `POST /api/orders/:id/refund` + audit log.
- Frontend admin refund action (full/partial).

**Out of scope:** buyer-initiated refunds (returns already exist via
`POST /:id/return`); multi-currency refund math (PHP/USD — Phase 4); automatic
refund-on-cancel.

## No migration needed

`PaymentStatus` already has `refunded` and `partially_refunded`; `OrderStatus`
already has `refunded`. Refund detail is **additive JSON** stored in the existing
`Order.paymentResult` column — same place `provider`/`captureId`/`status` already
live. So 2D touches no `schema.prisma`.

### `paymentResult` shape after a refund

```jsonc
{
  "id": "<provider order/source id>",
  "provider": "paypal" | "gcash" | "cod",
  "captureId": "<paypal capture id | paymongo payment id>",
  "status": "refunded" | "partially_refunded",   // mirrors paymentStatus
  "refundedAmount": 25.00,                         // running total, order currency
  "refunds": [
    { "id": "<provider refund id|null>", "amount": 25.00, "reason": "...", "at": "<ISO>" }
  ]
}
```

## Design

### `paymentService.refundPayment({ order, amount, reason })`

1. **Guard state:** order `paymentStatus` must be `paid` or `partially_refunded`
   (otherwise `400 Order is not refundable`).
2. **Compute amount:** `already = paymentResult.refundedAmount || 0`;
   `remaining = totalPrice - already`. If `amount` omitted → full remaining.
   Reject `amount <= 0` or `amount > remaining` (`400`).
3. **Provider call** (network — *before* the DB transaction, like `capturePayment`):
   - `paypal` → `paypal.refundCapture(captureId, amount, currency)`
   - `gcash` → `paymongo.refundPayment(captureId /* pay_… */, amount, reason)`
   - `cod` → no provider call (manual), `refundId = null`
   - Missing `captureId` for an online order → `400`.
   - Provider not configured → `400`.
4. **Transactional state update** (`prisma.$transaction`):
   - `newRefunded = already + amount`
   - `fully = newRefunded >= totalPrice - 1e-9`
   - `paymentStatus = fully ? 'refunded' : 'partially_refunded'`
   - append to `refunds[]`, set `refundedAmount`, set `paymentResult.status`
   - if `fully`, also set `order.status = 'refunded'` (admin action, not bound by
     the buyer-facing `updateOrderStatus` transition table)
   - write an `OrderStatusEvent` (`status: 'refunded' | 'partially_refunded'`,
     `note: reason`, `updatedById`)
5. Return `{ status, refundId, refundedAmount, paymentStatus }`.

Idempotency note: refunds are inherently caller-driven (no webhook replay path
here), so safety is via the state guard + remaining-amount check rather than a
dedupe key. A double-submit of a full refund fails the `paid`-state guard the
second time.

### `orderController.refundOrder` (admin)

`POST /api/orders/:id/refund` — `authenticate, requireAdmin, validate(schemas.refund), auditLog('REFUND_ORDER','Order')`.
Body `{ amount?, reason? }`. Loads order, calls `paymentService.refundPayment`,
returns `{ order: serializeOrder(updated), refund }`.

### Route + schema

- `routes/index.js`: add the admin refund route next to `capture`.
- `middleware/index.js` `schemas.refund`: `{ amount?: number>0, reason?: string<=500 }`.

## Tests (TDD)

**Unit — `tests/services/paymentService.test.js`:**
- rejects refund when order not paid
- full PayPal refund → `refundCapture` called with capture id + amount; status `refunded`
- partial refund → `partially_refunded`, `refundedAmount` accumulates; second partial that completes → `refunded`
- rejects amount > remaining
- GCash refund dispatches `paymongo.refundPayment`
- COD refund needs no provider call

**Integration — `tests/payments.refunds.test.js`:**
- admin full refund on a paid PayPal order → `paymentStatus: refunded`, order `status: refunded`, `paymentResult.refundedAmount`
- admin partial refund → `partially_refunded`
- non-admin → 403
- refund on an unpaid order → 400
- audit log row written (`REFUND_ORDER`)

## Done when

- Full + partial refunds work for PayPal & GCash in test mode (provider mocked).
- Order `paymentStatus` reflects `refunded` / `partially_refunded`; full refund sets order `status` refunded.
- Admin-only + audited.
- Full backend suite green; CLAUDE.md + ROADMAP + memory updated.
