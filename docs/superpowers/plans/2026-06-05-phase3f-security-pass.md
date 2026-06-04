# Phase 3F — Security Pass + Deployment Runbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out Phase 3 with a security pass (prune dead/deprecated deps, remediate `npm audit`, harden secret handling, strip plaintext default passwords) and a cold-start deployment runbook.

**Architecture:** Mostly subtractive — remove unused dependencies and a vestigial CORS header, add one small fail-fast env guard, upgrade `nodemailer`, edit docs. The existing Jest + frontend CI suite is the regression net. No new runtime behavior except the production secret guard.

**Tech Stack:** Node/Express backend (`backend/`), Vite/React frontend (`frontend/`), Jest + Supertest, npm.

**Spec:** `docs/superpowers/specs/2026-06-05-phase3f-security-pass-design.md`

**Conventions for every commit in this plan:**
- Run git from the repo root: `git -C e:/GitHub/myCartlyV1 ...` (the Bash CWD may persist as `backend/`).
- Stage **explicit paths only** — never `git add -A`/`.`; never stage `.env*` or `.claudeignore`.
- Commit messages end with the trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```

---

### Task 1: Prune dead/deprecated backend dependencies

**Files:**
- Modify: `backend/package.json` (dependencies block, ~20–58)
- Modify: `backend/middleware/index.js:11` (import), `~290–298` (function), `:606` (export)
- Regenerate: `backend/package-lock.json` (via `npm install`)

- [ ] **Step 1: Confirm zero usage one more time (safety net)**

Run (from `backend/`):
```bash
grep -rnE "require\(['\"](csurf|csrf|xss-clean|celebrate|express-validator|apicache|etag)['\"]\)" --include=*.js . | grep -v node_modules
grep -rn "handleValidationErrors" --include=*.js . | grep -v node_modules
```
Expected: only the `middleware/index.js` definition/export lines for `handleValidationErrors`; **no** other require sites. (The npm `crypto` shim needs no grep — `require('crypto')` resolves to Node built-in.)

- [ ] **Step 2: Remove the express-validator import**

In `backend/middleware/index.js`, delete line 11 entirely:
```js
const { body, query, param, validationResult } = require('express-validator');
```

- [ ] **Step 3: Remove the dead `handleValidationErrors` function**

In `backend/middleware/index.js`, delete the block (~290–298):
```js
// express-validator middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formatted = errors.array().map((e) => ({ field: e.path, message: e.msg }));
    return next(new ApiError(422, 'Validation failed', formatted));
  }
  next();
};
```

- [ ] **Step 4: Remove it from the module exports**

In `backend/middleware/index.js`, delete the `handleValidationErrors,` line (~606) from the `module.exports = { ... }` object.

- [ ] **Step 5: Remove the dead dependencies from package.json**

In `backend/package.json` `dependencies`, delete these eight lines:
```json
"apicache": "^1.6.3",
"celebrate": "^15.0.3",
"crypto": "^1.0.1",
"csrf": "^3.1.0",
"csurf": "^1.11.0",
"etag": "^1.8.1",
"express-validator": "^7.0.1",
"xss-clean": "^0.1.4"
```
(Leave a valid JSON object — watch trailing commas.)

- [ ] **Step 6: Refresh the lockfile**

Run (from `backend/`):
```bash
npm install
```
Expected: removes the packages, rewrites `package-lock.json`, exits 0.

- [ ] **Step 7: Verify no dangling references + tests green**

Run (from `backend/`):
```bash
grep -rn "handleValidationErrors\|express-validator" --include=*.js . | grep -v node_modules    # expect: no output
npm test
```
Expected: grep prints nothing; Jest suite passes (same count as before, ~195).

- [ ] **Step 8: Commit**

```bash
git -C e:/GitHub/myCartlyV1 add backend/package.json backend/package-lock.json backend/middleware/index.js
git -C e:/GitHub/myCartlyV1 commit -m "$(printf 'chore(security): remove dead/deprecated deps (csurf, xss-clean, celebrate, etc.)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: Production secret fail-fast guard + remove weak default

**Files:**
- Create: `backend/utils/validateEnv.js`
- Test: `backend/tests/validateEnv.test.js`
- Modify: `backend/server.js:127` (remove fallback), `backend/server.js:~200` (call guard)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/validateEnv.test.js`:
```js
const { assertProductionSecrets } = require('../utils/validateEnv');

describe('assertProductionSecrets', () => {
  const base = {
    NODE_ENV: 'production',
    JWT_SECRET: 'a',
    JWT_REFRESH_SECRET: 'b',
    SESSION_SECRET: 'c',
  };

  it('does not throw when all required secrets are set in production', () => {
    expect(() => assertProductionSecrets(base)).not.toThrow();
  });

  it('throws when a required secret is missing in production', () => {
    const env = { ...base, SESSION_SECRET: undefined };
    expect(() => assertProductionSecrets(env)).toThrow(/SESSION_SECRET/);
  });

  it('is a no-op outside production', () => {
    const env = { NODE_ENV: 'test' };
    expect(() => assertProductionSecrets(env)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `backend/`):
```bash
npx cross-env NODE_ENV=test jest tests/validateEnv.test.js --runInBand
```
Expected: FAIL — `Cannot find module '../utils/validateEnv'`.

- [ ] **Step 3: Implement the guard**

Create `backend/utils/validateEnv.js`:
```js
// Fail-fast check that critical signing secrets exist in production.
// In non-production (dev/test) it is a no-op so local + CI runs stay frictionless.
const REQUIRED_PRODUCTION_SECRETS = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'SESSION_SECRET'];

function assertProductionSecrets(env = process.env) {
  if (env.NODE_ENV !== 'production') return;
  const missing = REQUIRED_PRODUCTION_SECRETS.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Refusing to start: missing required production secret(s): ${missing.join(', ')}`
    );
  }
}

module.exports = { assertProductionSecrets, REQUIRED_PRODUCTION_SECRETS };
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `backend/`):
```bash
npx cross-env NODE_ENV=test jest tests/validateEnv.test.js --runInBand
```
Expected: PASS (3 tests).

- [ ] **Step 5: Remove the weak session-secret default**

In `backend/server.js:127`, change:
```js
    secret: process.env.SESSION_SECRET || 'fallback-secret-change-this',
```
to:
```js
    secret: process.env.SESSION_SECRET,
```

- [ ] **Step 6: Wire the guard into startup**

In `backend/server.js`, add the require near the other internal requires (next to `const { connectPrisma } = require('./config/prisma');`):
```js
const { assertProductionSecrets } = require('./utils/validateEnv');
```
Then make it the first line inside the `try` of `startServer` (before `await connectPrisma();`):
```js
  try {
    // Fail fast if production is missing critical signing secrets
    assertProductionSecrets();

    // Connect to PostgreSQL via Prisma (system of record)
    await connectPrisma();
```

- [ ] **Step 7: Run the full suite to confirm nothing regressed**

Run (from `backend/`):
```bash
npm test
```
Expected: full suite passes (now +3 tests vs Task 1).

- [ ] **Step 8: Commit**

```bash
git -C e:/GitHub/myCartlyV1 add backend/utils/validateEnv.js backend/tests/validateEnv.test.js backend/server.js
git -C e:/GitHub/myCartlyV1 commit -m "$(printf 'feat(security): fail-fast on missing prod secrets; drop weak session default\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: Remove vestigial CSRF header from CORS

**Files:**
- Modify: `backend/server.js:95`

- [ ] **Step 1: Remove `X-CSRF-Token` from allowedHeaders**

In `backend/server.js:95`, change:
```js
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token'],
```
to:
```js
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
```

- [ ] **Step 2: Confirm no frontend code sends that header**

Run (from repo root):
```bash
grep -rni "x-csrf-token\|csrf" frontend/src | grep -v node_modules
```
Expected: no output (frontend never sends a CSRF token — confirms removal is safe).

- [ ] **Step 3: Run backend tests (CORS path unaffected)**

Run (from `backend/`):
```bash
npm test
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git -C e:/GitHub/myCartlyV1 add backend/server.js
git -C e:/GitHub/myCartlyV1 commit -m "$(printf 'chore(security): drop vestigial X-CSRF-Token from CORS allowedHeaders\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: npm audit remediation + nodemailer upgrade

**Files:**
- Modify: `backend/package.json`, `backend/package-lock.json`
- Modify: `frontend/package.json`, `frontend/package-lock.json` (only if `npm audit fix` changes them)

- [ ] **Step 1: Capture the baseline backend audit**

Run (from `backend/`):
```bash
npm audit --omit=dev
```
Note the high/critical count for the commit message (after Task 1's prune, `lodash`/`csurf` should already be gone).

- [ ] **Step 2: Non-breaking backend audit fix**

Run (from `backend/`):
```bash
npm audit fix
```
Expected: applies only semver-compatible fixes (no `--force`).

- [ ] **Step 3: Upgrade nodemailer 6 → 7**

Run (from `backend/`):
```bash
npm install nodemailer@^7
```

- [ ] **Step 4: Verify the email transport still constructs**

Run (from `backend/`):
```bash
node -e "const n=require('nodemailer'); const t=n.createTransport({host:'smtp.test',port:587,auth:{user:'u',pass:'p'}}); console.log('transport OK:', typeof t.sendMail==='function');"
```
Expected: `transport OK: true`. (Confirms the v7 `createTransport` API used in `utils/email.js` is unchanged.)

- [ ] **Step 5: Run the full backend suite**

Run (from `backend/`):
```bash
npm test
```
Expected: PASS.

- [ ] **Step 6: Non-breaking frontend audit fix + verify build**

Run (from `frontend/`):
```bash
npm audit fix
npm run lint
npm run test:run
npm run build
```
Expected: all green. (Most frontend advisories are dev/build-chain and may remain after a non-breaking fix — that is acceptable; record the residual count.)

- [ ] **Step 7: Commit**

Stage only the lockfiles/manifests that actually changed:
```bash
git -C e:/GitHub/myCartlyV1 add backend/package.json backend/package-lock.json
# add the next line ONLY if frontend files changed:
git -C e:/GitHub/myCartlyV1 add frontend/package.json frontend/package-lock.json
git -C e:/GitHub/myCartlyV1 commit -m "$(printf 'chore(security): npm audit fix + nodemailer 6->7\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 5: Strip plaintext default passwords from README

**Files:**
- Modify: `README.md:461–469`

- [ ] **Step 1: Replace the credentials table**

In `README.md`, replace lines 461–469 (the `## Default Test Accounts` heading + table) with:
```markdown
## Default Test Accounts (after seeding)

`utils/seeder.js` creates these accounts for **local/test use only**. Each
password follows the pattern `<Role>@123456` (e.g. the admin's role is `Admin`).
See `utils/seeder.js` for the exact values.

| Role | Email |
|---|---|
| Superadmin | superadmin@CartLy.com |
| Admin | admin@CartLy.com |
| Seller | seller@CartLy.com |
| Seller 2 | seller2@CartLy.com |
| User | user@CartLy.com |

> ⚠️ **Never seed production.** This repo is public and these are well-known
> credentials — running `npm run seed` against a live database would create
> publicly-known logins. Seed only local/test databases.
```

- [ ] **Step 2: Verify no literal default passwords remain in README**

Run (from repo root):
```bash
grep -nE "Admin@123456|Seller@123456|User@123456" README.md
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git -C e:/GitHub/myCartlyV1 add README.md
git -C e:/GitHub/myCartlyV1 commit -m "$(printf 'docs(security): remove plaintext default passwords from README\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 6: Cold-start deployment runbook

**Files:**
- Create: `docs/runbooks/deployment.md`

- [ ] **Step 1: Write the runbook**

Create `docs/runbooks/deployment.md` with these sections (full prose, no placeholders):

1. **Stack & responsibilities** — table: Render (backend API + cron keep-alive), Vercel (frontend SPA), Neon (Postgres, system of record), Upstash (Redis, ephemeral). Cross-reference `secrets-and-config.md` and `disaster-recovery.md`.
2. **Cold-start first deploy (in order):**
   1. Provision Neon project → copy `DATABASE_URL`.
   2. Provision Upstash → copy `REDIS_URL`.
   3. Set backend env on Render (point to `secrets-and-config.md` §New-environment bootstrap; `render.yaml` declares the `sync:false` secrets).
   4. `cd backend && npx prisma migrate deploy`.
   5. Deploy backend; verify `GET https://<backend>/health/ready` → **200**, `GET /health/live` → 200.
   6. Set frontend env on Vercel (`VITE_API_URL=https://<backend>/api`, optional `VITE_SENTRY_DSN`).
   7. Deploy frontend.
   8. Smoke test: register/login, browse catalog, place a COD order, (admin) view orders.
3. **Routine deploys** — push `develop` → CI green → PR into `main` (branch protection requires `Backend (Prisma + Jest)` + `Frontend (Lint + Build)`) → Render + Vercel auto-deploy from `main`. Note migrations: run `prisma migrate deploy` (Render build/release step) before the new code serves traffic.
4. **Rollback** — Render: "Rollback to a previous deploy"; Vercel: promote the previous deployment. Data rollback → defer to `disaster-recovery.md` (Neon PITR). Caution: a deploy that shipped a destructive migration needs a data restore, not just a code rollback.
5. **Render free-tier cold start** — the service sleeps after inactivity; first request after sleep is slow. The app's keep-alive ping (`GET /health` every ~12 min in production, `server.js`) mitigates this.
6. **Security posture note** (consolidates the spec's §2/§3 + residual audit follow-up):
   - **CSRF:** the API authorizes via JWT in the `Authorization` header (never an ambient cookie), so it is not CSRF-susceptible. `express-session` is used only for the OAuth handshake (`httpOnly` + `secure` cookie in prod).
   - **XSS:** defense is layered — React output-encoding, Joi input validation, Helmet CSP. No input-sanitization middleware by design.
   - **Production secret guard:** the backend refuses to start in production if `JWT_SECRET`/`JWT_REFRESH_SECRET`/`SESSION_SECRET` are unset (`utils/validateEnv.js`).
   - **Residual `npm audit` follow-ups (low risk, tracked):** advisories that only resolve via breaking transitive bumps (e.g. `uuid`→14, transitive `qs`/`express`/`cookie`, and the frontend dev/build-chain advisories). Re-evaluate when upgrading Express 5 / the Vite major.

- [ ] **Step 2: Placeholder + secret scan**

Run (from repo root):
```bash
grep -nE "TODO|TBD|FIXME|<your-|placeholder" docs/runbooks/deployment.md   # expect: no output
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git -C e:/GitHub/myCartlyV1 add docs/runbooks/deployment.md
git -C e:/GitHub/myCartlyV1 commit -m "$(printf 'docs(ops): cold-start deployment + rollback runbook\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 7: Close out ROADMAP, CLAUDE.md, and memory

**Files:**
- Modify: `docs/ROADMAP.md` (line 102 status, line 112 `3F`, lines 122–123 workstreams, line 100 phase status)
- Modify: `CLAUDE.md` (after the Phase 3E paragraph)
- Modify: memory files (controller tool, not git)

- [ ] **Step 1: Tick 3F + workstreams in ROADMAP**

In `docs/ROADMAP.md`:
- Line 100: `## Phase 3 — Operational hardening 🟨 in progress (real-money bar)` → `## Phase 3 — Operational hardening ✅ complete (real-money bar)`.
- Line 102: `**Status:** 🟨 In progress (3A–3E complete)` → `**Status:** ✅ Complete (3A–3F)`.
- Line 112: change `- [ ] **3F — Security pass + deployment runbook:** ...` to `- [x]` and append the actuals (dead-dep prune, prod secret guard, audit fix + nodemailer 7, README scrub, `docs/runbooks/deployment.md`) + spec link `[phase3f](superpowers/specs/2026-06-05-phase3f-security-pass-design.md)`.
- Line 122: `- [ ] Security pass over existing Helmet / rate-limit / RBAC / CORS layer` → `- [x] ... *(3F)*`.
- Line 123: `- [ ] Deployment target chosen + documented runbook` → `- [x] ... *(3F — docs/runbooks/deployment.md)*`.

- [ ] **Step 2: Add the 3F note to CLAUDE.md**

In `CLAUDE.md`, immediately after the "**Backups, DR & secrets** (Phase 3E)" paragraph, add a "**Security & deployment** (Phase 3F)" paragraph noting: deprecated `csurf`/`xss-clean` (and other dead deps) removed; the bearer-token API is not CSRF-susceptible (no CSRF middleware) and XSS defense is layered (React encoding + Joi + Helmet CSP); a production secret fail-fast guard (`utils/validateEnv.js`); `npm audit` remediated non-breaking (nodemailer 7); README default passwords removed; cold-start/rollback procedure in `docs/runbooks/deployment.md`.

- [ ] **Step 3: Verify the docs build cleanly (links/placeholder scan)**

Run (from repo root):
```bash
grep -nE "TODO|TBD|FIXME" docs/ROADMAP.md CLAUDE.md   # expect: no NEW Phase-3F-related hits
```

- [ ] **Step 4: Commit**

```bash
git -C e:/GitHub/myCartlyV1 add docs/ROADMAP.md CLAUDE.md
git -C e:/GitHub/myCartlyV1 commit -m "$(printf 'docs: mark Phase 3F + Phase 3 complete (security pass + deploy runbook)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

- [ ] **Step 5: Update project memory (not git)**

Update `phase3-progress-and-security-followup.md` (`description` + add a `**3F complete** (2026-06-05)` bullet; mark Phase 3 done; note README plaintext passwords removed) and the `MEMORY.md` index line. Use the Write tool against `C:\Users\Sam\.claude\projects\E--GitHub-myCartlyV1\memory\`.

---

## Final verification (after all tasks)

- [ ] `git -C e:/GitHub/myCartlyV1 status -s` shows only `?? .claudeignore` (untracked, intentional) — no `.env*` staged.
- [ ] `cd backend && npm test` green; `cd frontend && npm run lint && npm run test:run && npm run build` green.
- [ ] `npm audit` (backend) high/critical reduced vs baseline; residuals documented in `deployment.md`.
- [ ] All Phase 3F commits carry the `Co-Authored-By` trailer.
- [ ] Hand off to the user for the `develop → main` merge (the user performs the merge).
