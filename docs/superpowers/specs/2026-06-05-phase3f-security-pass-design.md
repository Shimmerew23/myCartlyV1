# Phase 3F — Security Pass + Deployment Runbook — Design

> Part of [Phase 3 — Operational hardening](../../ROADMAP.md#phase-3--operational-hardening--in-progress-real-money-bar). Sub-plan 3F (final).

**Status:** Approved (design) — 2026-06-05
**Depends on:** 3A (CI gates the changes), 3D (health probes used by the deploy runbook), 3E (secrets runbook cross-referenced)
**Launch context:** real paying users (strictest reliability + security bar)

## Goal

Close out Phase 3 with a focused security pass and an operator deployment
runbook. Remove deprecated/dead dependencies (which also clears most `npm audit`
advisories at the source), remediate the remaining advisories without forcing
breaking changes, harden a few concrete config weaknesses found during the pass,
remove plaintext default credentials from the public README, and document a
cold-start deployment + rollback procedure. Provider-dashboard actions (rotating
keys, redeploys) remain **operator checklists**, not executed by this phase.

## Context

- **Repo is PUBLIC** — plaintext default passwords in `README.md` and any
  insecure default in code are publicly visible. This drives §5 and §3.
- **Auth model:** the API authenticates via **JWT in the `Authorization`
  header** (`passport-jwt`). `express-session` + cookies are used **only** for
  the Google OAuth handshake. This is why a classic CSRF token is unnecessary
  (see §2).
- **Deploy stack:** Render (backend, free Singapore), Vercel (frontend,
  `mcartly.vercel.app`), Neon (Postgres), Upstash (Redis). Already inventoried in
  `docs/runbooks/secrets-and-config.md` (3E).
- **Findings from the audit pass:**
  - `csurf`, `csrf`, `xss-clean`, `celebrate`, `express-validator`, `apicache`,
    `etag`, and the npm `crypto` shim are **declared but never wired** (verified
    by grep across `backend/`). All validation is Joi (`validate(schemas.x)`);
    `handleValidationErrors` is exported but used by zero routes; Node's built-in
    `crypto` always wins module resolution over the npm shim.
  - `backend npm audit`: 9 advisories. The dead deps account for the `lodash`
    (high, via `celebrate`) and `csurf` (low) findings. Remaining after prune:
    `nodemailer` (high, on 6.x), `express`/`qs`/`body-parser` (moderate),
    `uuid` (moderate; fix is breaking `uuid@14`), `cookie`/`brace-expansion` (low).
  - `frontend npm audit`: 17 advisories, expected to be dev/build-chain
    (vite/esbuild) — not shipped runtime.
  - `server.js:127` has a weak default: `SESSION_SECRET || 'fallback-secret-change-this'`.
  - `server.js:95` keeps `X-CSRF-Token` in CORS `allowedHeaders` — vestigial now
    that no CSRF token exists.

## Non-goals

- **No `npm audit fix --force`.** Breaking transitive bumps (`uuid@14`, major
  `qs`/`express`) are documented as a tracked low-risk follow-up, not forced in
  this pass.
- **No new CSRF middleware** (see §2 rationale).
- **No input-sanitization middleware** (see §3 rationale).
- **No change to the session cookie's `sameSite`.** It is `'none'` in prod by
  design (cross-domain Vercel↔Render OAuth) and paired with `secure:true`;
  downgrading to `lax` would break OAuth.
- No provider-dashboard execution (rotations/redeploys are runbook steps).

## Architecture overview

Seven workstreams; the first four are code/config, the last three are docs.

| # | Area | Deliverable |
|---|---|---|
| 1 | Dependency prune | Remove 8 dead deps + dead `handleValidationErrors` |
| 2 | CSRF posture | Remove vestigial header; document bearer-token safety |
| 3 | XSS posture | Document layered defense (no middleware) |
| 4 | Secret/audit hardening | Fail-fast secret guard; `npm audit fix`; `nodemailer` 6→7 |
| 5 | README credentials | Strip plaintext default passwords |
| 6 | Deployment runbook | `docs/runbooks/deployment.md` |
| 7 | Close-out | ROADMAP / CLAUDE.md / memory |

## 1. Dependency prune

Remove from `backend/package.json` `dependencies` (all verified zero-usage):

| Package | Rationale |
|---|---|
| `csurf` | deprecated; never imported |
| `csrf` | base lib for csurf; never imported |
| `xss-clean` | deprecated; never imported |
| `celebrate` | unused (Joi is the validator); pulls in vulnerable `lodash` |
| `express-validator` | `handleValidationErrors` wired into no route |
| `apicache` | unused (caching is custom Redis `cacheMiddleware`) |
| `etag` | unused |
| `crypto` | npm shim; Node built-in always resolves first |

In `backend/middleware/index.js`: delete the `express-validator` import
(line 11), the `handleValidationErrors` function (~290–298), and its export
(~606). Then `npm install` to refresh `package-lock.json`.

**Verification:** `npm test` (Jest) stays green; `grep` confirms no remaining
references to any removed symbol.

## 2. CSRF posture (remove + document)

- Remove `X-CSRF-Token` from CORS `allowedHeaders` in `server.js`.
- No CSRF middleware. Documented rationale (in the deployment runbook security
  note): state-changing API requests authenticate with a **bearer token in the
  `Authorization` header**, which browsers never attach automatically
  cross-site, so the API is structurally not CSRF-susceptible. The only
  cookie-bearing surface is the OAuth handshake (`express-session`), whose cookie
  is `httpOnly` + `secure` (prod) and not used to authorize mutations.

## 3. XSS posture (document layered defense)

No input-sanitization middleware (current best practice is to encode on output,
not mutate input). Document the existing layers: React output-encoding (frontend),
Joi input validation (backend), and Helmet CSP (`server.js`). This goes in the
deployment runbook security note alongside §2.

## 4. Secret + audit hardening

- **Fail-fast secret guard.** In `server.js`, before the app starts listening,
  when `NODE_ENV === 'production'`, throw if any of `JWT_SECRET`,
  `JWT_REFRESH_SECRET`, `SESSION_SECRET` is unset — fail loudly rather than boot
  with an insecure default. In non-production it stays permissive (tests/dev).
- **Remove the weak default:** delete `|| 'fallback-secret-change-this'` at
  `server.js:127` (guard now covers prod; dev still works since
  `.env`/`.env.test` set it).
- **`npm audit fix` (non-breaking)** on `backend/` and `frontend/`.
- **`nodemailer` 6 → 7** (clears the high advisory). Verify the email util still
  constructs a transport / the relevant tests pass.
- **Residual advisories** that would require breaking changes (`uuid@14`,
  transitive `qs`/`express`/`cookie`) are listed in the deployment runbook as a
  tracked, low-risk follow-up.
- **Gate:** backend `npm test` and frontend `npm run lint` + `npm run test:run`
  + `npm run build` must all stay green.

## 5. README default credentials

Replace the plaintext table (`README.md` ~461–469). Keep the role/email rows for
orientation but remove the literal passwords; reference the documented
`Role@123456` *format* once, with a bold warning that these are seed-only and
must never exist in production. Keep CLAUDE.md's existing one-line mention
consistent (it already only states the format).

## 6. Deployment runbook

New `docs/runbooks/deployment.md`:

- **Stack diagram / responsibilities** (Render / Vercel / Neon / Upstash).
- **Cold-start first deploy order:** provision DB+Redis → set backend env on
  Render (cross-ref `secrets-and-config.md` bootstrap) → `prisma migrate deploy`
  → deploy backend → verify `/health/ready` = 200 → set Vercel env
  (`VITE_API_URL`) → deploy frontend → smoke test (login, catalog, place order).
- **Routine deploy:** push `develop` → green CI → PR into `main` → Render/Vercel
  auto-deploy from `main`.
- **Rollback:** Render "Rollback to previous deploy"; Vercel "Promote previous
  deployment"; DB rollback defers to the DR runbook (Neon PITR).
- **Render free-tier cold-start caveat** + the existing keep-alive ping on
  `GET /health`.
- **Security note** consolidating §2 (CSRF) + §3 (XSS) + the residual-advisory
  follow-up list from §4.

## 7. Close-out

- `docs/ROADMAP.md`: tick `3F`, and the two open workstream rows ("Security pass
  over Helmet/rate-limit/RBAC/CORS"; "Deployment target chosen + documented
  runbook"); flip Phase 3 status to complete.
- `CLAUDE.md`: add a short "Security & deployment (Phase 3F)" note after the 3E
  paragraph.
- Update project memory (`phase3-progress-and-security-followup`, `MEMORY.md`):
  Phase 3 complete; README plaintext passwords removed.

## Testing strategy

- **Prune (§1):** existing Jest suite is the regression net; a grep check
  confirms no dangling references.
- **Secret guard (§4):** a small Jest unit test that the guard throws in
  `production` with a secret missing and passes when all are present (restore
  `process.env` after).
- **CORS header (§2):** covered indirectly; no behavioral test needed (removing
  an allowed header has no positive assertion). Manual verification via grep.
- **Audit/upgrades (§4):** the full backend + frontend CI gate.
- **Docs (§5–§7):** placeholder scan (no `TODO`/`TBD`/leaked secret).

## Risks

- **`nodemailer` major bump** could change the transport API. Mitigation:
  review the email util after upgrade; the suite mocks email so a constructor
  change surfaces fast.
- **Removing `express-validator`/`celebrate`** if a hidden dynamic require
  exists. Mitigation: grep verified static; Jest covers route validation paths.
- **Fail-fast guard** must not trip CI (CI sets `JWT_SECRET` etc. and runs as
  `test`, not `production`). Mitigation: guard is `production`-only.

## Definition of done

- Dead deps gone; `package-lock.json` refreshed; no dangling references.
- `npm audit` high/critical count reduced; residuals documented.
- Weak session-secret default removed; prod fail-fast guard in place + tested.
- README has no plaintext default passwords.
- `docs/runbooks/deployment.md` exists with cold-start + rollback + security note.
- Backend Jest + frontend lint/test/build green.
- ROADMAP/CLAUDE.md/memory mark Phase 3 complete.
