# Phase 3C — Playwright E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Chromium Playwright E2E suite (buyer COD checkout, admin refund, seller dashboard smoke) that runs against the production frontend build (`vite preview`) + a real seeded backend, and gate it as a separate CI job.

**Architecture:** Playwright lives in `frontend/`. Its `webServer` starts the Express backend (`node ../backend/server.js`, `PORT=5000`, test DB) and `vite preview` (`:4173`); a `globalSetup` seeds the DB (base seed + one PAID order) first. The bundle is built with `VITE_API_URL=http://localhost:5000/api`; the backend runs with `FRONTEND_URL=http://localhost:4173` for CORS. Auth rides on the `accessToken` in `localStorage`.

**Tech Stack:** `@playwright/test` (Chromium), Express + Prisma backend, Vite preview, Postgres.

**Spec:** `docs/superpowers/specs/2026-06-04-phase3c-playwright-e2e-design.md`

**Conventions for the implementer:**
- Windows machine; the Bash tool maps `E:\GitHub\myCartlyV1` → `/e/GitHub/myCartlyV1`. The working dir may drift — prefix commands with `cd /e/GitHub/myCartlyV1/frontend &&` (or `/backend`, or repo root for git).
- A local Postgres is available on host port **5433** (docker; the backend Jest suite uses it). The E2E test DB is `cartly_test` there: `postgresql://cartly:cartlypass@localhost:5433/cartly_test?schema=public`. It is already migrated (the backend suite runs `prisma migrate deploy` against it); if a table is missing, run `cd /e/GitHub/myCartlyV1/backend && npx cross-env DATABASE_URL="postgresql://cartly:cartlypass@localhost:5433/cartly_test?schema=public" prisma migrate deploy`.
- E2E tests run against real app code; a failing assertion likely means a real selector/flow mismatch — **fix the locator to match the running app** (verify with `--ui` or `--headed` / the HTML report), do NOT weaken what is asserted. If the app genuinely misbehaves, report DONE_WITH_CONCERNS.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Stage explicit paths only — never `git add -A`; never stage `.claudeignore` or any `.env*`.

---

## File Structure

**Created:**
- `backend/utils/seedE2E.js` — runs the base seed, then inserts one PAID refundable order (`E2E-REFUND-0001`).
- `frontend/playwright.config.ts` — Playwright config (Chromium, webServer for backend + preview, globalSetup).
- `frontend/e2e/global-setup.ts` — runs `seedE2E.js` against the test DB before the suite.
- `frontend/e2e/helpers.ts` — seeded account constants + `login()` helper.
- `frontend/e2e/buyer-cod.spec.ts` — buyer COD journey.
- `frontend/e2e/admin-refund.spec.ts` — admin refund flow.
- `frontend/e2e/seller-smoke.spec.ts` — seller dashboard smoke.

**Modified:**
- `backend/utils/seeder.js` — refactor so the core seeding is an exported `seedDatabase()` (no `process.exit`), reused by `seedE2E.js`; keep `node utils/seeder.js` behavior via a CLI guard.
- `frontend/package.json` — add `@playwright/test` devDep + `test:e2e` / `test:e2e:ui` scripts.
- `frontend/.gitignore` — ignore Playwright artifacts.
- `.github/workflows/ci.yml` — add the `e2e` job.
- `CLAUDE.md`, `docs/ROADMAP.md` — document 3C.

---

## Task 1: E2E harness (seed, config, helpers)

**Files:**
- Modify: `backend/utils/seeder.js`
- Create: `backend/utils/seedE2E.js`
- Modify: `frontend/package.json`
- Modify: `frontend/.gitignore`
- Create: `frontend/playwright.config.ts`
- Create: `frontend/e2e/global-setup.ts`
- Create: `frontend/e2e/helpers.ts`
- Create (temporary): `frontend/e2e/smoke.spec.ts`

- [ ] **Step 1: Refactor `backend/utils/seeder.js` to export `seedDatabase()`**

The file currently ends with a self-invoking `seedDB()` that calls `prisma.$disconnect()` + `process.exit()` inside. Change the function so the core seeding neither disconnects nor exits, rename it `seedDatabase`, export it, and move connect/disconnect/exit into a CLI guard.

Replace the function signature line:
```js
const seedDB = async () => {
  try {
    await prisma.$connect();
    logger.info('Connected to PostgreSQL (Prisma) for seeding');
```
with:
```js
const seedDatabase = async () => {
  await prisma.$connect();
  logger.info('Connected to PostgreSQL (Prisma) for seeding');
```

Then replace the tail of the function (the block starting at `logger.info('\n✅ Seed completed successfully!\n');` through the closing `};` and the `seedDB();` call) — i.e. replace this:
```js
    logger.info('\n✅ Seed completed successfully!\n');
    logger.info('📋 Test Accounts:');
    logger.info('   Superadmin: superadmin@CartLy.com / Admin@123456');
    logger.info('   Admin:      admin@CartLy.com      / Admin@123456');
    logger.info('   Seller 1:   seller@CartLy.com     / Seller@123456');
    logger.info('   Seller 2:   seller2@CartLy.com    / Seller@123456');
    logger.info('   User:       user@CartLy.com       / User@123456\n');

    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    logger.error(`Seed failed: ${err.message}`);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  }
};

seedDB();
```
with:
```js
    logger.info('\n✅ Seed completed successfully!\n');
    logger.info('📋 Test Accounts:');
    logger.info('   Superadmin: superadmin@CartLy.com / Admin@123456');
    logger.info('   Admin:      admin@CartLy.com      / Admin@123456');
    logger.info('   Seller 1:   seller@CartLy.com     / Seller@123456');
    logger.info('   Seller 2:   seller2@CartLy.com    / Seller@123456');
    logger.info('   User:       user@CartLy.com       / User@123456\n');
  };

// CLI entrypoint: `node utils/seeder.js` (and `npm run seed`) still wipe+seed then exit.
if (require.main === module) {
  seedDatabase()
    .then(() => prisma.$disconnect())
    .then(() => process.exit(0))
    .catch(async (err) => {
      logger.error(`Seed failed: ${err.message}`);
      await prisma.$disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { seedDatabase };
```
Note: the inner `try {` was removed in the first edit, so the function body is no longer wrapped in try/catch (the CLI guard catches). Ensure the body's indentation/braces are valid after the edit (the function now opens with `await prisma.$connect();` and closes with `};` right after the account-log lines).

- [ ] **Step 2: Verify `npm run seed` still works**

Run:
```bash
cd /e/GitHub/myCartlyV1/backend && npx cross-env DATABASE_URL="postgresql://cartly:cartlypass@localhost:5433/cartly_test?schema=public" node utils/seeder.js
```
Expected: logs "Seed completed successfully" and the test-account list, exits 0.

- [ ] **Step 3: Create `backend/utils/seedE2E.js`**

```js
require('dotenv').config();
const { prisma } = require('../config/prisma');
const logger = require('./logger');
const { seedDatabase } = require('./seeder');

// Base seed (users + products), then one PAID, refundable order for the admin-refund E2E.
const seedE2E = async () => {
  await seedDatabase();

  const buyer = await prisma.user.findUnique({ where: { email: 'user@cartly.com' } });
  const product = await prisma.product.findFirst({
    where: { status: 'active' },
    orderBy: { createdAt: 'asc' },
  });
  if (!buyer || !product) throw new Error('seedE2E: expected buyer + product from base seed');

  await prisma.order.create({
    data: {
      orderNumber: 'E2E-REFUND-0001',
      userId: buyer.id,
      shippingAddress: { name: 'Regular User', street: '1 Test St', city: 'Testville', state: 'CA', country: 'US', zipCode: '90001' },
      subtotal: product.price,
      shippingCost: 0,
      taxAmount: 0,
      discountAmount: 0,
      totalPrice: product.price,
      currency: 'USD',
      paymentMethod: 'cod',
      paymentStatus: 'paid',
      paidAt: new Date(),
      status: 'delivered',
      deliveredAt: new Date(),
      paymentResult: { refundedAmount: 0 },
      items: {
        create: [{ productId: product.id, sellerId: product.sellerId, name: product.name, price: product.price, quantity: 1 }],
      },
      statusHistory: { create: [{ status: 'delivered' }] },
    },
  });
  logger.info('E2E seed: created paid refundable order E2E-REFUND-0001');
};

if (require.main === module) {
  seedE2E()
    .then(() => prisma.$disconnect())
    .then(() => process.exit(0))
    .catch(async (err) => {
      logger.error(`E2E seed failed: ${err.message}`);
      await prisma.$disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { seedE2E };
```

- [ ] **Step 4: Run the E2E seed to verify it creates the order**

Run:
```bash
cd /e/GitHub/myCartlyV1/backend && npx cross-env DATABASE_URL="postgresql://cartly:cartlypass@localhost:5433/cartly_test?schema=public" node utils/seedE2E.js
```
Expected: base seed logs + "E2E seed: created paid refundable order E2E-REFUND-0001", exits 0.

- [ ] **Step 5: Install Playwright + add scripts**

```bash
cd /e/GitHub/myCartlyV1/frontend && npm install -D @playwright/test@^1.45.0 && npx playwright install chromium
```
Then add to `frontend/package.json` scripts (after `test:run`):
```json
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
```

- [ ] **Step 6: Ignore Playwright artifacts**

Append to `frontend/.gitignore`:
```
# Playwright
/test-results/
/playwright-report/
/playwright/.cache/
```

- [ ] **Step 7: Create `frontend/playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const API_PORT = 5000;
const PREVIEW_PORT = 4173;
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://cartly:cartlypass@localhost:5433/cartly_test?schema=public';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PREVIEW_PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  globalSetup: path.resolve(__dirname, './e2e/global-setup.ts'),
  webServer: [
    {
      command: 'node ../backend/server.js',
      port: API_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        DATABASE_URL,
        JWT_SECRET: process.env.JWT_SECRET || 'e2e-secret',
        JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'e2e-refresh',
        SESSION_SECRET: process.env.SESSION_SECRET || 'e2e-session',
        FRONTEND_URL: `http://localhost:${PREVIEW_PORT}`,
      },
    },
    {
      command: `npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
      port: PREVIEW_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
```

- [ ] **Step 8: Create `frontend/e2e/global-setup.ts`**

```ts
import { execSync } from 'child_process';
import path from 'path';

// Seed the test DB (base data + one paid order) before the suite runs.
export default async function globalSetup() {
  const backendDir = path.resolve(__dirname, '../../backend');
  execSync('node utils/seedE2E.js', {
    cwd: backendDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL:
        process.env.DATABASE_URL ||
        'postgresql://cartly:cartlypass@localhost:5433/cartly_test?schema=public',
    },
  });
}
```

- [ ] **Step 9: Create `frontend/e2e/helpers.ts`**

```ts
import { Page, expect } from '@playwright/test';

export const ACCOUNTS = {
  buyer: { email: 'user@cartly.com', password: 'User@123456' },
  admin: { email: 'admin@cartly.com', password: 'Admin@123456' },
  seller: { email: 'seller@cartly.com', password: 'Seller@123456' },
};

// Drives the real /login form, then waits for the post-login redirect off /login.
export async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
}
```

- [ ] **Step 10: Create a temporary smoke spec `frontend/e2e/smoke.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('app loads and shows seeded products', async ({ page }) => {
  await page.goto('/products');
  await expect(page.getByText(/Premium Leather Minimalist Wallet/i).first()).toBeVisible({ timeout: 15_000 });
});
```

- [ ] **Step 11: Build the frontend with the E2E API URL, then run the smoke test**

```bash
cd /e/GitHub/myCartlyV1/frontend && VITE_API_URL=http://localhost:5000/api npm run build && npm run test:e2e -- smoke.spec.ts
```
Expected: Playwright starts the backend + preview, globalSetup seeds, and the smoke test PASSES (a seeded product is visible — proving the full stack is wired: build env, CORS, DB seed). If it fails, inspect with `npm run test:e2e -- smoke.spec.ts --headed` or open `playwright-report/`. Common causes: the build didn't bake `VITE_API_URL` (rebuild), or CORS (`FRONTEND_URL` mismatch).

- [ ] **Step 12: Delete the temporary smoke spec**

```bash
cd /e/GitHub/myCartlyV1/frontend && rm e2e/smoke.spec.ts
```

- [ ] **Step 13: Lint check (frontend)**

Run: `cd /e/GitHub/myCartlyV1/frontend && npm run lint`
Expected: exit 0. (The `e2e/` `.ts` files are linted by `eslint .`. If Playwright globals or the config trip a rule, add `e2e/**` + `playwright.config.ts` to the test-file `overrides` block in `frontend/.eslintrc.cjs` — extend the existing `files` array; do not weaken global rules.)

- [ ] **Step 14: Commit**

```bash
cd /e/GitHub/myCartlyV1
git add backend/utils/seeder.js backend/utils/seedE2E.js frontend/package.json frontend/package-lock.json frontend/.gitignore frontend/playwright.config.ts frontend/e2e/global-setup.ts frontend/e2e/helpers.ts
git commit -m "test(e2e): add Playwright harness + E2E seed (paid refundable order)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
(If Step 13 required editing `frontend/.eslintrc.cjs`, add it to the commit.)

---

## Task 2: Buyer COD journey

**Files:**
- Create: `frontend/e2e/buyer-cod.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';
import { login, ACCOUNTS } from './helpers';

test('buyer completes a Cash-on-Delivery checkout', async ({ page }) => {
  await login(page, ACCOUNTS.buyer.email, ACCOUNTS.buyer.password);

  // Browse to a seeded product and add it to the cart.
  await page.goto('/products');
  await page.getByRole('link', { name: /Premium Leather Minimalist Wallet/i }).first().click();
  await expect(page.getByRole('button', { name: /add to cart/i })).toBeVisible();
  await page.getByRole('button', { name: /add to cart/i }).click();

  // Cart: select the item, proceed to checkout.
  await page.goto('/cart');
  await page.locator('input[type="checkbox"]').first().check();
  await page.getByRole('button', { name: /proceed to checkout/i }).click();

  // Shipping (name + country are prefilled; fill the rest by placeholder).
  await page.getByPlaceholder('123 Main St').fill('1 Test St');
  await page.getByPlaceholder('New York').fill('Testville');
  await page.getByPlaceholder('NY').fill('CA');
  await page.getByPlaceholder('10001').fill('90001');
  await page.getByRole('button', { name: /continue to carrier/i }).click();

  // Carrier: keep "No preference" default.
  await page.getByRole('button', { name: /continue to payment/i }).click();

  // Payment: COD is the default (PayPal/GCash are env-gated off in the E2E build).
  await page.getByRole('button', { name: /review order/i }).click();

  // Review: place the order.
  await page.getByRole('button', { name: /place order/i }).click();

  // Lands on the order confirmation/detail page with a CUR-... order number.
  await expect(page).toHaveURL(/\/orders\/[\w-]+$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: /^CUR-/ })).toBeVisible();
});
```

- [ ] **Step 2: Run it**

```bash
cd /e/GitHub/myCartlyV1/frontend && npm run test:e2e -- buyer-cod.spec.ts
```
Expected: PASS. (Playwright reuses/starts servers; globalSetup re-seeds each run, so the buyer's cart starts empty.) If a locator misses, verify the exact text/placeholder against the running app (`--headed` / report) and adjust the locator only — keep the assertions. The order-number heading matches the backend format `CUR-<ts>-<seq>`.

- [ ] **Step 3: Lint + commit**

```bash
cd /e/GitHub/myCartlyV1/frontend && npm run lint
cd /e/GitHub/myCartlyV1 && git add frontend/e2e/buyer-cod.spec.ts && git commit -m "test(e2e): buyer COD checkout journey" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Admin refund flow

**Files:**
- Create: `frontend/e2e/admin-refund.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';
import { login, ACCOUNTS } from './helpers';

test('admin issues a full refund on a paid order', async ({ page }) => {
  await login(page, ACCOUNTS.admin.email, ACCOUNTS.admin.password);

  await page.goto('/admin/orders');

  // The seeded paid order row (E2E-REFUND-0001) is refundable -> has a Refund action.
  const row = page.getByRole('row', { name: /E2E-REFUND-0001/ });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByTitle('Refund').click();

  // Refund dialog -> issue a full refund (blank amount).
  await expect(page.getByRole('heading', { name: /refund order/i })).toBeVisible();
  await page.getByRole('button', { name: /issue refund/i }).click();

  // Dialog closes and the row's payment status reflects the refund.
  await expect(page.getByRole('heading', { name: /refund order/i })).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole('row', { name: /E2E-REFUND-0001/ })).toContainText(/refunded/i);
});
```

- [ ] **Step 2: Run it**

```bash
cd /e/GitHub/myCartlyV1/frontend && npm run test:e2e -- admin-refund.spec.ts
```
Expected: PASS. The COD refund path is provider-less (manual) and transitions `paymentStatus` to `refunded` (full), which the row badge shows after the component re-fetches. If the row isn't found, confirm the seed ran (globalSetup) and that `getByRole('row', ...)` matches the table row text; if needed, fall back to locating the row via `page.locator('tr', { hasText: 'E2E-REFUND-0001' })` — keep the refund assertions.

- [ ] **Step 3: Lint + commit**

```bash
cd /e/GitHub/myCartlyV1/frontend && npm run lint
cd /e/GitHub/myCartlyV1 && git add frontend/e2e/admin-refund.spec.ts && git commit -m "test(e2e): admin full-refund flow" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Seller dashboard smoke

**Files:**
- Create: `frontend/e2e/seller-smoke.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';
import { login, ACCOUNTS } from './helpers';

test('seller dashboard renders for a seller', async ({ page }) => {
  await login(page, ACCOUNTS.seller.email, ACCOUNTS.seller.password);
  await page.goto('/seller/dashboard');
  await expect(page.getByRole('heading', { name: /seller dashboard/i })).toBeVisible({ timeout: 15_000 });
});
```

- [ ] **Step 2: Run it**

```bash
cd /e/GitHub/myCartlyV1/frontend && npm run test:e2e -- seller-smoke.spec.ts
```
Expected: PASS (the `<h1>Seller Dashboard</h1>` is visible). `/seller` redirects to `/seller/dashboard`; the spec navigates there directly.

- [ ] **Step 3: Run the FULL e2e suite together**

```bash
cd /e/GitHub/myCartlyV1/frontend && VITE_API_URL=http://localhost:5000/api npm run build && npm run test:e2e
```
Expected: 3 specs (buyer-cod, admin-refund, seller-smoke) all PASS headless.

- [ ] **Step 4: Lint + commit**

```bash
cd /e/GitHub/myCartlyV1/frontend && npm run lint
cd /e/GitHub/myCartlyV1 && git add frontend/e2e/seller-smoke.spec.ts && git commit -m "test(e2e): seller dashboard smoke" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: CI e2e job + docs

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `CLAUDE.md`
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Add the `e2e` job to `.github/workflows/ci.yml`**

Append this job (sibling of `backend` and `frontend`, same indentation level under `jobs:`):
```yaml
  e2e:
    name: E2E (Playwright)
    needs: [backend, frontend]
    runs-on: ubuntu-latest
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
      JWT_SECRET: ci-e2e-secret
      JWT_REFRESH_SECRET: ci-e2e-refresh
      SESSION_SECRET: ci-e2e-session
      FRONTEND_URL: http://localhost:4173
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - name: Install backend deps
        working-directory: backend
        run: npm ci
      - name: Prisma generate + migrate
        working-directory: backend
        run: npx prisma generate && npx prisma migrate deploy
      - name: Install frontend deps
        working-directory: frontend
        run: npm ci
      - name: Install Playwright (chromium)
        working-directory: frontend
        run: npx playwright install --with-deps chromium
      - name: Build frontend (E2E API URL)
        working-directory: frontend
        run: npm run build
        env:
          VITE_API_URL: http://localhost:5000/api
      - name: Run Playwright E2E
        working-directory: frontend
        run: npm run test:e2e
      - name: Upload Playwright report
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: frontend/playwright-report/
          retention-days: 7
```

- [ ] **Step 2: Update `CLAUDE.md`**

In the **CI** paragraph, after the sentence describing the frontend job, add:
```
A third **e2e** job (`needs:` backend+frontend) runs Playwright (Chromium) against `vite preview` + a real backend on the Postgres service: it builds the frontend with `VITE_API_URL=http://localhost:5000/api`, seeds via `backend/utils/seedE2E.js` (base seed + one paid order `E2E-REFUND-0001`), and runs the buyer-COD / admin-refund / seller-smoke specs (`frontend/e2e/`). Playwright config lives in `frontend/playwright.config.ts` (its `webServer` starts `node ../backend/server.js` on `PORT=5000` + the preview on `:4173`, with `FRONTEND_URL` set for CORS).
```
Also, in the **Frontend** commands list, after the `test:run` line add:
```
- `npm run test:e2e` — Playwright E2E (Chromium); `npm run test:e2e:ui` for the interactive runner. Requires a reachable Postgres (the config defaults to the `cartly_test` DB on host port 5433) and builds are served via `vite preview`.
```

- [ ] **Step 3: Update `docs/ROADMAP.md`**

Change the Phase 3 status line `🟨 In progress (3A + 3B complete)` → `🟨 In progress (3A–3C complete)`. Mark the 3C sub-plan item `[x]` with a detail line:
```
- [x] **3C — Playwright E2E:** Chromium suite (`frontend/e2e/`) against `vite preview` + a seeded real backend. Buyer COD journey, admin full-refund (on a seeded paid order via `backend/utils/seedE2E.js`), seller dashboard smoke. Runs as a separate CI `e2e` job (`needs:` backend+frontend). Spec: superpowers/specs/2026-06-04-phase3c-playwright-e2e-design.md
```
And in **Workstreams**, update the "Frontend test suite" line note to reflect E2E done: change `*(3B/3C)*` → `*(3B done; 3C E2E done)*` (or tick the box if it now fully applies — 3B+3C both complete).

- [ ] **Step 4: Commit**

```bash
cd /e/GitHub/myCartlyV1
git add .github/workflows/ci.yml CLAUDE.md docs/ROADMAP.md
git commit -m "ci+docs: add Playwright e2e CI job; mark Phase 3C complete" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 5: Push and confirm CI is green**

```bash
cd /e/GitHub/myCartlyV1 && git push origin develop
```
Then the controller confirms the run via `gh run watch <id> --exit-status`. Expected: `backend`, `frontend`, and the new `e2e` job all green. If `e2e` fails in CI but passed locally, download the `playwright-report` artifact (or read the job log) to diagnose (common CI-only causes: server startup timing — increase `webServer.timeout`; or a missing env var). Do not mark complete until the `e2e` job is green in CI.

---

## Self-Review

**1. Spec coverage:**
- Playwright + config (Chromium), seeded backend + preview → Task 1 ✓
- `seedE2E.js` with a paid refundable order → Task 1 ✓
- Buyer COD journey → Task 2 ✓
- Admin refund → Task 3 ✓
- Seller smoke → Task 4 ✓
- Separate CI `e2e` job (`needs:` build), report artifact → Task 5 ✓
- Cross-origin plumbing (`VITE_API_URL` build, `FRONTEND_URL` CORS) → Task 1 config + Task 5 build step ✓
- Non-goals (no PayPal/GCash E2E, Chromium-only, no compose) → respected (COD only; one project) ✓
- Done-when (buyer COD + admin refund pass headless in CI; seller smoke) → Tasks 2–5 ✓

**2. Placeholder scan:** No TBD/TODO; every step has concrete code/commands and expected output. Selector-fallback notes are contingencies (the primary locators are grounded in the actual JSX), not placeholders.

**3. Consistency:** `seedDatabase` (exported from seeder.js) is consumed by `seedE2E.js`; `seedE2E` is invoked by `global-setup.ts`. Ports (5000 backend / 4173 preview), `DATABASE_URL`, and `FRONTEND_URL` match across `playwright.config.ts`, `global-setup.ts`, and the CI job. Order number `E2E-REFUND-0001` is created in Task 1 and asserted in Task 3. Account constants/passwords (`User@123456` / `Admin@123456` / `Seller@123456`) match the seeder. Routes `/products`, `/cart`, `/checkout`, `/orders/:id`, `/admin/orders`, `/seller/dashboard` match `App.tsx`.
