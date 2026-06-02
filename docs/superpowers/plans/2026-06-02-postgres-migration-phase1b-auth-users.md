# Phase 1B — Auth & Users → Prisma Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the authentication read/write path (`authenticate`/`optionalAuth` middleware, full `authController`, Passport strategies) and the user profile/address/become-seller endpoints from Mongoose to PostgreSQL + Prisma, with integration tests asserting the API response envelope is unchanged.

**Architecture:** Strangler-fig. We introduce a Prisma-backed `services/userService.js` that replaces the Mongoose User model's instance methods (password hashing, token generation, progressive lockout, safe serialization) with plain functions, plus a `toReqUser()` adapter that shapes a Prisma user into the object downstream code already expects (`req.user._id`, `req.user.role`, `req.user.sellerProfile`). The auth middleware and controllers are switched to Prisma; everything else stays on Mongoose until its own plan.

**Tech Stack:** Node/Express, Prisma 5.22 (PostgreSQL 16 on host port 5433), bcryptjs, jsonwebtoken, Jest 29 + Supertest 7.

---

## Known interim state (read before starting)

This is a mid-migration plan. After 1B:

- The auth path and `req.user` come from **Postgres** (uuid ids).
- Endpoints still on **Mongoose** that read the authenticated user (`getWishlist`, `getSellerStore`, cart, orders, reviews, admin, warehouse) will **not** resolve a Postgres-issued uuid against Mongo data. This is expected and is fully resolved by **Plan 1F** (seeder rewrite + Mongoose removal). Do **not** "fix" those endpoints here.
- `getMe` returns `wishlist` as an **array of product id strings** (not populated product summaries). Population is restored in **Plan 1C** when `Product` moves to Prisma. This is the only intentional contract drift in 1B and it is documented here.
- Integration tests in this plan only exercise the Prisma-ported endpoints (`/api/auth/*`, `/api/users/profile`, `/api/users/addresses/*`, `/api/users/upgrade-seller`, `/api/users/seller-profile`).

Do **not** delete the Mongoose `User` require lines in `middleware/index.js` or `controllers/index.js` — `auditLog`, `getWishlist`, `getSellerStore`, and other un-ported code still need them. They are removed in 1F.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `backend/prisma/schema.prisma` | Add missing `User` columns `preferences Json?`, `featureFlags Json?`, `wishlist String[]` | Modify |
| `backend/prisma/migrations/<ts>_add_user_prefs_wishlist/` | Migration for the above | Create (generated) |
| `backend/services/userService.js` | Prisma-backed user data access + domain helpers replacing Mongoose instance methods | Create |
| `backend/middleware/index.js` | `authenticate` + `optionalAuth` read user via `userService` | Modify (lines ~25-95) |
| `backend/controllers/authController.js` | All 11 handlers on Prisma | Rewrite |
| `backend/config/passport.js` | JWT + Google strategies + (de)serialize on Prisma | Rewrite |
| `backend/controllers/index.js` | `updateProfile`, `addAddress`, `updateAddress`, `deleteAddress`, `upgradeToSeller`, `updateSellerProfile` on Prisma | Modify |
| `backend/tests/helpers/buildApp.js` | Build an Express app mounting auth + user routers for Supertest | Create |
| `backend/tests/services/userService.test.js` | Unit tests for `userService` | Create |
| `backend/tests/auth.test.js` | Integration tests for `/api/auth/*` | Create |
| `backend/tests/users.test.js` | Integration tests for `/api/users/*` | Create |

---

## Conventions used by every test file

**Email mock** (SMTP is unavailable in tests; `forgotPassword` returns 500 if `sendEmail` throws, so it must be mocked). Put this at the **top** of any test file that triggers email, before other requires:

```js
jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
  emailTemplates: {
    verification: () => ({ subject: 's', html: 'h' }),
    passwordReset: () => ({ subject: 's', html: 'h' }),
    sellerApproval: () => ({ subject: 's', html: 'h' }),
  },
}));
```

**DB cleanup:** `afterEach(async () => { await prisma.user.deleteMany({}); });` — `Address` and `SellerProfile` cascade-delete with the user.

**Run all backend tests:** from `backend/`, `npm test` (alias for `cross-env NODE_ENV=test jest --runInBand`). Single file: `npm test -- auth.test.js`.

---

### Task 1: Add missing User columns to the Prisma schema

The Mongoose `User` has `preferences`, `featureFlags`, and `wishlist` that the user endpoints read/write but the current Prisma schema omits. Add them before porting controllers.

**Files:**
- Modify: `backend/prisma/schema.prisma` (the `model User` block, after the `lastLoginIp` column ~line 100)
- Create: `backend/prisma/migrations/<timestamp>_add_user_prefs_wishlist/migration.sql` (generated)

- [ ] **Step 1: Add the three columns**

In `backend/prisma/schema.prisma`, inside `model User`, add these lines immediately after `lastLoginIp String?`:

```prisma
  preferences  Json?
  featureFlags Json?
  wishlist     String[] @default([])
```

- [ ] **Step 2: Create the migration against the dev database**

Run (from `backend/`):

```bash
npx prisma migrate dev --name add_user_prefs_wishlist
```

Expected: `Your database is now in sync with your schema.` and a new folder under `prisma/migrations/`. Prisma also regenerates the client.

- [ ] **Step 3: Verify the client regenerated**

Run: `npx prisma generate`
Expected: `Generated Prisma Client` with no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(db): add User preferences, featureFlags, wishlist columns"
```

---

### Task 2: userService — password & token helpers

**Files:**
- Create: `backend/services/userService.js`
- Test: `backend/tests/services/userService.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/services/userService.test.js`:

```js
const userService = require('../../services/userService');

describe('userService crypto helpers', () => {
  it('hashes a password so it is not stored in plaintext and verifies it', async () => {
    const hash = await userService.hashPassword('Passw0rd!@');
    expect(hash).not.toBe('Passw0rd!@');
    expect(await userService.comparePassword('Passw0rd!@', hash)).toBe(true);
    expect(await userService.comparePassword('wrong', hash)).toBe(false);
  });

  it('comparePassword returns false when there is no hash', async () => {
    expect(await userService.comparePassword('x', null)).toBe(false);
    expect(await userService.comparePassword('x', undefined)).toBe(false);
  });

  it('generates a password reset token whose hash matches sha256(token)', () => {
    const crypto = require('crypto');
    const { resetToken, hashedToken, expiry } = userService.generatePasswordResetToken();
    expect(hashedToken).toBe(crypto.createHash('sha256').update(resetToken).digest('hex'));
    expect(expiry.getTime()).toBeGreaterThan(Date.now());
  });

  it('generates an email verification token whose hash matches sha256(token)', () => {
    const crypto = require('crypto');
    const { token, hashedToken, expiry } = userService.generateEmailVerificationToken();
    expect(hashedToken).toBe(crypto.createHash('sha256').update(token).digest('hex'));
    expect(expiry.getTime()).toBeGreaterThan(Date.now());
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- userService.test.js`
Expected: FAIL — `Cannot find module '../../services/userService'`.

- [ ] **Step 3: Create the service with these helpers**

Create `backend/services/userService.js`:

```js
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { prisma } = require('../config/prisma');

const SALT_ROUNDS = 12;
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

const DEFAULT_PREFERENCES = {
  currency: 'USD',
  language: 'en',
  notifications: { email: true, push: true, sms: false, orderUpdates: true, promotions: true },
  theme: 'system',
};
const DEFAULT_FEATURE_FLAGS = { newCheckout: false, betaFeatures: false };

const hashPassword = async (plain) => {
  const salt = await bcrypt.genSalt(SALT_ROUNDS);
  return bcrypt.hash(plain, salt);
};

const comparePassword = async (plain, hash) => {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
};

const generatePasswordResetToken = () => {
  const resetToken = crypto.randomBytes(32).toString('hex');
  return { resetToken, hashedToken: sha256(resetToken), expiry: new Date(Date.now() + 10 * 60 * 1000) };
};

const generateEmailVerificationToken = () => {
  const token = crypto.randomBytes(20).toString('hex');
  return { token, hashedToken: sha256(token), expiry: new Date(Date.now() + 24 * 60 * 60 * 1000) };
};

module.exports = {
  prisma,
  DEFAULT_PREFERENCES,
  DEFAULT_FEATURE_FLAGS,
  hashPassword,
  comparePassword,
  generatePasswordResetToken,
  generateEmailVerificationToken,
};
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- userService.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/userService.js backend/tests/services/userService.test.js
git commit -m "feat(users): add userService password & token helpers"
```

---

### Task 3: userService — progressive lockout & changedPasswordAfter

These replace the Mongoose `isLocked` virtual, `incLoginAttempts`, and `changedPasswordAfter` instance methods. `incLoginAttempts` must reproduce the existing behavior exactly: 5 failed attempts trigger a lock; lock durations escalate 3→5→15→30 minutes by `lockCount`; an expired lock starts a fresh round.

**Files:**
- Modify: `backend/services/userService.js`
- Test: `backend/tests/services/userService.test.js`

- [ ] **Step 1: Write the failing test (append to the existing file)**

Append to `backend/tests/services/userService.test.js`:

```js
const { prisma } = require('../../config/prisma');

describe('userService lockout', () => {
  afterEach(async () => { await prisma.user.deleteMany({}); });

  it('isLocked reflects lockUntil', () => {
    expect(userService.isLocked({ lockUntil: null })).toBe(false);
    expect(userService.isLocked({ lockUntil: new Date(Date.now() - 1000) })).toBe(false);
    expect(userService.isLocked({ lockUntil: new Date(Date.now() + 60000) })).toBe(true);
  });

  it('changedPasswordAfter compares seconds correctly', () => {
    const changedAt = new Date('2026-01-01T00:00:00Z');
    const before = Math.floor(changedAt.getTime() / 1000) - 10;
    const after = Math.floor(changedAt.getTime() / 1000) + 10;
    expect(userService.changedPasswordAfter(changedAt, before)).toBe(true);
    expect(userService.changedPasswordAfter(changedAt, after)).toBe(false);
    expect(userService.changedPasswordAfter(null, before)).toBe(false);
  });

  it('locks the account on the 5th failed attempt with a 3-minute first lock', async () => {
    let user = await prisma.user.create({ data: { name: 'L', email: 'lock@test.com', loginAttempts: 4, lockCount: 0 } });
    user = await userService.incLoginAttempts(user);
    expect(user.loginAttempts).toBe(0);
    expect(user.lockCount).toBe(1);
    expect(user.lockUntil).not.toBeNull();
    const mins = Math.round((new Date(user.lockUntil).getTime() - Date.now()) / 60000);
    expect(mins).toBe(3);
  });

  it('increments attempts below the threshold without locking', async () => {
    let user = await prisma.user.create({ data: { name: 'L', email: 'lock2@test.com', loginAttempts: 1 } });
    user = await userService.incLoginAttempts(user);
    expect(user.loginAttempts).toBe(2);
    expect(user.lockUntil).toBeNull();
  });

  it('starts a fresh round when a previous lock has expired', async () => {
    let user = await prisma.user.create({
      data: { name: 'L', email: 'lock3@test.com', loginAttempts: 0, lockCount: 1, lockUntil: new Date(Date.now() - 1000) },
    });
    user = await userService.incLoginAttempts(user);
    expect(user.loginAttempts).toBe(1);
    expect(user.lockUntil).toBeNull();
    expect(user.lockCount).toBe(1); // preserved for escalation
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- userService.test.js`
Expected: FAIL — `userService.isLocked is not a function`.

- [ ] **Step 3: Add the lockout helpers**

In `backend/services/userService.js`, add before `module.exports`:

```js
const LOCK_DURATIONS_MS = [3, 5, 15, 30].map((m) => m * 60 * 1000);

const isLocked = (user) => !!(user.lockUntil && new Date(user.lockUntil).getTime() > Date.now());

const changedPasswordAfter = (passwordChangedAt, jwtIat) => {
  if (!passwordChangedAt) return false;
  const changedTs = Math.floor(new Date(passwordChangedAt).getTime() / 1000);
  return jwtIat < changedTs;
};

const incLoginAttempts = async (user) => {
  // Expired lock — start a new round but keep lockCount for escalation
  if (user.lockUntil && new Date(user.lockUntil).getTime() < Date.now()) {
    return prisma.user.update({ where: { id: user.id }, data: { loginAttempts: 1, lockUntil: null } });
  }

  const newAttempts = (user.loginAttempts || 0) + 1;

  if (newAttempts >= 5 && !isLocked(user)) {
    const lockCount = user.lockCount || 0;
    const durationMs = LOCK_DURATIONS_MS[Math.min(lockCount, LOCK_DURATIONS_MS.length - 1)];
    return prisma.user.update({
      where: { id: user.id },
      data: { lockUntil: new Date(Date.now() + durationMs), loginAttempts: 0, lockCount: { increment: 1 } },
    });
  }

  return prisma.user.update({ where: { id: user.id }, data: { loginAttempts: { increment: 1 } } });
};
```

Then add `isLocked`, `changedPasswordAfter`, `incLoginAttempts` to the `module.exports` object.

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- userService.test.js`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add backend/services/userService.js backend/tests/services/userService.test.js
git commit -m "feat(users): add userService progressive lockout helpers"
```

---

### Task 4: userService — serializers & finders

`toSafeObject` reproduces the Mongoose `toSafeObject()` output shape (including the `_id`/`id` aliases, `isSeller`/`isLocked` virtuals, `oauth.googleId`, and the stripped sensitive fields) so the frontend contract is preserved. `toReqUser` is the object placed on `req.user`. `serializeAddress` shapes an `Address` row with an `_id` alias. Finders centralize the `include` of relations.

**Files:**
- Modify: `backend/services/userService.js`
- Test: `backend/tests/services/userService.test.js`

- [ ] **Step 1: Write the failing test (append)**

Append to `backend/tests/services/userService.test.js`:

```js
describe('userService serializers & finders', () => {
  afterEach(async () => { await prisma.user.deleteMany({}); });

  it('toSafeObject strips secrets and adds _id/id/isSeller aliases', () => {
    const row = {
      id: 'uuid-1', name: 'Jane', email: 'jane@test.com', role: 'seller',
      password: 'HASH', refreshToken: 'RT', passwordResetToken: 'PRT',
      emailVerificationToken: 'EVT', loginAttempts: 3, lockUntil: null,
      avatar: null, isEmailVerified: true, isActive: true, isBanned: false,
      preferences: { currency: 'USD' }, wishlist: ['p1'], featureFlags: { newCheckout: false },
      addresses: [{ id: 'a1', label: 'Home', street: 'S', city: 'C', state: 'ST', country: 'US', zipCode: '1', isDefault: true }],
      sellerProfile: { storeName: 'Shop', isApproved: true, bankAccountNumber: 'SECRET' },
      googleId: 'g1', createdAt: new Date(), updatedAt: new Date(),
    };
    const safe = userService.toSafeObject(row);
    expect(safe._id).toBe('uuid-1');
    expect(safe.id).toBe('uuid-1');
    expect(safe.isSeller).toBe(true);
    expect(safe.password).toBeUndefined();
    expect(safe.refreshToken).toBeUndefined();
    expect(safe.passwordResetToken).toBeUndefined();
    expect(safe.emailVerificationToken).toBeUndefined();
    expect(safe.loginAttempts).toBeUndefined();
    expect(safe.oauth).toEqual({ googleId: 'g1' });
    expect(safe.addresses[0]._id).toBe('a1');
    expect(safe.sellerProfile.bankAccountNumber).toBeUndefined(); // bank fields never leak
    expect(safe.wishlist).toEqual(['p1']);
  });

  it('findByEmail lowercases and includes relations', async () => {
    await prisma.user.create({ data: { name: 'Jane', email: 'mixed@test.com', addresses: { create: { street: 'S', city: 'C', state: 'ST', zipCode: '1' } } } });
    const found = await userService.findByEmail('MIXED@test.com');
    expect(found).not.toBeNull();
    expect(found.addresses).toHaveLength(1);
  });

  it('findById includes addresses and sellerProfile', async () => {
    const u = await prisma.user.create({ data: { name: 'Jane', email: 'byid@test.com' } });
    const found = await userService.findById(u.id);
    expect(found.id).toBe(u.id);
    expect(found).toHaveProperty('addresses');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- userService.test.js`
Expected: FAIL — `userService.toSafeObject is not a function`.

- [ ] **Step 3: Add serializers & finders**

In `backend/services/userService.js`, add before `module.exports`:

```js
const RELATIONS = { addresses: true, sellerProfile: true };

const isSellerRole = (role) => ['seller', 'admin', 'superadmin'].includes(role);

const serializeAddress = (a) => ({
  _id: a.id,
  id: a.id,
  label: a.label,
  street: a.street,
  city: a.city,
  state: a.state,
  country: a.country,
  zipCode: a.zipCode,
  isDefault: a.isDefault,
});

const serializeSellerProfile = (p) => {
  if (!p) return undefined;
  const { id, userId, bankAccountNumber, bankRoutingNumber, bankName, ...rest } = p;
  return rest; // bank fields intentionally omitted, matching Mongoose toSafeObject
};

const toSafeObject = (user) => {
  if (!user) return null;
  return {
    _id: user.id,
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar ?? null,
    avatarPublicId: user.avatarPublicId ?? undefined,
    phone: user.phone ?? undefined,
    dateOfBirth: user.dateOfBirth ?? undefined,
    gender: user.gender ?? undefined,
    addresses: (user.addresses || []).map(serializeAddress),
    sellerProfile: serializeSellerProfile(user.sellerProfile),
    oauth: { googleId: user.googleId ?? undefined },
    isEmailVerified: user.isEmailVerified,
    isActive: user.isActive,
    isBanned: user.isBanned,
    banReason: user.banReason ?? undefined,
    preferences: user.preferences ?? undefined,
    wishlist: user.wishlist || [],
    featureFlags: user.featureFlags ?? undefined,
    lastLoginAt: user.lastLoginAt ?? undefined,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    isSeller: isSellerRole(user.role),
    isLocked: isLocked(user),
  };
};

// req.user must keep the shape downstream Mongoose code reads (_id, role, sellerProfile.isApproved, _id.toString()).
const toReqUser = toSafeObject;

const findById = (id) => prisma.user.findUnique({ where: { id }, include: RELATIONS });

const findByEmail = (email) =>
  prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() }, include: RELATIONS });

const pickAddressFields = (body) => {
  const out = {};
  ['label', 'street', 'city', 'state', 'country', 'zipCode', 'isDefault'].forEach((f) => {
    if (body[f] !== undefined) out[f] = body[f];
  });
  return out;
};
```

Add `serializeAddress`, `serializeSellerProfile`, `toSafeObject`, `toReqUser`, `findById`, `findByEmail`, `pickAddressFields`, `isSellerRole` to `module.exports`.

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- userService.test.js`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add backend/services/userService.js backend/tests/services/userService.test.js
git commit -m "feat(users): add userService serializers and finders"
```

---

### Task 5: Integration test harness (buildApp helper)

**Files:**
- Create: `backend/tests/helpers/buildApp.js`

- [ ] **Step 1: Create the helper**

Create `backend/tests/helpers/buildApp.js`:

```js
require('express-async-errors');
const express = require('express');
const cookieParser = require('cookie-parser');
const { authRouter, userRouter } = require('../../routes/index');
const { errorHandler, notFound, addRequestMetadata } = require('../../middleware/index');

// Minimal app for Supertest — mounts only the routers under test in Phase 1B.
function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(cookieParser());
  app.use(addRequestMetadata);
  app.use('/api/auth', authRouter);
  app.use('/api/users', userRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { buildApp };
```

- [ ] **Step 2: Smoke-test that the app builds and a public route 404s cleanly**

Create `backend/tests/helpers/buildApp.smoke.test.js`:

```js
const request = require('supertest');
const { buildApp } = require('./buildApp');

it('builds an app and returns the JSON envelope on unknown route', async () => {
  const app = buildApp();
  const res = await request(app).get('/api/auth/does-not-exist');
  expect(res.status).toBe(404);
  expect(res.body).toHaveProperty('success', false);
});
```

- [ ] **Step 3: Run it**

Run: `npm test -- buildApp.smoke.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/helpers
git commit -m "test(users): add Supertest app harness"
```

---

### Task 6: Port authenticate + optionalAuth to Prisma

**Files:**
- Modify: `backend/middleware/index.js` (`authenticate` ~lines 25-72, `optionalAuth` ~lines 75-95; add a require near the other requires ~line 14)
- Test: `backend/tests/auth.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/auth.test.js`:

```js
jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
  emailTemplates: {
    verification: () => ({ subject: 's', html: 'h' }),
    passwordReset: () => ({ subject: 's', html: 'h' }),
    sellerApproval: () => ({ subject: 's', html: 'h' }),
  },
}));

const request = require('supertest');
const { buildApp } = require('./helpers/buildApp');
const { prisma } = require('../config/prisma');
const { generateTokenPair } = require('../utils/jwt');

const app = buildApp();

describe('authenticate middleware (via GET /api/auth/me)', () => {
  afterEach(async () => { await prisma.user.deleteMany({}); });

  it('rejects requests with no token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects an invalid token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
  });

  it('accepts a valid token and resolves the Postgres user', async () => {
    const user = await prisma.user.create({ data: { name: 'Auth', email: 'auth@test.com', role: 'user' } });
    const { accessToken } = generateTokenPair(user.id, user.role);
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe(user.id);
    expect(res.body.data.email).toBe('auth@test.com');
  });

  it('403s a banned user', async () => {
    const user = await prisma.user.create({ data: { name: 'B', email: 'banned@test.com', isBanned: true, banReason: 'spam' } });
    const { accessToken } = generateTokenPair(user.id, user.role);
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
  });
});
```

> Note: this test also exercises `getMe`, which Task 8 ports. Run the full `getMe`-dependent assertions after Task 8; until then expect the two token-presence tests (no token / invalid token) to pass and the "valid token" test to fail at the controller. That is acceptable — the middleware behavior (401s) is what Task 6 verifies. Re-run after Task 8 for green across the file.

- [ ] **Step 2: Run the token-presence tests and watch them fail (middleware still on Mongoose)**

Run: `npm test -- auth.test.js -t "no token"`
Expected: with Mongo not connected, `authenticate` currently throws when it reaches `User.findById`. After porting it will cleanly 401. (The "no token" path 401s before any DB call, so it may already pass — the real proof is the "valid token" path in Step 4.)

- [ ] **Step 3: Port the middleware**

In `backend/middleware/index.js`, add near the existing requires (after line ~18):

```js
const userService = require('../services/userService');
```

Replace the body of `authenticate` between fetching the user and `next()` (currently lines ~49-62) with:

```js
    // Fetch user (PostgreSQL via Prisma)
    const user = await userService.findById(decoded.id);
    if (!user) return next(ApiError.unauthorized('User not found'));
    if (!user.isActive) return next(ApiError.forbidden('Account is deactivated'));
    if (user.isBanned) return next(ApiError.forbidden(`Account banned: ${user.banReason}`));

    // Check if password changed after token was issued
    if (userService.changedPasswordAfter(user.passwordChangedAt, decoded.iat)) {
      return next(ApiError.unauthorized('Password changed recently. Please log in again.'));
    }

    req.user = userService.toReqUser(user);
    req.token = token;
    next();
```

Replace the `if (token) { ... }` block in `optionalAuth` (currently lines ~84-90) with:

```js
    if (token) {
      const decoded = verifyAccessToken(token);
      const user = await userService.findById(decoded.id);
      if (user && user.isActive && !user.isBanned) {
        req.user = userService.toReqUser(user);
      }
    }
```

- [ ] **Step 4: Run the middleware tests that don't need the controller**

Run: `npm test -- auth.test.js -t "no token"` and `npm test -- auth.test.js -t "invalid token"`
Expected: PASS. (Full file goes green after Task 8.)

- [ ] **Step 5: Commit**

```bash
git add backend/middleware/index.js backend/tests/auth.test.js
git commit -m "feat(auth): authenticate/optionalAuth read user via Prisma"
```

---

### Task 7: Port authController — register & login

**Files:**
- Rewrite: `backend/controllers/authController.js`
- Test: `backend/tests/auth.test.js`

- [ ] **Step 1: Write the failing tests (append to auth.test.js)**

Append to `backend/tests/auth.test.js`:

```js
const VALID = { name: 'Jane Doe', email: 'jane@test.com', password: 'Passw0rd!@', confirmPassword: 'Passw0rd!@' };

describe('POST /api/auth/register', () => {
  afterEach(async () => { await prisma.user.deleteMany({}); });

  it('creates a user and returns the standard envelope', async () => {
    const res = await request(app).post('/api/auth/register').send(VALID);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ statusCode: 201, success: true });
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.data.user.email).toBe('jane@test.com');
    expect(res.body.data.user.password).toBeUndefined();
    expect(res.body.data.user._id).toBeDefined();
    expect(res.body.data.accessToken).toBeDefined();
    const inDb = await prisma.user.findUnique({ where: { email: 'jane@test.com' } });
    expect(inDb.password).not.toBe(VALID.password);
    expect(inDb.preferences).toMatchObject({ currency: 'USD' });
  });

  it('rejects a duplicate email with 409', async () => {
    await request(app).post('/api/auth/register').send(VALID);
    const res = await request(app).post('/api/auth/register').send(VALID);
    expect(res.status).toBe(409);
  });
});

describe('POST /api/auth/login', () => {
  afterEach(async () => { await prisma.user.deleteMany({}); });

  it('logs in with correct credentials', async () => {
    await request(app).post('/api/auth/register').send(VALID);
    const res = await request(app).post('/api/auth/login').send({ email: 'jane@test.com', password: 'Passw0rd!@' });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.user._id).toBeDefined();
  });

  it('401s on a wrong password and increments attempts', async () => {
    await request(app).post('/api/auth/register').send(VALID);
    const res = await request(app).post('/api/auth/login').send({ email: 'jane@test.com', password: 'wrongpass' });
    expect(res.status).toBe(401);
    const inDb = await prisma.user.findUnique({ where: { email: 'jane@test.com' } });
    expect(inDb.loginAttempts).toBe(1);
  });

  it('401s on an unknown email', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@test.com', password: 'whatever' });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `npm test -- auth.test.js -t "register"`
Expected: FAIL — controller still calls Mongoose (`User.findOne`), which hangs/errors with no Mongo connection.

- [ ] **Step 3: Rewrite the controller header + sendTokens + register + login**

Rewrite the top of `backend/controllers/authController.js` (replace the Mongoose `require('../models/User')` and the `sendTokens` helper, then `register` and `login`). Header:

```js
const crypto = require('crypto');
const { prisma } = require('../config/prisma');
const userService = require('../services/userService');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { authLimiter } = require('../middleware');
const {
  generateTokenPair,
  verifyRefreshToken,
  getAccessTokenCookieOptions,
  getRefreshTokenCookieOptions,
} = require('../utils/jwt');
const { cache } = require('../config/redis');
const { sendEmail, emailTemplates } = require('../utils/email');
const logger = require('../utils/logger');

// Helper: persist refresh token, set cookies, return the safe user + tokens.
const sendTokens = async (user, statusCode, res, message) => {
  const { accessToken, refreshToken } = generateTokenPair(user.id, user.role);
  const hashedRefresh = crypto.createHash('sha256').update(refreshToken).digest('hex');
  await prisma.user.update({ where: { id: user.id }, data: { refreshToken: hashedRefresh, lastLoginAt: new Date() } });

  res.cookie('accessToken', accessToken, getAccessTokenCookieOptions());
  res.cookie('refreshToken', refreshToken, getRefreshTokenCookieOptions());

  return ApiResponse.success(res, { user: userService.toSafeObject(user), accessToken, refreshToken }, message, statusCode);
};
```

`register`:

```js
const register = async (req, res, next) => {
  try {
    const { name, password } = req.body;
    const email = String(req.body.email).toLowerCase().trim();

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) return next(ApiError.conflict('Email already registered'));

    const { token, hashedToken, expiry } = userService.generateEmailVerificationToken();
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: await userService.hashPassword(password),
        emailVerificationToken: hashedToken,
        emailVerificationExpiry: expiry,
        preferences: userService.DEFAULT_PREFERENCES,
        featureFlags: userService.DEFAULT_FEATURE_FLAGS,
      },
    });

    try {
      const { subject, html } = emailTemplates.verification(name, token, process.env.FRONTEND_URL);
      await sendEmail({ to: email, subject, html });
    } catch (emailErr) {
      logger.error(`Failed to send verification email: ${emailErr.message}`);
    }

    logger.info(`New user registered: ${email}`);
    return sendTokens(user, 201, res, 'Registration successful. Please verify your email.');
  } catch (err) { next(err); }
};
```

`login`:

```js
const login = async (req, res, next) => {
  try {
    const password = req.body.password;
    const user = await userService.findByEmail(req.body.email);
    if (!user) return next(ApiError.unauthorized('Invalid email or password'));

    if (userService.isLocked(user)) {
      const lockMins = Math.ceil((new Date(user.lockUntil).getTime() - Date.now()) / 60000);
      const lockCount = user.lockCount || 0;
      if (lockCount >= 4) {
        return next(ApiError.tooMany(
          `Account locked. Try again in ${lockMins} minute${lockMins !== 1 ? 's' : ''}, or reset your password to regain access immediately.`,
          [{ suggestPasswordReset: true }]
        ));
      }
      return next(ApiError.tooMany(`Account locked. Try again in ${lockMins} minute${lockMins !== 1 ? 's' : ''}`));
    }

    if (!user.password) return next(ApiError.badRequest('Please use social login for this account'));

    const isPasswordValid = await userService.comparePassword(password, user.password);
    if (!isPasswordValid) {
      await userService.incLoginAttempts(user);
      return next(ApiError.unauthorized('Invalid email or password'));
    }

    if (!user.isActive) return next(ApiError.forbidden('Account is deactivated'));
    if (user.isBanned) return next(ApiError.forbidden(`Account banned: ${user.banReason}`));

    if (user.loginAttempts > 0 || user.lockCount > 0) {
      await prisma.user.update({ where: { id: user.id }, data: { loginAttempts: 0, lockCount: 0, lockUntil: null } });
    }

    try { authLimiter.resetKey(req.ip); } catch { /* no-op in tests */ }
    logger.info(`User logged in: ${user.email}`);
    return sendTokens(user, 200, res, 'Login successful');
  } catch (err) { next(err); }
};
```

Leave the remaining handlers as-is for now (they are ported in Tasks 8-10). Keep the existing `module.exports` block at the bottom unchanged.

- [ ] **Step 4: Run and watch pass**

Run: `npm test -- auth.test.js -t "register"` then `npm test -- auth.test.js -t "login"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/authController.js backend/tests/auth.test.js
git commit -m "feat(auth): port register & login to Prisma"
```

---

### Task 8: Port authController — logout, refresh, getMe

**Files:**
- Modify: `backend/controllers/authController.js`
- Test: `backend/tests/auth.test.js`

- [ ] **Step 1: Write the failing tests (append)**

Append to `backend/tests/auth.test.js`:

```js
async function registerAndToken() {
  const res = await request(app).post('/api/auth/register').send(VALID);
  return res.body.data.accessToken;
}

describe('GET /api/auth/me', () => {
  afterEach(async () => { await prisma.user.deleteMany({}); });
  it('returns the current user', async () => {
    const token = await registerAndToken();
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('jane@test.com');
    expect(res.body.data.wishlist).toEqual([]); // id-only until Plan 1C
  });
});

describe('POST /api/auth/logout', () => {
  afterEach(async () => { await prisma.user.deleteMany({}); });
  it('clears the stored refresh token', async () => {
    const token = await registerAndToken();
    const res = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const inDb = await prisma.user.findUnique({ where: { email: 'jane@test.com' } });
    expect(inDb.refreshToken).toBeNull();
  });
});

describe('POST /api/auth/refresh', () => {
  afterEach(async () => { await prisma.user.deleteMany({}); });
  it('issues a new token pair from a valid refresh cookie', async () => {
    const reg = await request(app).post('/api/auth/register').send(VALID);
    const refresh = reg.body.data.refreshToken;
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: refresh });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
  });
  it('401s when no refresh token is supplied', async () => {
    const res = await request(app).post('/api/auth/refresh').send({});
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `npm test -- auth.test.js -t "logout"`
Expected: FAIL — `logout` still calls Mongoose `User.findByIdAndUpdate`.

- [ ] **Step 3: Port the three handlers**

In `backend/controllers/authController.js`, replace `logout`, `refreshToken`, and `getMe`:

```js
const logout = async (req, res, next) => {
  try {
    if (req.token) {
      const decoded = require('jsonwebtoken').decode(req.token);
      const ttl = decoded ? decoded.exp - Math.floor(Date.now() / 1000) : 900;
      await cache.blacklistToken(req.token, ttl > 0 ? ttl : 900);
    }
    await prisma.user.update({ where: { id: req.user._id }, data: { refreshToken: null } });
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    return ApiResponse.success(res, null, 'Logged out successfully');
  } catch (err) { next(err); }
};

const refreshToken = async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!token) return next(ApiError.unauthorized('Refresh token required'));

    let decoded;
    try {
      decoded = verifyRefreshToken(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return next(ApiError.unauthorized('Refresh token expired. Please log in again.'));
      }
      return next(err);
    }

    const user = await userService.findById(decoded.id);
    if (!user) return next(ApiError.unauthorized('User not found'));

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    if (user.refreshToken !== hashedToken) {
      return next(ApiError.unauthorized('Invalid refresh token'));
    }

    return sendTokens(user, 200, res, 'Token refreshed');
  } catch (err) { next(err); }
};

const getMe = async (req, res, next) => {
  try {
    // NOTE: wishlist is returned as id strings until Plan 1C re-adds product population.
    const user = await userService.findById(req.user._id);
    return ApiResponse.success(res, userService.toSafeObject(user), 'User fetched');
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Run and watch pass**

Run: `npm test -- auth.test.js`
Expected: PASS for me/logout/refresh and the Task 6 middleware tests now all green.

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/authController.js backend/tests/auth.test.js
git commit -m "feat(auth): port logout, refresh, getMe to Prisma"
```

---

### Task 9: Port authController — forgot/reset/verify/change/resend

**Files:**
- Modify: `backend/controllers/authController.js`
- Test: `backend/tests/auth.test.js`

- [ ] **Step 1: Write the failing tests (append)**

Append to `backend/tests/auth.test.js`:

```js
describe('password reset & email verification flows', () => {
  afterEach(async () => { await prisma.user.deleteMany({}); });

  it('forgot-password always 200s, even for unknown emails (no enumeration)', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@test.com' });
    expect(res.status).toBe(200);
  });

  it('forgot-password stores a reset token for a known user', async () => {
    await request(app).post('/api/auth/register').send(VALID);
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'jane@test.com' });
    expect(res.status).toBe(200);
    const inDb = await prisma.user.findUnique({ where: { email: 'jane@test.com' } });
    expect(inDb.passwordResetToken).not.toBeNull();
  });

  it('reset-password sets a new password for a valid token', async () => {
    await request(app).post('/api/auth/register').send(VALID);
    const user = await prisma.user.findUnique({ where: { email: 'jane@test.com' } });
    const crypto = require('crypto');
    const raw = crypto.randomBytes(32).toString('hex');
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordResetToken: crypto.createHash('sha256').update(raw).digest('hex'), passwordResetExpiry: new Date(Date.now() + 600000) },
    });
    const res = await request(app).put(`/api/auth/reset-password/${raw}`).send({ password: 'NewPassw0rd!@' });
    expect(res.status).toBe(200);
    const login = await request(app).post('/api/auth/login').send({ email: 'jane@test.com', password: 'NewPassw0rd!@' });
    expect(login.status).toBe(200);
  });

  it('reset-password 400s for an invalid token', async () => {
    const res = await request(app).put('/api/auth/reset-password/bogus').send({ password: 'NewPassw0rd!@' });
    expect(res.status).toBe(400);
  });

  it('verify-email marks the user verified', async () => {
    await request(app).post('/api/auth/register').send(VALID);
    const user = await prisma.user.findUnique({ where: { email: 'jane@test.com' } });
    const crypto = require('crypto');
    const raw = crypto.randomBytes(20).toString('hex');
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerificationToken: crypto.createHash('sha256').update(raw).digest('hex'), emailVerificationExpiry: new Date(Date.now() + 600000) },
    });
    const res = await request(app).get(`/api/auth/verify-email/${raw}`);
    expect(res.status).toBe(200);
    const inDb = await prisma.user.findUnique({ where: { email: 'jane@test.com' } });
    expect(inDb.isEmailVerified).toBe(true);
  });

  it('change-password updates the password for an authenticated user', async () => {
    const token = await registerAndToken();
    const res = await request(app).put('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'Passw0rd!@', newPassword: 'Another1!@' });
    expect(res.status).toBe(200);
    const login = await request(app).post('/api/auth/login').send({ email: 'jane@test.com', password: 'Another1!@' });
    expect(login.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `npm test -- auth.test.js -t "forgot-password"`
Expected: FAIL — Mongoose calls.

- [ ] **Step 3: Port the five handlers**

In `backend/controllers/authController.js`, replace `forgotPassword`, `resetPassword`, `verifyEmail`, `changePassword`, `resendVerification`:

```js
const forgotPassword = async (req, res, next) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return ApiResponse.success(res, null, 'If that email exists, a reset link has been sent');

    const { resetToken, hashedToken, expiry } = userService.generatePasswordResetToken();
    await prisma.user.update({ where: { id: user.id }, data: { passwordResetToken: hashedToken, passwordResetExpiry: expiry } });

    try {
      const { subject, html } = emailTemplates.passwordReset(user.name, resetToken, process.env.FRONTEND_URL);
      await sendEmail({ to: email, subject, html });
    } catch (emailErr) {
      await prisma.user.update({ where: { id: user.id }, data: { passwordResetToken: null, passwordResetExpiry: null } });
      return next(ApiError.internal('Failed to send reset email'));
    }

    return ApiResponse.success(res, null, 'Password reset email sent');
  } catch (err) { next(err); }
};

const resetPassword = async (req, res, next) => {
  try {
    const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');
    const user = await prisma.user.findFirst({
      where: { passwordResetToken: hashedToken, passwordResetExpiry: { gt: new Date() } },
    });
    if (!user) return next(ApiError.badRequest('Invalid or expired reset token'));

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: await userService.hashPassword(req.body.password),
        passwordChangedAt: new Date(Date.now() - 1000),
        passwordResetToken: null,
        passwordResetExpiry: null,
        loginAttempts: 0,
        lockUntil: null,
        lockCount: 0,
      },
    });

    const fresh = await userService.findById(user.id);
    logger.info(`Password reset for: ${user.email}`);
    return sendTokens(fresh, 200, res, 'Password reset successful');
  } catch (err) { next(err); }
};

const verifyEmail = async (req, res, next) => {
  try {
    const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');
    const user = await prisma.user.findFirst({
      where: { emailVerificationToken: hashedToken, emailVerificationExpiry: { gt: new Date() } },
    });
    if (!user) return next(ApiError.badRequest('Invalid or expired verification token'));

    // Idempotent: leave the token in place until natural expiry so repeat clicks still succeed.
    if (!user.isEmailVerified) {
      await prisma.user.update({ where: { id: user.id }, data: { isEmailVerified: true } });
    }

    return ApiResponse.success(res, null, 'Email verified successfully');
  } catch (err) { next(err); }
};

const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user._id } });

    if (!user.password) return next(ApiError.badRequest('Cannot change password for social accounts'));

    const isValid = await userService.comparePassword(currentPassword, user.password);
    if (!isValid) return next(ApiError.unauthorized('Current password is incorrect'));

    await prisma.user.update({
      where: { id: user.id },
      data: { password: await userService.hashPassword(newPassword), passwordChangedAt: new Date(Date.now() - 1000) },
    });

    logger.info(`Password changed for: ${user.email}`);
    return ApiResponse.success(res, null, 'Password changed successfully');
  } catch (err) { next(err); }
};

const resendVerification = async (req, res, next) => {
  try {
    if (req.user.isEmailVerified) return next(ApiError.badRequest('Email is already verified'));

    const { token, hashedToken, expiry } = userService.generateEmailVerificationToken();
    const user = await prisma.user.update({
      where: { id: req.user._id },
      data: { emailVerificationToken: hashedToken, emailVerificationExpiry: expiry },
    });

    const { subject, html } = emailTemplates.verification(user.name, token, process.env.FRONTEND_URL);
    await sendEmail({ to: user.email, subject, html });

    return ApiResponse.success(res, null, 'Verification email resent');
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Run and watch pass**

Run: `npm test -- auth.test.js`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/authController.js backend/tests/auth.test.js
git commit -m "feat(auth): port password reset, email verify, change/resend to Prisma"
```

---

### Task 10: Port Passport strategies + oauthCallback

OAuth can't be end-to-end tested without Google, so we test the Google verify callback's user-creation logic directly and `oauthCallback` with a stubbed `req.user`.

**Files:**
- Rewrite: `backend/config/passport.js`
- Modify: `backend/controllers/authController.js` (`oauthCallback`)
- Test: `backend/tests/passport.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/passport.test.js`:

```js
const { prisma } = require('../config/prisma');
const { googleVerify } = require('../config/passport');

describe('Google OAuth verify callback (Prisma)', () => {
  afterEach(async () => { await prisma.user.deleteMany({}); });

  const profile = { id: 'g-123', displayName: 'Gmail User', emails: [{ value: 'GUSER@test.com' }], photos: [{ value: 'http://pic' }] };

  it('creates a new verified user on first Google login', async () => {
    await new Promise((resolve, reject) => {
      googleVerify('at', 'rt', profile, (err, user) => {
        try {
          expect(err).toBeFalsy();
          expect(user.googleId).toBe('g-123');
          expect(user.email).toBe('guser@test.com');
          expect(user.isEmailVerified).toBe(true);
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });

  it('links googleId to an existing email account', async () => {
    await prisma.user.create({ data: { name: 'Existing', email: 'guser@test.com' } });
    await new Promise((resolve, reject) => {
      googleVerify('at', 'rt', profile, async (err, user) => {
        try {
          expect(err).toBeFalsy();
          expect(user.googleId).toBe('g-123');
          const count = await prisma.user.count();
          expect(count).toBe(1); // linked, not duplicated
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `npm test -- passport.test.js`
Expected: FAIL — `googleVerify` is not exported / passport uses Mongoose.

- [ ] **Step 3: Rewrite passport.js**

Replace `backend/config/passport.js`:

```js
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const JwtStrategy = require('passport-jwt').Strategy;
const { ExtractJwt } = require('passport-jwt');
const crypto = require('crypto');
const { prisma } = require('./prisma');
const userService = require('../services/userService');
const logger = require('../utils/logger');

// JWT Strategy — for protected API routes that use passport
passport.use(
  'jwt',
  new JwtStrategy(
    {
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req) => req?.cookies?.accessToken || null,
      ]),
      secretOrKey: process.env.JWT_SECRET,
      passReqToCallback: true,
    },
    async (req, payload, done) => {
      try {
        const user = await prisma.user.findUnique({ where: { id: payload.id } });
        if (!user || !user.isActive) return done(null, false, { message: 'User not found or inactive' });
        return done(null, user);
      } catch (err) {
        return done(err, false);
      }
    }
  )
);

// Exported so it can be unit-tested without a live Google round-trip.
const googleVerify = async (accessToken, refreshToken, profile, done) => {
  try {
    let user = await prisma.user.findFirst({ where: { googleId: profile.id } });

    if (!user) {
      const email = String(profile.emails[0].value).toLowerCase();
      user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        user = await prisma.user.update({ where: { id: user.id }, data: { googleId: profile.id } });
      } else {
        user = await prisma.user.create({
          data: {
            name: profile.displayName,
            email,
            avatar: profile.photos?.[0]?.value,
            googleId: profile.id,
            isEmailVerified: true,
            password: await userService.hashPassword(crypto.randomBytes(16).toString('hex')),
            preferences: userService.DEFAULT_PREFERENCES,
            featureFlags: userService.DEFAULT_FEATURE_FLAGS,
          },
        });
      }
    }

    return done(null, user);
  } catch (err) {
    logger.error(`Google OAuth error: ${err.message}`);
    return done(err, null);
  }
};

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    'google',
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
        scope: ['profile', 'email'],
      },
      googleVerify
    )
  );
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

module.exports = passport;
module.exports.googleVerify = googleVerify;
```

- [ ] **Step 4: Port oauthCallback**

In `backend/controllers/authController.js`, replace `oauthCallback`:

```js
const oauthCallback = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { accessToken, refreshToken } = generateTokenPair(userId, req.user.role);
    const hashedRefresh = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await prisma.user.update({ where: { id: userId }, data: { refreshToken: hashedRefresh, lastLoginAt: new Date() } });

    res.cookie('accessToken', accessToken, getAccessTokenCookieOptions());
    res.cookie('refreshToken', refreshToken, getRefreshTokenCookieOptions());

    res.redirect(`${process.env.FRONTEND_URL}/oauth/callback?token=${accessToken}`);
  } catch (err) {
    logger.error(`OAuth callback error: ${err.message}`);
    res.redirect(`${process.env.FRONTEND_URL}/login?error=oauth_failed`);
  }
};
```

- [ ] **Step 5: Run and watch pass**

Run: `npm test -- passport.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/config/passport.js backend/controllers/authController.js backend/tests/passport.test.js
git commit -m "feat(auth): port Passport strategies & oauthCallback to Prisma"
```

---

### Task 11: Port user controller — updateProfile

**Files:**
- Modify: `backend/controllers/index.js` (add requires near top; replace `updateProfile`)
- Test: `backend/tests/users.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/users.test.js`:

```js
jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
  emailTemplates: {
    verification: () => ({ subject: 's', html: 'h' }),
    passwordReset: () => ({ subject: 's', html: 'h' }),
    sellerApproval: () => ({ subject: 's', html: 'h' }),
  },
}));

const request = require('supertest');
const { buildApp } = require('./helpers/buildApp');
const { prisma } = require('../config/prisma');
const { generateTokenPair } = require('../utils/jwt');

const app = buildApp();

async function makeUser(overrides = {}) {
  const user = await prisma.user.create({ data: { name: 'U', email: `u${Date.now()}${Math.random()}@test.com`, role: 'user', ...overrides } });
  const { accessToken } = generateTokenPair(user.id, user.role);
  return { user, token: accessToken };
}

describe('PUT /api/users/profile', () => {
  afterEach(async () => { await prisma.user.deleteMany({}); });

  it('updates allowed fields and returns the safe user', async () => {
    const { token } = await makeUser();
    const res = await request(app).put('/api/users/profile')
      .set('Authorization', `Bearer ${token}`)
      .field('name', 'New Name')
      .field('phone', '+1 555 1234');
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('New Name');
    expect(res.body.data.phone).toBe('+1 555 1234');
    expect(res.body.data.password).toBeUndefined();
  });
});
```

> The `/api/users/profile` route runs `upload.single('avatar')` + `processImages`. With a multipart request that has no file, multer passes through and `processImages` is a no-op (`req.processedImage` stays undefined). Using `.field(...)` sends multipart/form-data so the multer chain is satisfied.

- [ ] **Step 2: Run and watch fail**

Run: `npm test -- users.test.js`
Expected: FAIL — `updateProfile` uses Mongoose.

- [ ] **Step 3: Add requires and port updateProfile**

In `backend/controllers/index.js`, add after the existing requires (~line 12):

```js
const { prisma } = require('../config/prisma');
const userService = require('../services/userService');
```

Replace `updateProfile`:

```js
const updateProfile = async (req, res, next) => {
  try {
    const allowedFields = ['name', 'phone', 'dateOfBirth', 'gender', 'preferences'];
    const updateData = {};
    allowedFields.forEach((f) => { if (req.body[f] !== undefined) updateData[f] = req.body[f]; });
    if (updateData.dateOfBirth) updateData.dateOfBirth = new Date(updateData.dateOfBirth);

    if (req.processedImage) {
      const existing = await prisma.user.findUnique({ where: { id: req.user._id }, select: { avatarPublicId: true } });
      await deleteImage(existing?.avatarPublicId);
      updateData.avatar = req.processedImage.url;
      updateData.avatarPublicId = req.processedImage.public_id;
    }

    const user = await prisma.user.update({
      where: { id: req.user._id },
      data: updateData,
      include: { addresses: true, sellerProfile: true },
    });

    return ApiResponse.success(res, userService.toSafeObject(user), 'Profile updated');
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Run and watch pass**

Run: `npm test -- users.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/index.js backend/tests/users.test.js
git commit -m "feat(users): port updateProfile to Prisma"
```

---

### Task 12: Port user controller — addresses (add/update/delete)

**Files:**
- Modify: `backend/controllers/index.js` (`addAddress`, `updateAddress`, `deleteAddress`)
- Test: `backend/tests/users.test.js`

- [ ] **Step 1: Write the failing tests (append)**

Append to `backend/tests/users.test.js`:

```js
const ADDR = { label: 'Home', street: '1 Main', city: 'Town', state: 'CA', country: 'US', zipCode: '90001', isDefault: true };

describe('address book', () => {
  afterEach(async () => { await prisma.user.deleteMany({}); });

  it('adds an address and returns the list with _id aliases', async () => {
    const { token } = await makeUser();
    const res = await request(app).post('/api/users/addresses').set('Authorization', `Bearer ${token}`).send(ADDR);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]._id).toBeDefined();
    expect(res.body.data[0].isDefault).toBe(true);
  });

  it('only one address stays default when a second default is added', async () => {
    const { token } = await makeUser();
    await request(app).post('/api/users/addresses').set('Authorization', `Bearer ${token}`).send(ADDR);
    const res = await request(app).post('/api/users/addresses').set('Authorization', `Bearer ${token}`).send({ ...ADDR, street: '2 Main' });
    const defaults = res.body.data.filter((a) => a.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].street).toBe('2 Main');
  });

  it('updates an address', async () => {
    const { token } = await makeUser();
    const add = await request(app).post('/api/users/addresses').set('Authorization', `Bearer ${token}`).send(ADDR);
    const id = add.body.data[0]._id;
    const res = await request(app).put(`/api/users/addresses/${id}`).set('Authorization', `Bearer ${token}`).send({ city: 'Newtown' });
    expect(res.status).toBe(200);
    expect(res.body.data[0].city).toBe('Newtown');
  });

  it('deletes an address', async () => {
    const { token } = await makeUser();
    const add = await request(app).post('/api/users/addresses').set('Authorization', `Bearer ${token}`).send(ADDR);
    const id = add.body.data[0]._id;
    const res = await request(app).delete(`/api/users/addresses/${id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `npm test -- users.test.js -t "address"`
Expected: FAIL — Mongoose.

- [ ] **Step 3: Port the three handlers**

In `backend/controllers/index.js`, replace `addAddress`, `updateAddress`, `deleteAddress`:

```js
const addAddress = async (req, res, next) => {
  try {
    if (req.body.isDefault) {
      await prisma.address.updateMany({ where: { userId: req.user._id }, data: { isDefault: false } });
    }
    await prisma.address.create({ data: { ...userService.pickAddressFields(req.body), userId: req.user._id } });
    const addresses = await prisma.address.findMany({ where: { userId: req.user._id } });
    return ApiResponse.success(res, addresses.map(userService.serializeAddress), 'Address added');
  } catch (err) { next(err); }
};

const updateAddress = async (req, res, next) => {
  try {
    const addr = await prisma.address.findFirst({ where: { id: req.params.addressId, userId: req.user._id } });
    if (!addr) return next(ApiError.notFound('Address not found'));

    if (req.body.isDefault) {
      await prisma.address.updateMany({ where: { userId: req.user._id }, data: { isDefault: false } });
    }
    await prisma.address.update({ where: { id: addr.id }, data: userService.pickAddressFields(req.body) });

    const addresses = await prisma.address.findMany({ where: { userId: req.user._id } });
    return ApiResponse.success(res, addresses.map(userService.serializeAddress), 'Address updated');
  } catch (err) { next(err); }
};

const deleteAddress = async (req, res, next) => {
  try {
    await prisma.address.deleteMany({ where: { id: req.params.addressId, userId: req.user._id } });
    const addresses = await prisma.address.findMany({ where: { userId: req.user._id } });
    return ApiResponse.success(res, addresses.map(userService.serializeAddress), 'Address deleted');
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Run and watch pass**

Run: `npm test -- users.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/index.js backend/tests/users.test.js
git commit -m "feat(users): port address book endpoints to Prisma"
```

---

### Task 13: Port user controller — upgradeToSeller & updateSellerProfile

**Files:**
- Modify: `backend/controllers/index.js` (`upgradeToSeller`, `updateSellerProfile`)
- Test: `backend/tests/users.test.js`

- [ ] **Step 1: Write the failing tests (append)**

Append to `backend/tests/users.test.js`:

```js
describe('seller upgrade & profile', () => {
  afterEach(async () => { await prisma.user.deleteMany({}); });

  it('upgrades a user to seller (pending approval) and creates a sellerProfile', async () => {
    const { user, token } = await makeUser();
    const res = await request(app).post('/api/users/upgrade-seller')
      .set('Authorization', `Bearer ${token}`)
      .field('storeName', 'Janes Shop')
      .field('storeBio', 'Nice things');
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('seller');
    expect(res.body.data.sellerProfile.storeName).toBe('Janes Shop');
    expect(res.body.data.sellerProfile.isApproved).toBe(false);
    const inDb = await prisma.sellerProfile.findUnique({ where: { userId: user.id } });
    expect(inDb.storeSlug).toBe('janes-shop');
  });

  it('409s when the store slug is already taken', async () => {
    const a = await makeUser();
    await request(app).post('/api/users/upgrade-seller').set('Authorization', `Bearer ${a.token}`).field('storeName', 'Dup Shop');
    const b = await makeUser();
    const res = await request(app).post('/api/users/upgrade-seller').set('Authorization', `Bearer ${b.token}`).field('storeName', 'Dup Shop');
    expect(res.status).toBe(409);
  });

  it('409s when the user is already a seller', async () => {
    const { token } = await makeUser({ role: 'seller', sellerProfile: { create: { storeName: 'S', storeSlug: 'already-seller', isApproved: true } } });
    const res = await request(app).post('/api/users/upgrade-seller').set('Authorization', `Bearer ${token}`).field('storeName', 'Other');
    expect(res.status).toBe(409);
  });

  it('updates an existing seller profile text fields', async () => {
    const { token } = await makeUser({ role: 'seller', sellerProfile: { create: { storeName: 'Old', storeSlug: `s-${Date.now()}`, isApproved: true } } });
    const res = await request(app).put('/api/users/seller-profile')
      .set('Authorization', `Bearer ${token}`)
      .field('storeBio', 'Updated bio');
    expect(res.status).toBe(200);
    expect(res.body.data.sellerProfile.storeBio).toBe('Updated bio');
  });
});
```

> `requireSeller` is **not** on the `/api/users/seller-profile` route (only `authenticate` + `uploadLimiter` + multer), so an approved seller passes. The controller itself guards the role.

- [ ] **Step 2: Run and watch fail**

Run: `npm test -- users.test.js -t "seller"`
Expected: FAIL — Mongoose.

- [ ] **Step 3: Port the two handlers**

In `backend/controllers/index.js`, replace `upgradeToSeller` and `updateSellerProfile`:

```js
const upgradeToSeller = async (req, res, next) => {
  try {
    const { storeName, storeBio } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user._id } });

    if (user.role === 'seller') return next(ApiError.conflict('Already a seller'));

    const storeSlug = slugify(storeName, { lower: true, strict: true });
    const slugExists = await prisma.sellerProfile.findUnique({ where: { storeSlug } });
    if (slugExists) return next(ApiError.conflict('Store name already taken'));

    const profileData = { storeName, storeBio, storeSlug, isApproved: false };
    if (req.processedImage) profileData.storeLogo = req.processedImage.url;

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        role: 'seller',
        sellerProfile: { upsert: { create: profileData, update: profileData } },
      },
      include: { addresses: true, sellerProfile: true },
    });

    logger.info(`User upgraded to seller: ${user.email}`);
    return ApiResponse.success(res, userService.toSafeObject(updated), 'Seller application submitted. Awaiting admin approval.');
  } catch (err) { next(err); }
};

const updateSellerProfile = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user._id }, include: { sellerProfile: true } });
    if (!user || !['seller', 'admin', 'superadmin'].includes(user.role)) {
      return next(ApiError.forbidden('Seller account required'));
    }

    const { storeName, storeBio, storeEmail, storePhone, returnPolicy, shippingPolicy } = req.body;
    let socialLinks;
    if (req.body.socialLinks) {
      try { socialLinks = typeof req.body.socialLinks === 'string' ? JSON.parse(req.body.socialLinks) : req.body.socialLinks; } catch { /* ignore */ }
    }

    const data = {};
    if (storeName !== undefined) data.storeName = storeName;
    if (storeBio !== undefined) data.storeBio = storeBio;
    if (storeEmail !== undefined) data.storeEmail = storeEmail;
    if (storePhone !== undefined) data.storePhone = storePhone;
    if (returnPolicy !== undefined) data.returnPolicy = returnPolicy;
    if (shippingPolicy !== undefined) data.shippingPolicy = shippingPolicy;
    if (socialLinks) data.socialLinks = socialLinks;

    if (req.files?.storeLogo?.[0]) {
      await deleteImage(user.sellerProfile?.storeLogoPublicId);
      const buffer = await sharp(req.files.storeLogo[0].buffer).resize(400, 400, { fit: 'inside' }).toFormat('webp', { quality: 85 }).toBuffer();
      const { url, public_id } = await uploadBuffer(buffer, { folder: 'cartly/avatars', format: 'webp' });
      data.storeLogo = url;
      data.storeLogoPublicId = public_id;
    }
    if (req.files?.storeBanner?.[0]) {
      await deleteImage(user.sellerProfile?.storeBannerPublicId);
      const buffer = await sharp(req.files.storeBanner[0].buffer).resize(1200, 400, { fit: 'inside' }).toFormat('webp', { quality: 85 }).toBuffer();
      const { url, public_id } = await uploadBuffer(buffer, { folder: 'cartly/banners', format: 'webp' });
      data.storeBanner = url;
      data.storeBannerPublicId = public_id;
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { sellerProfile: { upsert: { create: data, update: data } } },
      include: { addresses: true, sellerProfile: true },
    });

    return ApiResponse.success(res, userService.toSafeObject(updated), 'Store profile updated');
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Run and watch pass**

Run: `npm test -- users.test.js`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/index.js backend/tests/users.test.js
git commit -m "feat(users): port upgradeToSeller & updateSellerProfile to Prisma"
```

---

### Task 14: Full verification, docs note, and push

**Files:**
- Modify: `docs/ROADMAP.md` (mark Phase 1B workstream)
- Verify: backend test suite + server boot

- [ ] **Step 1: Run the entire backend test suite**

Run (from `backend/`): `npm test`
Expected: all suites pass (`userService.test.js`, `auth.test.js`, `passport.test.js`, `users.test.js`, `foundation.test.js`, smoke). No open handles beyond Jest's `forceExit`.

- [ ] **Step 2: Boot the server to confirm wiring (dual DB)**

Run (from `backend/`, requires the dev Postgres on 5433, Mongo, and `.env`): `npm run dev`
Expected: logs show `PostgreSQL (Prisma) connected` and `MongoDB: Connected`, server listens on the configured port, no crash. Stop it with Ctrl+C after confirming.

- [ ] **Step 3: Manual smoke against the running server (optional but recommended)**

With the server running, in a second shell:

```bash
curl -s -X POST http://localhost:5000/api/auth/register -H "Content-Type: application/json" -d "{\"name\":\"Smoke Test\",\"email\":\"smoke@test.com\",\"password\":\"Passw0rd!@\",\"confirmPassword\":\"Passw0rd!@\"}"
```

Expected: a `201` JSON envelope `{ statusCode, success: true, message, data: { user, accessToken, refreshToken }, timestamp }`.

- [ ] **Step 4: Update the roadmap**

In `docs/ROADMAP.md`, mark the Phase 1B (Auth & Users) item as ✅ / in-progress→done per the file's status legend, with a one-line note: "Auth path + user/address/seller endpoints on Prisma; integration tests assert frozen envelope. Wishlist population & seller-store deferred to 1C."

- [ ] **Step 5: Commit and push to develop**

```bash
git add docs/ROADMAP.md
git commit -m "docs: mark Phase 1B (auth & users) complete in roadmap"
git push origin develop
```

(Per the develop-only workflow: push to `develop`; the user merges to `main`.)

---

## Self-review checklist (completed during authoring)

- **Spec coverage:** Every Phase-1 design item touching auth/users is covered: `config/db.js` Prisma path (already done in 1A; `authenticate` now on Prisma), User model → Prisma (incl. the 3 missing columns), auth crypto unchanged (bcrypt/JWT reused), envelope preserved (`ApiResponse` untouched; integration tests assert shape). Wishlist FTS/search and product population are explicitly deferred to 1C; admin/cart/orders/reviews to 1D–1E; seeder + Mongoose removal to 1F.
- **Placeholder scan:** No TBD/"handle errors"/"similar to Task N". All code blocks are complete; shared helpers (`buildApp`, email mock) are defined once as real files and referenced by path.
- **Type/name consistency:** `userService` exports used across tasks match their definitions (`hashPassword`, `comparePassword`, `generate*Token`, `isLocked`, `changedPasswordAfter`, `incLoginAttempts`, `toSafeObject`, `toReqUser`, `findById`, `findByEmail`, `serializeAddress`, `pickAddressFields`, `DEFAULT_PREFERENCES`, `DEFAULT_FEATURE_FLAGS`). `googleVerify` is exported from `passport.js` and imported in `passport.test.js`. `req.user._id` (uuid string) is produced by `toReqUser` and consumed by every ported controller.

## Remaining Phase 1 plans (after 1B)

- **1C — Products & Categories + search:** port `productController`, category endpoints, restore wishlist population & `getSellerStore`, add tsvector/pg_trgm full-text search.
- **1D — Cart & Orders + coupons:** port cart/order/coupon controllers; wrap order placement in `prisma.$transaction`.
- **1E — Reviews, carriers, warehouse, feedback, admin, audit:** port remaining controllers; complete `Carrier`/`Warehouse` models; replace audit-log TTL with a scheduled cleanup job.
- **1F — Seeder rewrite & Mongoose removal:** rewrite `utils/seeder.js` on Prisma; remove Mongoose/Mongo from code, deps, and compose; delete the legacy `models/` and Mongo requires.
