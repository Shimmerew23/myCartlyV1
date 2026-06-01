# ADR 0003 — Remove Stripe; add PayPal + GCash

- **Status:** Accepted
- **Date:** 2026-06-01
- **Deciders:** Project owner

## Context

CartLy currently processes payments via Stripe (PaymentIntents + webhooks). The
owner wants to remove Stripe and offer **PayPal** and **GCash** instead, with
refund support, ahead of a real-money launch.

## Decision

Remove Stripe entirely and integrate **PayPal** and **GCash** as the payment
providers, including full and partial refunds.

## Rationale

- Provider choice is a product/business decision driven by the target market
  (GCash is a primary wallet in the Philippines; PayPal has broad reach).
- Consolidating on the chosen providers avoids maintaining an unused Stripe path.

## Consequences

- Remove Stripe server SDK, the client `@stripe/*` packages, and the raw-body
  Stripe webhook route in `server.js`.
- Remove Stripe-specific data fields (e.g. `sellerProfile.stripeAccountId`).
- Add provider SDKs, checkout flows, and webhook handlers for PayPal and GCash.
- Update the order `paymentMethod` enum.
- Payment + order writes are wrapped in PostgreSQL transactions (see ADR 0001).
- Sequenced **after** the database re-platform so refund/transaction logic is
  built on the ACID-capable store.

## Alternatives considered

- **Keep Stripe alongside new providers:** rejected — owner wants Stripe removed.
- **Add providers before the DB migration:** rejected — transactional payment
  consistency is cleaner once Postgres is in place.
