# ADR 0002 — Prisma as the PostgreSQL ORM

- **Status:** Accepted
- **Date:** 2026-06-01
- **Deciders:** Project owner

## Context

Following ADR 0001 (PostgreSQL over MongoDB), CartLy needs a data-access layer
for Postgres. The backend is JavaScript/Node; the frontend is TypeScript. The
migration must be safe (real-money launch) and the team is small.

## Decision

Use **Prisma** as the ORM and migration tool.

## Rationale

- **Schema-first with first-class migrations:** `prisma migrate` gives versioned,
  reviewable migrations — important for a production database.
- **Type safety:** strong TypeScript inference reduces query bugs.
- **Readable queries with relations:** `include`/`select` map cleanly to the
  relational model we're building.
- **Strong ecosystem & docs:** lowers risk for a small team.
- **Escape hatch:** raw SQL (`$queryRaw`) is available for `tsvector` full-text
  search and anything Prisma doesn't express directly.

## Consequences

- `models/` becomes a Prisma schema + generated client; Mongoose is removed.
- Slightly heavier runtime than a thin query builder; acceptable for this app.
- Full-text search uses raw SQL / generated columns rather than a Prisma-native
  abstraction.

## Alternatives considered

- **Drizzle ORM:** lighter and SQL-first, but more manual; Prisma's migrations
  and DX win for a small team prioritizing safety.
- **TypeORM / Sequelize:** mature but more boilerplate and historically rougher
  migrations; chosen only for team familiarity, which doesn't apply here.
