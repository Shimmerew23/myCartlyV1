# Postgres Migration — Phase 1A: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up PostgreSQL + Prisma alongside the existing MongoDB/Mongoose stack, with a complete relational schema, a migration, a Prisma client singleton, and a Jest+Supertest test harness — without changing any controller or API behavior yet.

**Architecture:** Strangler-fig migration. Prisma connects in parallel with Mongoose; the app keeps booting on Mongo. Later plans (1B–1F) port each resource group from Mongoose to Prisma, and the final plan removes Mongo. This foundation plan introduces zero behavior change — its acceptance test is "schema migrates, Prisma connects, existing app still boots."

**Tech Stack:** PostgreSQL 16, Prisma ORM, Jest, Supertest, Docker Compose.

---

## Context for the implementer

- Backend lives in `backend/`. There is currently **no test suite** — this plan creates the first one.
- Current Mongoose models: `backend/models/User.js`, `Product.js`, `Order.js`, `Carrier.js`, `Warehouse.js`, and inline models in `backend/models/index.js` (`Cart`, `Review`, `Category`, `AuditLog`, `Coupon`, `Feedback`).
- The API response envelope (`utils/ApiResponse.js`) and routes must not change across the whole of Phase 1.
- **Contract-preservation rule:** any field returned in an API response must keep its exact JSON value. Where a Mongo enum value isn't a legal Prisma enum identifier (e.g. gender `prefer-not-to-say`), store it as a plain `String` rather than a Prisma enum, so the value is unchanged.

## File structure (created/modified in this plan)

- Create: `backend/prisma/schema.prisma` — the full relational schema
- Create: `backend/config/prisma.js` — Prisma client singleton + connect/disconnect helpers
- Create: `backend/tests/setup.js` — Jest global setup (test DB lifecycle)
- Create: `backend/tests/foundation.test.js` — smoke tests (Prisma connects, a row round-trips)
- Create: `backend/jest.config.js` — Jest config
- Create: `backend/.env.test.example` — test DB env template
- Modify: `backend/package.json` — add deps + scripts
- Modify: `backend/.env.example` — add `DATABASE_URL`
- Modify: `docker-compose.yml` — add `postgres` service (keep `mongo` for now)
- Modify: `backend/server.js` — connect Prisma at startup alongside Mongo

---

### Task 1: Add dependencies and npm scripts

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Add Prisma + pg + test deps**

In `backend/package.json`, add to `dependencies`:

```json
"@prisma/client": "^5.22.0"
```

Add to `devDependencies`:

```json
"prisma": "^5.22.0",
"jest": "^29.7.0",
"supertest": "^7.0.0",
"cross-env": "^7.0.3"
```

- [ ] **Step 2: Add scripts**

In `backend/package.json` `scripts`, add:

```json
"prisma:generate": "prisma generate",
"prisma:migrate": "prisma migrate dev",
"prisma:deploy": "prisma migrate deploy",
"prisma:studio": "prisma studio",
"test": "cross-env NODE_ENV=test jest --runInBand"
```

- [ ] **Step 3: Install**

Run: `cd backend && npm install`
Expected: installs without errors; `node_modules/.bin/prisma` exists.

- [ ] **Step 4: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "chore: add prisma, pg client, and jest test deps"
```

---

### Task 2: Add Postgres to docker-compose and env templates

**Files:**
- Modify: `docker-compose.yml`
- Modify: `backend/.env.example`
- Create: `backend/.env.test.example`

- [ ] **Step 1: Add the postgres service**

In `docker-compose.yml`, add this service (keep the existing `mongo` service — it is removed in the final Phase 1 plan):

```yaml
  postgres:
    image: postgres:16-alpine
    container_name: CartLy_postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: cartly
      POSTGRES_PASSWORD: cartlypass
      POSTGRES_DB: cartly_ecommerce
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - CartLy_net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U cartly -d cartly_ecommerce"]
      interval: 10s
      timeout: 5s
      retries: 5
```

- [ ] **Step 2: Add the volume and backend dependency**

Under top-level `volumes:` add `postgres_data:`. In the `backend` service `environment:` add:

```yaml
      DATABASE_URL: postgresql://cartly:cartlypass@postgres:5432/cartly_ecommerce?schema=public
```

And under the backend service `depends_on:` add:

```yaml
      postgres:
        condition: service_healthy
```

- [ ] **Step 3: Add env templates**

Append to `backend/.env.example`:

```
# PostgreSQL (Prisma)
DATABASE_URL=postgresql://cartly:cartlypass@localhost:5432/cartly_ecommerce?schema=public
```

Create `backend/.env.test.example`:

```
NODE_ENV=test
DATABASE_URL=postgresql://cartly:cartlypass@localhost:5432/cartly_test?schema=public
JWT_ACCESS_SECRET=test-access-secret
JWT_REFRESH_SECRET=test-refresh-secret
SESSION_SECRET=test-session-secret
```

- [ ] **Step 4: Bring up Postgres and verify**

Run: `docker-compose up -d postgres`
Run: `docker-compose exec postgres pg_isready -U cartly -d cartly_ecommerce`
Expected: `accepting connections`

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml backend/.env.example backend/.env.test.example
git commit -m "chore: add postgres service and DATABASE_URL env templates"
```

---

### Task 3: Write the Prisma schema

**Files:**
- Create: `backend/prisma/schema.prisma`

- [ ] **Step 1: Write the schema**

Create `backend/prisma/schema.prisma` with the complete model. Notes baked in: `uuid` PKs; embedded Mongo subdocuments become related tables; arrays that are pure value lists stay as `String[]`; loosely-structured blobs (`seo`, `shipping`, `discount`, `tracking`, order `coupon`, audit `before/after/metadata`, rating `distribution`) are `Json`; `gender` stays `String` to preserve the `prefer-not-to-say` contract value.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  user
  seller
  admin
  superadmin
  warehouse
}

enum ProductStatus {
  draft
  active
  inactive
  suspended
  archived
}

enum OrderStatus {
  pending
  confirmed
  processing
  shipped
  out_for_delivery
  delivered
  cancelled
  return_requested
  returned
  refunded
}

enum PaymentStatus {
  pending
  paid
  failed
  refunded
  partially_refunded
}

enum PaymentMethod {
  stripe // removed in Phase 2; kept in Phase 1 to preserve the contract
  paypal
  cod
  bank_transfer
}

enum DiscountType {
  percentage
  fixed
}

enum FeedbackCategory {
  bug
  feature
  general
  complaint
  praise
}

enum FeedbackStatus {
  new
  read
  resolved
}

model User {
  id                      String    @id @default(uuid())
  name                    String
  email                   String    @unique
  password                String?
  role                    Role      @default(user)
  avatar                  String?
  avatarPublicId          String?
  phone                   String?
  dateOfBirth             DateTime?
  gender                  String? // preserves 'prefer-not-to-say' contract value
  googleId                String?
  isEmailVerified         Boolean   @default(false)
  emailVerificationToken  String?
  emailVerificationExpiry DateTime?
  passwordResetToken      String?
  passwordResetExpiry     DateTime?
  passwordChangedAt       DateTime?
  refreshToken            String?
  isActive                Boolean   @default(true)
  isBanned                Boolean   @default(false)
  banReason               String?
  bannedAt                DateTime?
  loginAttempts           Int       @default(0)
  lockUntil               DateTime?
  lockCount               Int       @default(0)
  lastLoginAt             DateTime?
  lastLoginIp             String?
  createdAt               DateTime  @default(now())
  updatedAt               DateTime  @updatedAt

  addresses     Address[]
  sellerProfile SellerProfile?
  products      Product[]
  orders        Order[]
  reviews       Review[]
  cart          Cart?
  feedback      Feedback[]
  auditLogs     AuditLog[]
  warehouses    Warehouse[]
  orderEvents   OrderStatusEvent[]
  couponUsages  CouponUsage[]

  @@index([role])
}

model Address {
  id        String  @id @default(uuid())
  userId    String
  user      User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  label     String  @default("Home")
  street    String
  city      String
  state     String
  country   String  @default("US")
  zipCode   String
  isDefault Boolean @default(false)

  @@index([userId])
}

model SellerProfile {
  id              String    @id @default(uuid())
  userId          String    @unique
  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  storeName       String?
  storeBio        String?
  storeLogo       String?
  storeLogoPublicId String?
  storeBanner     String?
  storeBannerPublicId String?
  storeSlug       String?   @unique
  bankAccountNumber String? // encrypted at app level
  bankRoutingNumber String? // encrypted at app level
  bankName        String?
  stripeAccountId String? // removed in Phase 2
  storeEmail      String?
  storePhone      String?
  returnPolicy    String?
  shippingPolicy  String?
  socialLinks     Json?
  totalSales      Int       @default(0)
  totalRevenue    Float     @default(0)
  rating          Float     @default(0)
  reviewCount     Int       @default(0)
  isApproved      Boolean   @default(false)
  approvedAt      DateTime?
  suspendedAt     DateTime?
  suspendReason   String?
}

model Category {
  id              String     @id @default(uuid())
  name            String
  slug            String     @unique
  description     String?
  image           String?
  icon            String?
  parentId        String?
  parent          Category?  @relation("CategoryToCategory", fields: [parentId], references: [id])
  children        Category[] @relation("CategoryToCategory")
  isActive        Boolean    @default(true)
  sortOrder       Int        @default(0)
  productCount    Int        @default(0)
  seo             Json?
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt
  products        Product[]

  @@index([parentId])
}

model Product {
  id                String         @id @default(uuid())
  name              String
  slug              String         @unique
  description       String
  shortDescription  String?
  price             Float
  compareAtPrice    Float?
  costPrice         Float?
  currency          String         @default("USD")
  video             String?
  categoryId        String
  category          Category       @relation(fields: [categoryId], references: [id])
  subcategory       String?
  tags              String[]
  brand             String?
  sellerId          String
  seller            User           @relation(fields: [sellerId], references: [id])
  sku               String?        @unique
  stock             Int            @default(0)
  lowStockThreshold Int            @default(5)
  trackInventory    Boolean        @default(true)
  hasVariants       Boolean        @default(false)
  ratingAverage     Float          @default(0)
  ratingCount       Int            @default(0)
  ratingDistribution Json?
  status            ProductStatus  @default(draft)
  isFeatured        Boolean        @default(false)
  isTrending        Boolean        @default(false)
  isNewArrival      Boolean        @default(false)
  seo               Json?
  shipping          Json?
  discount          Json?
  views             Int            @default(0)
  sales             Int            @default(0)
  revenue           Float          @default(0)
  wishlistCount     Int            @default(0)
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt

  images   ProductImage[]
  variants ProductVariant[]
  reviews  Review[]

  @@index([categoryId])
  @@index([sellerId])
  @@index([status])
  @@index([price])
  @@index([ratingAverage])
  @@index([isFeatured, isTrending])
  @@index([createdAt])
  @@index([sales])
  @@index([tags])
}

model ProductImage {
  id        String  @id @default(uuid())
  productId String
  product   Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  url       String
  publicId  String?
  alt       String?
  isPrimary Boolean @default(false)

  @@index([productId])
}

model ProductVariant {
  id        String   @id @default(uuid())
  productId String
  product   Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  name      String
  value     String
  stock     Int      @default(0)
  price     Float?
  sku       String?
  images    String[]

  @@index([productId])
}

model Cart {
  id           String     @id @default(uuid())
  userId       String     @unique
  user         User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  couponCode   String?
  couponType   String?
  couponValue  Float?
  couponValidUntil DateTime?
  lastModified DateTime   @default(now())
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  items        CartItem[]
}

model CartItem {
  id           String   @id @default(uuid())
  cartId       String
  cart         Cart     @relation(fields: [cartId], references: [id], onDelete: Cascade)
  productId    String
  quantity     Int      @default(1)
  variantName  String?
  variantValue String?
  price        Float
  addedAt      DateTime @default(now())

  @@index([cartId])
}

model Order {
  id              String             @id @default(uuid())
  orderNumber     String             @unique
  userId          String
  user            User               @relation(fields: [userId], references: [id])
  shippingAddress Json
  subtotal        Float
  shippingCost    Float              @default(0)
  taxAmount       Float              @default(0)
  discountAmount  Float              @default(0)
  totalPrice      Float
  currency        String             @default("USD")
  coupon          Json?
  paymentMethod   PaymentMethod
  paymentStatus   PaymentStatus      @default(pending)
  paymentResult   Json?
  paidAt          DateTime?
  status          OrderStatus        @default(pending)
  tracking        Json?
  preferredCarrier String?
  cancelledAt     DateTime?
  cancellationReason String?
  deliveredAt     DateTime?
  customerNote    String?
  internalNote    String?
  createdAt       DateTime           @default(now())
  updatedAt       DateTime           @updatedAt

  items        OrderItem[]
  statusHistory OrderStatusEvent[]
  reviews      Review[]

  @@index([userId])
  @@index([status])
  @@index([createdAt])
}

model OrderItem {
  id           String  @id @default(uuid())
  orderId      String
  order        Order   @relation(fields: [orderId], references: [id], onDelete: Cascade)
  productId    String
  sellerId     String
  name         String
  image        String?
  price        Float
  quantity     Int
  variantName  String?
  variantValue String?

  @@index([orderId])
  @@index([sellerId])
}

model OrderStatusEvent {
  id            String      @id @default(uuid())
  orderId       String
  order         Order       @relation(fields: [orderId], references: [id], onDelete: Cascade)
  status        String
  timestamp     DateTime    @default(now())
  note          String?
  updatedById   String?
  updatedBy     User?       @relation(fields: [updatedById], references: [id])
  warehouseName String?

  @@index([orderId])
}

model Review {
  id                String   @id @default(uuid())
  productId         String
  product           Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  userId            String
  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  orderId           String?
  order             Order?   @relation(fields: [orderId], references: [id])
  rating            Int
  title             String?
  body              String?
  images            String[]
  isVerifiedPurchase Boolean @default(false)
  helpfulVotes      Int      @default(0)
  reportCount       Int      @default(0)
  isApproved        Boolean  @default(true)
  sellerReplyBody   String?
  sellerRepliedAt   DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@unique([productId, userId])
  @@index([productId, rating])
  @@index([userId])
}

model Coupon {
  id                  String        @id @default(uuid())
  code                String        @unique
  description         String?
  discountType        DiscountType
  discountValue       Float
  minimumOrderAmount  Float         @default(0)
  maximumDiscountAmount Float?
  usageLimit          Int?
  usageCount          Int           @default(0)
  userUsageLimit      Int           @default(1)
  validFrom           DateTime
  validUntil          DateTime
  isActive            Boolean       @default(true)
  applicableCategories String[]
  applicableProducts  String[]
  createdById         String?
  createdAt           DateTime      @default(now())
  updatedAt           DateTime      @updatedAt
  usedBy              CouponUsage[]

  @@index([validFrom, validUntil])
}

model CouponUsage {
  id       String   @id @default(uuid())
  couponId String
  coupon   Coupon   @relation(fields: [couponId], references: [id], onDelete: Cascade)
  userId   String
  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  usedAt   DateTime @default(now())

  @@index([couponId])
}

model Carrier {
  id        String   @id @default(uuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  // NOTE: remaining Carrier fields are filled in during Plan 1E from backend/models/Carrier.js
}

model Warehouse {
  id        String   @id @default(uuid())
  managerId String?
  manager   User?    @relation(fields: [managerId], references: [id])
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  // NOTE: remaining Warehouse fields are filled in during Plan 1E from backend/models/Warehouse.js

  @@index([managerId])
}

model Feedback {
  id         String           @id @default(uuid())
  userId     String?
  user       User?            @relation(fields: [userId], references: [id])
  guestName  String?
  guestEmail String?
  category   FeedbackCategory
  subject    String
  message    String
  rating     Int?
  status     FeedbackStatus   @default(new)
  adminNote  String?
  createdAt  DateTime         @default(now())
  updatedAt  DateTime         @updatedAt

  @@index([status, createdAt])
  @@index([userId])
}

model AuditLog {
  id         String   @id @default(uuid())
  userId     String?
  user       User?    @relation(fields: [userId], references: [id])
  action     String
  resource   String?
  resourceId String?
  method     String?
  path       String?
  statusCode Int?
  ip         String?
  userAgent  String?
  before     Json?
  after      Json?
  metadata   Json?
  createdAt  DateTime @default(now())

  @@index([userId, createdAt])
  @@index([action])
  @@index([resource, resourceId])
  @@index([createdAt])
}
```

> **Carrier/Warehouse note:** their full field sets live in `backend/models/Carrier.js` and `Warehouse.js`. They are stubbed here and completed in Plan 1E, which ports those controllers. Stubbing keeps this foundation migration valid without guessing fields.

- [ ] **Step 2: Format & validate the schema**

Run: `cd backend && npx prisma format && npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/schema.prisma
git commit -m "feat: add prisma relational schema for all entities"
```

---

### Task 4: Generate and apply the initial migration

**Files:**
- Create: `backend/prisma/migrations/**` (generated)

- [ ] **Step 1: Ensure local DATABASE_URL is set**

Confirm `backend/.env` has a `DATABASE_URL` pointing at the running Postgres (copy the line from `.env.example`; for local dev use `localhost:5432`).

- [ ] **Step 2: Create the initial migration**

Run: `cd backend && npx prisma migrate dev --name init`
Expected: creates `prisma/migrations/<timestamp>_init/migration.sql`, applies it, and prints `Your database is now in sync with your schema.`

- [ ] **Step 3: Verify tables exist**

Run: `docker-compose exec postgres psql -U cartly -d cartly_ecommerce -c "\dt"`
Expected: lists `User`, `Product`, `Order`, `Category`, `Cart`, etc.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/migrations
git commit -m "feat: initial postgres migration"
```

---

### Task 5: Prisma client singleton

**Files:**
- Create: `backend/config/prisma.js`

- [ ] **Step 1: Write the client module**

Create `backend/config/prisma.js`:

```js
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

const connectPrisma = async () => {
  try {
    await prisma.$connect();
    logger.info('PostgreSQL (Prisma) connected');
  } catch (err) {
    logger.error(`Prisma connection failed: ${err.message}`);
    throw err; // Postgres is the system of record; fail fast like Mongo does
  }
};

const disconnectPrisma = async () => {
  await prisma.$disconnect();
  logger.info('Prisma disconnected');
};

module.exports = { prisma, connectPrisma, disconnectPrisma };
```

- [ ] **Step 2: Commit**

```bash
git add backend/config/prisma.js
git commit -m "feat: add prisma client singleton with connect helpers"
```

---

### Task 6: Test harness (Jest + Supertest)

**Files:**
- Create: `backend/jest.config.js`
- Create: `backend/tests/setup.js`

- [ ] **Step 1: Jest config**

Create `backend/jest.config.js`:

```js
module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  testTimeout: 20000,
  forceExit: true,
};
```

- [ ] **Step 2: Test setup (loads test env, resets DB between runs)**

Create `backend/tests/setup.js`:

```js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.test') });

const { execSync } = require('child_process');
const { prisma } = require('../config/prisma');

beforeAll(() => {
  // Apply migrations to the test database
  execSync('npx prisma migrate deploy', {
    env: process.env,
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

- [ ] **Step 3: Create the test DB and .env.test**

Run: `docker-compose exec postgres psql -U cartly -d cartly_ecommerce -c "CREATE DATABASE cartly_test;"`
Then create `backend/.env.test` from `backend/.env.test.example`.
Expected: `CREATE DATABASE`.

- [ ] **Step 4: Commit**

```bash
git add backend/jest.config.js backend/tests/setup.js backend/.env.test.example
git commit -m "test: add jest + supertest harness with test db lifecycle"
```

---

### Task 7: Foundation smoke test (TDD)

**Files:**
- Create: `backend/tests/foundation.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/foundation.test.js`:

```js
const { prisma } = require('../config/prisma');

describe('Prisma foundation', () => {
  afterEach(async () => {
    await prisma.user.deleteMany({});
  });

  it('connects and round-trips a User row', async () => {
    const created = await prisma.user.create({
      data: { name: 'Test User', email: 'foundation@test.com', role: 'user' },
    });
    expect(created.id).toBeDefined();
    expect(created.role).toBe('user');

    const found = await prisma.user.findUnique({ where: { email: 'foundation@test.com' } });
    expect(found.name).toBe('Test User');
  });

  it('enforces the unique email constraint', async () => {
    await prisma.user.create({ data: { name: 'A', email: 'dup@test.com' } });
    await expect(
      prisma.user.create({ data: { name: 'B', email: 'dup@test.com' } })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails (before migration on test DB)**

Run: `cd backend && npm test -- foundation.test.js`
Expected: PASS once migrations apply via `setup.js`. If the test DB is missing, it fails with a connection error — create it (Task 6 Step 3) and re-run.

- [ ] **Step 3: Confirm green**

Run: `cd backend && npm test -- foundation.test.js`
Expected: 2 passing tests.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/foundation.test.js
git commit -m "test: prisma foundation smoke tests (connect, round-trip, unique)"
```

---

### Task 8: Connect Prisma at app startup (alongside Mongo)

**Files:**
- Modify: `backend/server.js`

- [ ] **Step 1: Import and call connectPrisma**

In `backend/server.js`, next to the existing `const connectDB = require('./config/db');` import, add:

```js
const { connectPrisma } = require('./config/prisma');
```

Find where `connectDB()` is invoked at startup and add `connectPrisma()` immediately after it (both run at boot; Mongo still serves all current controllers).

- [ ] **Step 2: Verify the app still boots**

Run: `cd backend && npm run dev`
Expected logs: `MongoDB Connected: ...` **and** `PostgreSQL (Prisma) connected`. The app serves existing routes unchanged.

- [ ] **Step 3: Commit**

```bash
git add backend/server.js
git commit -m "feat: connect prisma at startup alongside mongoose"
```

---

## Self-review notes (against the Phase 1 spec)

- **Schema coverage:** every Mongo model maps to a table — User(+Address,+SellerProfile), Product(+Image,+Variant), Order(+Item,+StatusEvent), Cart(+Item), Review, Coupon(+Usage), Category, Feedback, AuditLog, Carrier (stub), Warehouse (stub). Carrier/Warehouse fields are deliberately deferred to Plan 1E where their controllers are read and ported.
- **Contract preservation:** enum string values match Mongo values; `gender` kept as `String` for `prefer-not-to-say`; `stripe` retained in `PaymentMethod` for Phase 1.
- **No behavior change:** controllers untouched; Mongo still authoritative. Acceptance = app boots on both, schema migrates, smoke tests pass.
- **Deferred to later plans:** full-text search (`tsvector`/`pg_trgm`), audit-log retention job, controller ports, seeder rewrite, Mongoose removal.

---

## Remaining Phase 1 plans (to be written next, in order)

Each is its own plan file and produces testable software:

- **1B — Auth & Users:** port `authController` + user/address/become-seller endpoints to Prisma; integration tests assert unchanged envelopes. Includes password hashing/token logic (unchanged) wired to Prisma reads/writes.
- **1C — Products & Categories & Search:** port `productController` + category controller; implement Postgres `tsvector` + `pg_trgm` search to replace the Mongo text index; product slug generation.
- **1D — Cart & Orders & Coupons:** port cart, `orderController`, coupon logic; wrap order placement in `prisma.$transaction`; keep Stripe webhook working (raw body) against Prisma writes.
- **1E — Reviews, Carriers, Warehouse, Feedback, Admin, Audit:** port remaining controllers; complete the `Carrier`/`Warehouse` schema models; implement the audit-log 90-day cleanup job; port admin dashboard aggregations.
- **1F — Seeder rewrite & Mongoose removal:** rewrite `utils/seeder.js` against Prisma; remove `mongoose`/`mongodb`/`express-mongo-sanitize` (replace sanitizer), delete `config/db.js` + `models/*`, remove the `mongo` service from compose; full regression pass.
