# ADR 0004 — PayPal Standard Checkout & GCash via PayMongo

- **Status:** Accepted
- **Date:** 2026-06-03
- **Deciders:** Project owner
- **Refines:** [ADR 0003](0003-remove-stripe-add-paypal-gcash.md)

## Context

ADR 0003 accepted removing Stripe and adding PayPal + GCash but left the concrete
integration approach open. GCash has no direct merchant API — it must be reached
through a payment aggregator.

## Decision

- **PayPal:** integrate **Standard Checkout (Orders v2 REST API)** — frontend
  Smart Buttons, server creates and captures the order, a webhook confirms.
- **GCash:** integrate via **PayMongo** (Philippine aggregator). GCash is created
  as a PayMongo payment method/source; the buyer is redirected to authorize, and
  a PayMongo webhook confirms the payment.
- **Checkout methods offered:** PayPal, GCash, Cash on Delivery (COD). Stripe and
  bank transfer are removed/not offered.
- **`PaymentMethod` enum:** `paypal | gcash | cod`.

## Rationale

- PayMongo is PH-native, has GCash + cards + e-wallets behind one API, and a clean
  sandbox + webhook model — the best fit for a Philippine store.
- PayPal Standard Checkout is the lowest-friction official flow and needs no extra
  PCI scope (no raw card handling on our servers).

## Consequences

- New env vars: `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_API_BASE`,
  `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`.
- A provider-agnostic `paymentService` seam dispatches create/capture/refund/webhook
  per provider, keeping `orderController` thin.
- **Currency:** PayMongo/GCash settle in PHP (centavos); the catalog defaults to
  USD. Flagged for launch — full multi-currency is Phase 4. Phase 2 sends
  `order.totalPrice` in the order currency (×100 minor units for PayMongo).
- No live sandbox credentials in dev: provider calls are env-gated and mocked in
  tests; owner supplies sandbox keys for live end-to-end verification.

## Alternatives considered

- **Xendit / Maya Checkout for GCash:** viable; PayMongo chosen for PH-native fit
  and breadth behind one API.
- **PayPal Advanced Checkout (hosted card fields):** rejected for now — adds
  compliance/setup without a current need to process cards through PayPal.
