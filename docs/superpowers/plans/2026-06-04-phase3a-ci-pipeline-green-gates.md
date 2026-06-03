# Phase 3A — CI Pipeline + Green Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up GitHub Actions CI that gates merges into `main` — backend (Postgres + Prisma + Jest) and frontend (ESLint + typecheck + build) — and fix the two currently-broken frontend gates (missing ESLint config, two TypeScript errors) so the pipeline is green on its first real run.

**Architecture:** Three ordered tasks. First fix the typecheck gate (two TS errors), then introduce the ESLint config and clean the codebase to zero lint problems, then add the CI workflow that runs both gates. Frontend fixes land *before* the workflow so CI is green immediately. No backend code changes — its 189-test Jest suite already exists and just needs wiring into CI.

**Tech Stack:** GitHub Actions, Node 20, PostgreSQL 16 (CI service container), Prisma 5, Jest 29 + Supertest, ESLint 8 (legacy `.eslintrc.cjs`) + `@typescript-eslint` 6 + `eslint-plugin-react-hooks` 4, TypeScript 5 / Vite 5.

**Spec:** `docs/superpowers/specs/2026-06-04-phase3-operational-hardening-design.md` (sub-plan 3A).

## File structure

| File | Action | Responsibility |
|---|---|---|
| `frontend/src/types/index.ts` | Modify | Add the 5 missing optional `SellerProfile` fields (match backend serializer). |
| `frontend/src/pages/seller/EditProduct.tsx` | Modify | Stop passing the non-existent `editId` prop. |
| `frontend/.eslintrc.cjs` | Create | ESLint 8 legacy config wired to installed plugins; the lint gate. |
| 13 frontend source files | Modify | Remove 29 unused imports/vars flagged by ESLint. |
| `.github/workflows/ci.yml` | Create | Two-job CI: backend tests + frontend lint/build. |

## Pre-work facts (verified, do not re-investigate)

- `frontend/npm run lint` script already exists: `eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0`. It fails today only because **no config file exists**.
- `frontend/npm run build` runs `vite build`, which type-checks. It fails today only because of the two TS errors below.
- Backend test command: `cross-env NODE_ENV=test jest --runInBand`. `tests/setup.js` loads `backend/.env.test` (gitignored — **absent in CI**) and runs `npx prisma migrate deploy` in `beforeAll`. So CI must supply DB + secret env itself.
- `backend/.env.test` is gitignored and NOT committed. Required env vars for tests: `NODE_ENV`, `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `SESSION_SECRET`. Redis + Cloudinary are non-fatal (graceful degradation) and not needed.
- The backend `serializeSellerProfile` (`backend/services/userService.js:94-98`) returns the whole `SellerProfile` row minus `id`/`userId`/bank fields — so `storeEmail`, `storePhone`, `returnPolicy`, `shippingPolicy`, `socialLinks` ARE returned to the frontend. The Prisma model (`schema.prisma:150-154`) types them `String?`/`String?`/`String?`/`String?`/`Json?`.
- `AddProductPage` (`frontend/src/pages/seller/AddProduct.tsx`) takes **no props** — it reads `id` from `useParams()` itself and computes `isEdit = !!id`. So `EditProductPage` should render `<AddProductPage />` with no props; the route already supplies `:id`.

---

## Task 1: Fix the two TypeScript errors (typecheck gate)

**Files:**
- Modify: `frontend/src/types/index.ts` (the `SellerProfile` interface, lines 28-40)
- Modify: `frontend/src/pages/seller/EditProduct.tsx`

- [ ] **Step 1: Verify the failing state**

Run: `cd frontend && npx tsc --noEmit`
Expected: FAIL with 8 errors — `EditProduct.tsx(6,26): ... Property 'editId' does not exist` and `Profile.tsx` × 7 (`storeEmail`/`storePhone`/`returnPolicy`/`shippingPolicy`/`socialLinks` do not exist on `SellerProfile`).

- [ ] **Step 2: Add the missing fields to the `SellerProfile` interface**

In `frontend/src/types/index.ts`, replace the `SellerProfile` interface with:

```ts
export interface SellerProfile {
  storeName: string;
  storeBio?: string;
  storeLogo?: string;
  storeBanner?: string;
  storeSlug: string;
  storeEmail?: string;
  storePhone?: string;
  returnPolicy?: string;
  shippingPolicy?: string;
  socialLinks?: {
    website?: string;
    instagram?: string;
    twitter?: string;
  };
  totalSales: number;
  totalRevenue: number;
  rating: number;
  reviewCount: number;
  isApproved: boolean;
  approvedAt?: string;
}
```

(These five additions mirror the backend `serializeSellerProfile` output; `socialLinks` is stored as JSON with `website`/`instagram`/`twitter` keys — see `Profile.tsx` lines 29-31 and `controllers/index.js:120-131`.)

- [ ] **Step 3: Remove the invalid `editId` prop**

Replace the entire contents of `frontend/src/pages/seller/EditProduct.tsx` with:

```tsx
import AddProductPage from './AddProduct';

// AddProductPage reads the :id route param itself (useParams) and switches to
// edit mode when it is present, so this wrapper just renders it.
const EditProductPage = () => <AddProductPage />;

export default EditProductPage;
```

- [ ] **Step 4: Verify typecheck passes**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (no output, exit 0).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/pages/seller/EditProduct.tsx
git commit -m "fix(frontend): resolve pre-existing TS errors (SellerProfile fields, EditProduct prop)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Add ESLint config and clean to zero problems

**Files:**
- Create: `frontend/.eslintrc.cjs`
- Modify: 13 source files (remove 29 unused imports/vars — full list below)

- [ ] **Step 1: Create the ESLint config**

Create `frontend/.eslintrc.cjs`:

```js
module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', 'node_modules', '*.cjs', 'vite.config.ts'],
  rules: {
    // The codebase uses `any` deliberately in axios error handlers / form payloads.
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    // Intentional empty catch blocks (best-effort parses) are allowed.
    'no-empty': ['error', { allowEmptyCatch: true }],
    // Deferred: existing fetch-on-mount effects intentionally omit the fetcher from
    // their dep arrays; auto-"fixing" risks refetch loops. rules-of-hooks stays an error.
    // Revisit when these components gain test coverage in 3B.
    'react-hooks/exhaustive-deps': 'off',
  },
};
```

- [ ] **Step 2: Run lint to see the worklist**

Run: `cd frontend && npm run lint`
Expected: FAIL with exactly **29 problems (29 errors, 0 warnings)** — all `@typescript-eslint/no-unused-vars`, in the 13 files listed in Step 3.

- [ ] **Step 3: Remove each unused import/variable**

Edit each file to delete the unused symbol (remove it from the import list, or delete the declaration). The complete worklist:

| File | Remove |
|---|---|
| `src/components/layout/AdminLayout.tsx` | imports `X`, `Settings` |
| `src/components/layout/Navbar.tsx` | import `Bell` |
| `src/pages/Orders.tsx` | import `Search` |
| `src/pages/ProductDetail.tsx` | import `useNavigate` |
| `src/pages/Register.tsx` | unused `useStateAlias` (line 285) and `useNavigate2` (line 286) |
| `src/pages/admin/Dashboard.tsx` | imports `Legend`, `Clock`, `CheckCircle`, `XCircle`, `Truck`, and type `Order` |
| `src/pages/admin/Products.tsx` | import `Edit2` |
| `src/pages/admin/Users.tsx` | imports `motion`, `Filter`, `Trash2`, `Eye`; the `selectedUser`/`setSelectedUser` state (line 24); unused `label` arg (line 97 — rename to `_label` or remove) |
| `src/pages/seller/AddProduct.tsx` | imports `Plus`, `Image`; unused `watch` from `useForm` destructure (line 48) |
| `src/pages/seller/Dashboard.tsx` | unused `loading` (line 13) |
| `src/pages/seller/Products.tsx` | unused `navigate` (line 11) |
| `src/pages/seller/Profile.tsx` | import `useEffect` (line 1) |
| `src/store/slices/cartSlice.ts` | unused type imports `CartItem` (line 6), `PaginatedResponse` (line 232) |

Notes:
- When removing a named import leaves an import line with remaining used names, keep the line and drop only the unused name. When it empties the line, delete the whole import statement.
- For `Register.tsx` `useStateAlias`/`useNavigate2`: these are dead aliases — delete the declarations. Confirm they are not referenced elsewhere in the file before deleting (`grep` within the file).
- For the `label` arg in `Users.tsx:97`: if it is a destructured/callback param that must stay positional, rename to `_label` (the config ignores `^_`); otherwise remove it.

- [ ] **Step 4: Verify lint passes and the build still type-checks**

Run: `cd frontend && npm run lint`
Expected: PASS (exit 0, no output).

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (removing the unused symbols must not introduce type errors).

- [ ] **Step 5: Verify the production build still succeeds**

Run: `cd frontend && npm run build`
Expected: PASS — Vite build completes and writes `dist/`.

- [ ] **Step 6: Commit**

```bash
git add frontend/.eslintrc.cjs frontend/src
git commit -m "chore(frontend): add ESLint config and clean unused imports (29 fixes)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Add the GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [develop]
  pull_request:
    branches: [main]

jobs:
  backend:
    name: Backend (Prisma + Jest)
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: cartly
          POSTGRES_PASSWORD: cartlypass
          POSTGRES_DB: cartly_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U cartly"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      NODE_ENV: test
      DATABASE_URL: postgresql://cartly:cartlypass@localhost:5432/cartly_test?schema=public
      JWT_ACCESS_SECRET: ci-access-secret
      JWT_REFRESH_SECRET: ci-refresh-secret
      SESSION_SECRET: ci-session-secret
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: backend/package-lock.json
      - run: npm ci
      - run: npx prisma generate
      - run: npm test

  frontend:
    name: Frontend (Lint + Build)
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npm run lint
      - run: npm run build
```

Notes:
- `tests/setup.js` runs `npx prisma migrate deploy` in `beforeAll`, which creates the schema (incl. the `pg_trgm`/`tsvector` migration) against the empty CI database — so no extra migration step is needed before `npm test`. `npx prisma generate` is run explicitly so the client exists before Jest imports it.
- The job-level `env` supplies `DATABASE_URL` + secrets. `tests/setup.js`'s `dotenv.config` looks for the absent `backend/.env.test` and is a harmless no-op, so the job env is what tests use.
- `DATABASE_URL` host port is `5432` (the CI service mapping), not the local `5433`.

- [ ] **Step 2: Verify both lockfiles exist (required by `npm ci` + cache)**

Run: `ls backend/package-lock.json frontend/package-lock.json`
Expected: both paths print.
If either is missing, generate it: `cd <dir> && npm install --package-lock-only`, then `git add <dir>/package-lock.json` and include it in the Step 4 commit.

- [ ] **Step 3: Validate the workflow YAML locally**

Run: `node -e "require('js-yaml')" 2>/dev/null && npx --yes js-yaml .github/workflows/ci.yml >/dev/null && echo "YAML OK" || echo "install js-yaml or eyeball the YAML"`
Expected: `YAML OK` (or visually confirm indentation if the parser is unavailable).

- [ ] **Step 4: Commit and push to develop**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions pipeline (backend tests + frontend lint/build)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin develop
```

- [ ] **Step 5: Verify the workflow runs green on develop**

Run: `gh run list --branch develop --limit 1`
then: `gh run watch` (or `gh run view --log` on the run id)
Expected: both `backend` and `frontend` jobs succeed.
If a job fails, read the logs, fix the cause, commit, push, and re-check before proceeding.

- [ ] **Step 6: Enable branch protection on `main` (manual / documented)**

Branch protection is a GitHub repo setting, not code. Either set it via UI (Settings → Branches → add rule for `main` → "Require status checks to pass" → select `backend` and `frontend`), or via CLI:

```bash
gh api -X PUT repos/:owner/:repo/branches/main/protection \
  -f "required_status_checks[strict]=true" \
  -f "required_status_checks[checks][][context]=backend" \
  -f "required_status_checks[checks][][context]=frontend" \
  -F "enforce_admins=false" \
  -F "required_pull_request_reviews=" \
  -F "restrictions="
```

If repo permissions don't allow this in-session, note it in the completion report as a manual follow-up for the user (the user owns the `main` merge per the develop-only workflow).

---

## Post-implementation: docs + roadmap

- [ ] **Step 1: Update ROADMAP**

In `docs/ROADMAP.md`: change the Phase 3 status from `⬜ Not started` to `🟨 In progress`; mark the CI/CD workstream line (`- [ ] CI/CD: GitHub Actions ...`) as `[x]` with a note "(3A — backend tests + frontend lint/build gating; branch protection on main)".

- [ ] **Step 2: Update CLAUDE.md**

Add a short note under the Commands or a new "CI" line documenting that `.github/workflows/ci.yml` gates merges into `main` (backend Jest on a Postgres service; frontend ESLint + build), and that `frontend/.eslintrc.cjs` is the ESLint config (legacy ESLint 8 format). Mention the previously-pre-existing frontend lint/type errors are now resolved (so future sessions don't treat them as known-broken).

- [ ] **Step 3: Commit docs**

```bash
git add docs/ROADMAP.md CLAUDE.md
git commit -m "docs: mark Phase 3A complete (CI gating live)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin develop
```

---

## Definition of done (3A)

- `frontend/npx tsc --noEmit` passes; `frontend/npm run lint` passes (0 problems); `frontend/npm run build` succeeds.
- `.github/workflows/ci.yml` exists; both jobs run **green** on `develop`.
- Branch protection requires the `backend` + `frontend` checks before merging to `main` (or it's flagged as a manual follow-up for the user).
- Backend Jest suite (189 tests) runs in CI against a fresh Postgres via `prisma migrate deploy`.
- ROADMAP + CLAUDE.md updated.

## Risks & notes

- **CI Postgres extensions:** the Phase 1 init migration creates `pg_trgm`/`tsvector` objects; the stock `postgres:16` image includes the `contrib` extensions, so `CREATE EXTENSION` succeeds. If a migration fails on a missing extension, that's the first thing to check in the logs.
- **Lockfile drift:** `npm ci` requires an in-sync `package-lock.json`. If `npm ci` errors with a lockfile mismatch, run `npm install` in that package, commit the updated lockfile.
- **`no-unused-vars` after deletions:** removing an import can occasionally make another symbol unused (cascade). Re-run `npm run lint` until clean — the worklist may need a second pass on the same file.
- **Branch protection permissions:** if the in-session token can't modify protection, leave it as a documented manual step; do not block 3A completion on it.
