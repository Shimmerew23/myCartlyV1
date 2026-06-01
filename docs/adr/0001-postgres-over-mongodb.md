# ADR 0001 — PostgreSQL over MongoDB

- **Status:** Accepted
- **Date:** 2026-06-01
- **Deciders:** Project owner

## Context

CartLy currently uses MongoDB 7 + Mongoose 8. The platform is moving toward a
real-money launch with orders, payments, inventory, and financial reporting —
data that is highly relational and where consistency matters.

## Decision

Re-platform the backend data layer onto **PostgreSQL**.

## Rationale

- **Relational integrity:** orders ↔ items ↔ products ↔ sellers ↔ users are
  inherently relational; foreign keys and joins model this more safely than
  embedded documents and manual ref population.
- **ACID transactions:** order placement and payment capture must be atomic.
  Postgres transactions make order+payment+inventory consistency
  straightforward.
- **Reporting / SQL:** revenue analytics and admin reporting are natural in SQL.
- **Strong typing & constraints:** native enums, check constraints, and NOT NULL
  enforce invariants at the database level.

## Consequences

- Full rewrite of the data-access layer (see ADR 0002 for the ORM choice).
- Embedded subdocuments become related tables.
- MongoDB-specific features are replaced: text indexes → `tsvector`/`pg_trgm`;
  TTL indexes → scheduled cleanup jobs.
- The API contract (routes + `ApiResponse` envelope) is **frozen** during the
  migration so the frontend is unaffected.
- This is a foundational change that blocks later phases; it ships first.

## Alternatives considered

- **Stay on MongoDB** with multi-document transactions and `$lookup`: viable but
  rejected — owner requires relational as a firm decision; SQL reporting and FK
  integrity are first-class wins.
