# Phase 1C — Products, Categories & Search → Prisma Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port `productController`, the category controllers, the wishlist + seller-store endpoints, and product full-text search from Mongoose to PostgreSQL + Prisma, keeping the API envelope and JSON shapes byte-compatible so the React SPA is untouched.

**Architecture:** A new `services/productService.js` owns Prisma data access and the serialization that rebuilds the Mongo-shaped product/category JSON (nested `rating`, related `images`/`variants`, populated `category`/`seller`, and the `discountedPrice`/`discountPercentage`/`inStock` virtuals). Full-text search uses a generated `tsvector` column + GIN index (plus `pg_trgm`), queried via Prisma `$queryRaw`. Controllers switch to Prisma; everything else stays on Mongoose until its plan.

**Tech Stack:** Node/Express, Prisma 5.22 (PostgreSQL 16 on host 5433), PostgreSQL FTS (`tsvector`, `ts_rank`, `websearch_to_tsquery`, `pg_trgm`), Jest 29 + Supertest 7.

---

## Context from Plan 1B (read first)

- `services/userService.js` already exists with `toSafeObject`, `findById`, `toReqUser`, serializers. Reuse its seller serialization where products embed a seller.
- `tests/helpers/buildApp.js` mounts `/api/auth` and `/api/users`. This plan extends it to also mount `/api/products` and `/api/categories`.
- Rate limiters already skip under `NODE_ENV==='test'`. This plan adds the **same guard to `auditLog`** (it `await`s a Mongo `AuditLog.create` before responding; with no Mongo connection in tests that blocks ~10s per audited request).
- `req.user._id` is a Postgres uuid string (from `userService.toReqUser`). All ported product controllers read it directly.
- `User.wishlist` is a `String[]` of product id strings (added in 1B). This plan restores population in `getMe`, `getWishlist`, and implements `toggleWishlist`.

## Known interim state (after 1C)

- Reviews, cart, orders, admin, warehouse, feedback, audit remain on **Mongoose** and won't resolve Postgres uuids until their plans (1D/1E). The `reviewRouter` is **not** mounted in the test harness here.
- `getProduct`'s `cache` (Redis) is used as-is; in tests Redis is absent and degrades gracefully (returns null/false).
- `costPrice` (Mongo `select:false`, never returned) is **omitted** from serialization entirely.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `backend/prisma/schema.prisma` | Add `Product.searchVector Unsupported("tsvector")?` + GIN index | Modify |
| `backend/prisma/migrations/<ts>_product_fts/migration.sql` | Generated `tsvector` column, GIN index, `pg_trgm`, trigram index (hand-edited) | Create |
| `backend/services/productService.js` | Prisma product/category access + serialization + slug/sku/normalize + FTS query | Create |
| `backend/middleware/index.js` | `auditLog` skips the DB write under `NODE_ENV==='test'` | Modify (~line 342) |
| `backend/controllers/productController.js` | All 10 handlers on Prisma | Rewrite |
| `backend/controllers/index.js` | Category CRUD + `getWishlist` + `getSellerStore` on Prisma | Modify |
| `backend/controllers/authController.js` | `getMe` restores wishlist population | Modify (`getMe`) |
| `backend/tests/helpers/buildApp.js` | Mount product + category routers | Modify |
| `backend/tests/services/productService.test.js` | Unit tests for serialization/helpers | Create |
| `backend/tests/products.test.js` | Integration tests for `/api/products/*` (incl. search) | Create |
| `backend/tests/categories.test.js` | Integration tests for `/api/categories/*` + wishlist/store | Create |

## Conventions (same as 1B)

- Email mock at top of any test file that triggers email (see 1B). Product/category tests don't send email, but `users`-style helpers create users.
- DB cleanup: `afterEach` deletes the rows a test created. Deleting users cascades addresses/sellerProfile; deleting products cascades images/variants; deleting categories is blocked while products reference them, so delete products first.
- Run: from `backend/`, `npm test -- <file>`.

---

### Task 1: Product full-text search schema (tsvector + GIN + pg_trgm)

Prisma can't author generated columns, so we create the migration empty and hand-edit its SQL. The schema declares the column as `Unsupported` so Prisma never tries to drop it.

**Files:**
- Modify: `backend/prisma/schema.prisma` (`model Product`)
- Create: `backend/prisma/migrations/<timestamp>_product_fts/migration.sql`

- [ ] **Step 1: Declare the column + index in the schema**

In `model Product`, after the `wishlistCount` line, add:

```prisma
  searchVector Unsupported("tsvector")?
```

And in the `@@index(...)` block for Product, add:

```prisma
  @@index([searchVector], type: Gin)
```

- [ ] **Step 2: Create an empty migration**

Run (from `backend/`):

```bash
npx prisma migrate dev --create-only --name product_fts
```

Expected: a new `prisma/migrations/<ts>_product_fts/migration.sql` is created (may contain a plain `ADD COLUMN "searchVector" tsvector` and a GIN index — we will replace its body).

- [ ] **Step 3: Replace the migration SQL with the generated-column version**

Overwrite the new `migration.sql` with exactly:

```sql
-- Full-text search for products
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "Product" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('english', coalesce(array_to_string("tags", ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce("brand", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'C')
  ) STORED;

CREATE INDEX "Product_searchVector_idx" ON "Product" USING GIN ("searchVector");
CREATE INDEX "Product_name_trgm_idx" ON "Product" USING GIN ("name" gin_trgm_ops);
```

- [ ] **Step 4: Apply the migration**

Run: `npx prisma migrate dev`
Expected: `Your database is now in sync with your schema.` and **no new migration** is generated (no drift). The client regenerates.

If Prisma reports drift wanting to alter `searchVector`, run `npx prisma migrate reset` is **not** appropriate (would wipe dev data). Instead confirm the schema field is exactly `searchVector Unsupported("tsvector")?` — Unsupported types are not diffed on their generation expression, so a correct declaration produces no drift.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(db): add Product tsvector search column + GIN/pg_trgm indexes"
```

---

### Task 2: productService — serialization

Rebuilds the Mongo-shaped JSON from the relational rows.

**Files:**
- Create: `backend/services/productService.js`
- Test: `backend/tests/services/productService.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/services/productService.test.js`:

```js
const productService = require('../../services/productService');

describe('productService.serializeProduct', () => {
  const row = {
    id: 'p1', name: 'Red Shoe', slug: 'red-shoe', description: 'desc', price: 100,
    compareAtPrice: 200, currency: 'USD', tags: ['red'], brand: 'Acme',
    stock: 5, lowStockThreshold: 5, trackInventory: true, hasVariants: false,
    ratingAverage: 4.5, ratingCount: 10, ratingDistribution: { '5': 8, '4': 2 },
    status: 'active', isFeatured: true, isTrending: false, isNewArrival: false,
    views: 3, sales: 1, revenue: 100, wishlistCount: 2,
    seo: { metaTitle: 'T' }, shipping: { weight: 100, isFreeShipping: true },
    discount: { type: 'percentage', value: 10 },
    categoryId: 'c1', sellerId: 's1',
    images: [{ id: 'i1', url: 'u', publicId: 'pid', alt: 'a', isPrimary: true }],
    variants: [{ id: 'v1', name: 'Size', value: 'XL', stock: 2, price: null, sku: null, images: [] }],
    category: { id: 'c1', name: 'Cat', slug: 'cat', parentId: null },
    seller: { id: 's1', name: 'Seller', sellerProfile: { storeName: 'Shop', storeLogo: 'logo' } },
    createdAt: new Date(), updatedAt: new Date(),
  };

  it('rebuilds nested rating, images, virtuals, and populated relations', () => {
    const p = productService.serializeProduct(row);
    expect(p._id).toBe('p1');
    expect(p.id).toBe('p1');
    expect(p.rating).toEqual({ average: 4.5, count: 10, distribution: { '5': 8, '4': 2 } });
    expect(p.images[0]).toMatchObject({ _id: 'i1', url: 'u', public_id: 'pid', isPrimary: true });
    expect(p.variants[0]).toMatchObject({ _id: 'v1', name: 'Size', value: 'XL' });
    expect(p.discountedPrice).toBe(90); // 10% off 100
    expect(p.discountPercentage).toBe(50); // (200-100)/200
    expect(p.inStock).toBe(true);
    expect(p.category).toMatchObject({ _id: 'c1', name: 'Cat', parent: null });
    expect(p.seller).toMatchObject({ _id: 's1', name: 'Seller' });
    expect(p.seller.sellerProfile.storeName).toBe('Shop');
    expect(p.costPrice).toBeUndefined();
  });

  it('falls back to ids when relations are not included', () => {
    const p = productService.serializeProduct({ ...row, category: undefined, seller: undefined });
    expect(p.category).toBe('c1');
    expect(p.seller).toBe('s1');
  });

  it('defaults rating distribution and respects no-discount', () => {
    const p = productService.serializeProduct({ ...row, ratingDistribution: null, discount: null });
    expect(p.rating.distribution).toEqual({ '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 });
    expect(p.discountedPrice).toBe(100);
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `npm test -- productService.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the service with serialization**

Create `backend/services/productService.js`:

```js
const { prisma } = require('../config/prisma');

const EMPTY_DISTRIBUTION = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };

const computeDiscountedPrice = (price, discount) => {
  if (!discount || !discount.value) return price;
  const now = new Date();
  if (discount.validFrom && now < new Date(discount.validFrom)) return price;
  if (discount.validUntil && now > new Date(discount.validUntil)) return price;
  if (discount.type === 'percentage') {
    return Math.round(price * (1 - discount.value / 100) * 100) / 100;
  }
  return Math.max(0, price - discount.value);
};

const computeDiscountPercentage = (price, compareAtPrice) => {
  if (!compareAtPrice || compareAtPrice <= price) return 0;
  return Math.round(((compareAtPrice - price) / compareAtPrice) * 100);
};

const computeInStock = (trackInventory, stock) => (!trackInventory ? true : stock > 0);

const serializeCategory = (c) => {
  if (!c) return undefined;
  return {
    _id: c.id,
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description ?? undefined,
    image: c.image ?? undefined,
    icon: c.icon ?? undefined,
    parent: c.parentId ?? null,
    isActive: c.isActive,
    sortOrder: c.sortOrder,
    productCount: c.productCount,
    seo: c.seo ?? undefined,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
};

const serializeSellerSummary = (s) => {
  if (!s) return undefined;
  return {
    _id: s.id,
    id: s.id,
    name: s.name,
    sellerProfile: s.sellerProfile
      ? { storeName: s.sellerProfile.storeName ?? undefined, storeLogo: s.sellerProfile.storeLogo ?? undefined }
      : undefined,
  };
};

const serializeImage = (i) => ({
  _id: i.id,
  id: i.id,
  url: i.url,
  public_id: i.publicId ?? undefined,
  alt: i.alt ?? undefined,
  isPrimary: i.isPrimary,
});

const serializeVariant = (v) => ({
  _id: v.id,
  id: v.id,
  name: v.name,
  value: v.value,
  stock: v.stock,
  price: v.price ?? undefined,
  sku: v.sku ?? undefined,
  images: v.images || [],
});

const serializeProduct = (p) => {
  if (!p) return null;
  return {
    _id: p.id,
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    shortDescription: p.shortDescription ?? undefined,
    price: p.price,
    compareAtPrice: p.compareAtPrice ?? undefined,
    currency: p.currency,
    video: p.video ?? undefined,
    images: (p.images || []).map(serializeImage),
    category: p.category ? serializeCategory(p.category) : p.categoryId,
    subcategory: p.subcategory ?? undefined,
    tags: p.tags || [],
    brand: p.brand ?? undefined,
    seller: p.seller ? serializeSellerSummary(p.seller) : p.sellerId,
    sku: p.sku ?? undefined,
    stock: p.stock,
    lowStockThreshold: p.lowStockThreshold,
    trackInventory: p.trackInventory,
    hasVariants: p.hasVariants,
    variants: (p.variants || []).map(serializeVariant),
    rating: {
      average: p.ratingAverage,
      count: p.ratingCount,
      distribution: p.ratingDistribution || { ...EMPTY_DISTRIBUTION },
    },
    status: p.status,
    isFeatured: p.isFeatured,
    isTrending: p.isTrending,
    isNewArrival: p.isNewArrival,
    seo: p.seo ?? undefined,
    shipping: p.shipping ?? undefined,
    discount: p.discount ?? undefined,
    views: p.views,
    sales: p.sales,
    revenue: p.revenue,
    wishlistCount: p.wishlistCount,
    discountedPrice: computeDiscountedPrice(p.price, p.discount),
    discountPercentage: computeDiscountPercentage(p.price, p.compareAtPrice),
    inStock: computeInStock(p.trackInventory, p.stock),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
};

// Standard includes for full product responses.
const PRODUCT_INCLUDE = {
  images: true,
  variants: true,
  category: true,
  seller: { include: { sellerProfile: true } },
};

module.exports = {
  prisma,
  computeDiscountedPrice,
  computeDiscountPercentage,
  computeInStock,
  serializeCategory,
  serializeSellerSummary,
  serializeImage,
  serializeVariant,
  serializeProduct,
  PRODUCT_INCLUDE,
};
```

- [ ] **Step 4: Run and watch pass**

Run: `npm test -- productService.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/productService.js backend/tests/services/productService.test.js
git commit -m "feat(products): add productService serialization"
```

---

### Task 3: productService — slug, SKU & body normalization

**Files:**
- Modify: `backend/services/productService.js`
- Test: `backend/tests/services/productService.test.js`

- [ ] **Step 1: Write the failing tests (append)**

Append to `backend/tests/services/productService.test.js`:

```js
const { prisma } = require('../../config/prisma');

describe('productService helpers', () => {
  it('normalizeProductBody splits tags and nests shipping/seo', () => {
    const out = productService.normalizeProductBody({
      name: 'X', tags: 'a, b ,c', weight: 100, isFreeShipping: true,
      metaTitle: 'T', metaDescription: 'D',
    });
    expect(out.tags).toEqual(['a', 'b', 'c']);
    expect(out.shipping).toEqual({ weight: 100, isFreeShipping: true });
    expect(out.seo).toEqual({ metaTitle: 'T', metaDescription: 'D' });
    expect(out.weight).toBeUndefined();
    expect(out.metaTitle).toBeUndefined();
  });

  it('generateSku produces a unique-looking SKU', () => {
    const sku = productService.generateSku();
    expect(sku).toMatch(/^SKU-\d+-[A-Z0-9]+$/);
  });
});

describe('productService.generateUniqueSlug', () => {
  afterEach(async () => {
    await prisma.product.deleteMany({});
    await prisma.category.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it('appends a counter when the base slug collides', async () => {
    const seller = await prisma.user.create({ data: { name: 'S', email: `s${Date.now()}@t.com`, role: 'seller' } });
    const cat = await prisma.category.create({ data: { name: 'C', slug: `c-${Date.now()}` } });
    await prisma.product.create({ data: { name: 'Cool Thing', slug: 'cool-thing', description: 'd', price: 1, categoryId: cat.id, sellerId: seller.id } });
    const slug = await productService.generateUniqueSlug('Cool Thing');
    expect(slug).toBe('cool-thing-1');
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `npm test -- productService.test.js -t "helpers"`
Expected: FAIL — `normalizeProductBody is not a function`.

- [ ] **Step 3: Add helpers**

In `backend/services/productService.js`, add `const slugify = require('slugify');` at the top, then before `module.exports`:

```js
const normalizeProductBody = (body) => {
  const data = { ...body };
  if (typeof data.tags === 'string') {
    data.tags = data.tags.split(',').map((t) => t.trim()).filter(Boolean);
  }
  if (data.weight !== undefined || data.isFreeShipping !== undefined) {
    data.shipping = { weight: data.weight, isFreeShipping: data.isFreeShipping };
    delete data.weight;
    delete data.isFreeShipping;
  }
  if (data.metaTitle !== undefined || data.metaDescription !== undefined) {
    data.seo = { metaTitle: data.metaTitle, metaDescription: data.metaDescription };
    delete data.metaTitle;
    delete data.metaDescription;
  }
  return data;
};

const generateSku = () =>
  `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

const generateUniqueSlug = async (name) => {
  const base = slugify(name, { lower: true, strict: true });
  let slug = base;
  let count = 0;
  // eslint-disable-next-line no-await-in-loop
  while (await prisma.product.findUnique({ where: { slug } })) {
    count += 1;
    slug = `${base}-${count}`;
  }
  return slug;
};
```

Add `normalizeProductBody`, `generateSku`, `generateUniqueSlug` to `module.exports`.

- [ ] **Step 4: Run and watch pass**

Run: `npm test -- productService.test.js`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add backend/services/productService.js backend/tests/services/productService.test.js
git commit -m "feat(products): add slug/sku/normalize helpers"
```

---

### Task 4: productService — full-text search query

`searchProductIds` runs the FTS query against the generated `tsvector`, applying the same filters as the normal listing, and returns ranked ids + total. Filters are built as `Prisma.sql` fragments so the same WHERE drives both the id page and the count.

**Files:**
- Modify: `backend/services/productService.js`
- Test: `backend/tests/services/productService.test.js`

- [ ] **Step 1: Write the failing test (append)**

Append to `backend/tests/services/productService.test.js`:

```js
describe('productService.searchProductIds', () => {
  let seller, cat;
  beforeEach(async () => {
    seller = await prisma.user.create({ data: { name: 'S', email: `s${Date.now()}${Math.random()}@t.com`, role: 'seller' } });
    cat = await prisma.category.create({ data: { name: 'C', slug: `c-${Date.now()}${Math.random()}` } });
    await prisma.product.create({ data: { name: 'Blue Running Shoes', slug: `blue-${Date.now()}`, description: 'fast comfortable', price: 50, status: 'active', categoryId: cat.id, sellerId: seller.id } });
    await prisma.product.create({ data: { name: 'Red Hat', slug: `red-${Date.now()}`, description: 'warm wool', price: 20, status: 'active', categoryId: cat.id, sellerId: seller.id } });
  });
  afterEach(async () => {
    await prisma.product.deleteMany({});
    await prisma.category.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it('returns only products matching the search term', async () => {
    const { ids, total } = await productService.searchProductIds({ term: 'shoes', filters: [], skip: 0, take: 20 });
    expect(total).toBe(1);
    expect(ids).toHaveLength(1);
    const p = await prisma.product.findUnique({ where: { id: ids[0] } });
    expect(p.name).toBe('Blue Running Shoes');
  });

  it('applies extra filters alongside the search', async () => {
    const { Prisma } = require('@prisma/client');
    const { total } = await productService.searchProductIds({
      term: 'warm', filters: [Prisma.sql`p."price" < 10`], skip: 0, take: 20,
    });
    expect(total).toBe(0); // Red Hat is 20
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `npm test -- productService.test.js -t "searchProductIds"`
Expected: FAIL — `searchProductIds is not a function`.

- [ ] **Step 3: Implement the FTS query**

In `backend/services/productService.js`, add `const { Prisma } = require('@prisma/client');` near the top, then before `module.exports`:

```js
// term: user search string; filters: array of Prisma.sql WHERE fragments referencing alias p.
// orderBy: optional Prisma.sql ORDER BY fragment; defaults to rank desc.
const searchProductIds = async ({ term, filters = [], orderBy, skip = 0, take = 20 }) => {
  const tsquery = Prisma.sql`websearch_to_tsquery('english', ${term})`;
  const conds = [Prisma.sql`p."searchVector" @@ ${tsquery}`, ...filters];
  const where = Prisma.join(conds, ' AND ');
  const order = orderBy || Prisma.sql`ts_rank(p."searchVector", ${tsquery}) DESC`;

  const rows = await prisma.$queryRaw`
    SELECT p.id FROM "Product" p
    WHERE ${where}
    ORDER BY ${order}
    OFFSET ${skip} LIMIT ${take}
  `;
  const countRows = await prisma.$queryRaw`
    SELECT count(*)::int AS count FROM "Product" p WHERE ${where}
  `;
  return { ids: rows.map((r) => r.id), total: countRows[0].count };
};
```

Add `searchProductIds` to `module.exports`.

- [ ] **Step 4: Run and watch pass**

Run: `npm test -- productService.test.js`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add backend/services/productService.js backend/tests/services/productService.test.js
git commit -m "feat(products): add tsvector full-text search query"
```

---

### Task 5: Test harness + auditLog test guard

**Files:**
- Modify: `backend/tests/helpers/buildApp.js`
- Modify: `backend/middleware/index.js` (`auditLog`)

- [ ] **Step 1: Mount product + category routers in the harness**

In `backend/tests/helpers/buildApp.js`, update the destructured routers and the mounts:

```js
const { authRouter, userRouter, productRouter, categoryRouter } = require('../../routes/index');
```

and add after the existing `app.use('/api/users', userRouter);`:

```js
  app.use('/api/products', productRouter);
  app.use('/api/categories', categoryRouter);
```

- [ ] **Step 2: Guard the auditLog DB write in tests**

In `backend/middleware/index.js`, inside `auditLog`, wrap the `await AuditLog.create({...})` so it is skipped under test (it otherwise blocks ~10s waiting on a Mongo connection that tests don't have):

Change:

```js
      try {
        await AuditLog.create({
```

to:

```js
      try {
        if (process.env.NODE_ENV !== 'test') {
          await AuditLog.create({
```

and add the matching closing brace before the `} catch (err) {`:

```js
          });
        }
      } catch (err) {
```

(The original `});` that closed `AuditLog.create(...)` is now followed by `}` closing the `if`.)

- [ ] **Step 3: Verify existing suites still pass (harness change is safe)**

Run: `npm test -- auth.test.js`
Expected: PASS (19) — confirms the harness still builds with the new routers mounted.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/helpers/buildApp.js backend/middleware/index.js
git commit -m "test(products): mount product/category routers; skip auditLog DB write in tests"
```

---

### Task 6: Port category controllers

**Files:**
- Modify: `backend/controllers/index.js` (`createCategory`, `getCategories`, `updateCategory`, `deleteCategory`)
- Test: `backend/tests/categories.test.js`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/categories.test.js`:

```js
jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
  emailTemplates: { verification: () => ({ subject: 's', html: 'h' }), passwordReset: () => ({ subject: 's', html: 'h' }), sellerApproval: () => ({ subject: 's', html: 'h' }) },
}));

const request = require('supertest');
const { buildApp } = require('./helpers/buildApp');
const { prisma } = require('../config/prisma');
const { generateTokenPair } = require('../utils/jwt');

const app = buildApp();

async function adminToken() {
  const u = await prisma.user.create({ data: { name: 'A', email: `a${Date.now()}${Math.random()}@t.com`, role: 'admin' } });
  return generateTokenPair(u.id, u.role).accessToken;
}

describe('categories', () => {
  afterEach(async () => {
    await prisma.product.deleteMany({});
    await prisma.category.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it('creates a category with a generated slug (admin)', async () => {
    const token = await adminToken();
    const res = await request(app).post('/api/categories').set('Authorization', `Bearer ${token}`).send({ name: 'Foot Wear' });
    expect(res.status).toBe(201);
    expect(res.body.data.slug).toBe('foot-wear');
    expect(res.body.data._id).toBeDefined();
  });

  it('lists active categories sorted by sortOrder then name', async () => {
    await prisma.category.create({ data: { name: 'Beta', slug: 'beta', sortOrder: 1 } });
    await prisma.category.create({ data: { name: 'Alpha', slug: 'alpha', sortOrder: 0 } });
    await prisma.category.create({ data: { name: 'Hidden', slug: 'hidden', isActive: false } });
    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(200);
    const names = res.body.data.map((c) => c.name);
    expect(names).toEqual(['Alpha', 'Beta']);
    expect(res.body.data[0]._id).toBeDefined();
  });

  it('updates a category (admin)', async () => {
    const token = await adminToken();
    const c = await prisma.category.create({ data: { name: 'Old', slug: 'old' } });
    const res = await request(app).put(`/api/categories/${c.id}`).set('Authorization', `Bearer ${token}`).send({ description: 'new' });
    expect(res.status).toBe(200);
    expect(res.body.data.description).toBe('new');
  });

  it('soft-deletes a category (admin)', async () => {
    const token = await adminToken();
    const c = await prisma.category.create({ data: { name: 'Del', slug: 'del' } });
    const res = await request(app).delete(`/api/categories/${c.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const inDb = await prisma.category.findUnique({ where: { id: c.id } });
    expect(inDb.isActive).toBe(false);
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `npm test -- categories.test.js`
Expected: FAIL — Mongoose calls.

- [ ] **Step 3: Port the four handlers**

In `backend/controllers/index.js`, ensure `productService` is required (add near the `userService` require from 1B):

```js
const productService = require('../services/productService');
```

Replace `createCategory`, `getCategories`, `updateCategory`, `deleteCategory`:

```js
const createCategory = async (req, res, next) => {
  try {
    const slug = slugify(req.body.name, { lower: true, strict: true });
    const { name, description, image, icon, parent, sortOrder, seo } = req.body;
    const category = await prisma.category.create({
      data: {
        name, slug,
        description, image, icon,
        parentId: parent || null,
        sortOrder: sortOrder ?? 0,
        seo: seo ?? undefined,
      },
    });
    await cache.del('categories:all');
    await cache.flush('cache:categories:*');
    return ApiResponse.created(res, productService.serializeCategory(category));
  } catch (err) { next(err); }
};

const getCategories = async (req, res, next) => {
  try {
    const cacheKey = 'categories:all';
    const cached = await cache.get(cacheKey);
    if (cached) return ApiResponse.success(res, cached);

    const categories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const data = categories.map(productService.serializeCategory);
    await cache.set(cacheKey, data, 600);
    return ApiResponse.success(res, data);
  } catch (err) { next(err); }
};

const updateCategory = async (req, res, next) => {
  try {
    const { name, description, image, icon, parent, sortOrder, isActive, seo } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (image !== undefined) data.image = image;
    if (icon !== undefined) data.icon = icon;
    if (parent !== undefined) data.parentId = parent || null;
    if (sortOrder !== undefined) data.sortOrder = sortOrder;
    if (isActive !== undefined) data.isActive = isActive;
    if (seo !== undefined) data.seo = seo;

    const category = await prisma.category.update({ where: { id: req.params.id }, data }).catch(() => null);
    if (!category) return next(ApiError.notFound('Category not found'));
    await cache.del('categories:all');
    return ApiResponse.success(res, productService.serializeCategory(category), 'Category updated');
  } catch (err) { next(err); }
};

const deleteCategory = async (req, res, next) => {
  try {
    await prisma.category.update({ where: { id: req.params.id }, data: { isActive: false } }).catch(() => null);
    await cache.del('categories:all');
    return ApiResponse.success(res, null, 'Category deactivated');
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Run and watch pass**

Run: `npm test -- categories.test.js`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/index.js backend/tests/categories.test.js
git commit -m "feat(categories): port category CRUD to Prisma"
```

---

### Task 7: Port getProducts + getProduct

**Files:**
- Rewrite (begin): `backend/controllers/productController.js`
- Test: `backend/tests/products.test.js`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/products.test.js`:

```js
jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
  emailTemplates: { verification: () => ({ subject: 's', html: 'h' }), passwordReset: () => ({ subject: 's', html: 'h' }), sellerApproval: () => ({ subject: 's', html: 'h' }) },
}));

const request = require('supertest');
const { buildApp } = require('./helpers/buildApp');
const { prisma } = require('../config/prisma');
const { generateTokenPair } = require('../utils/jwt');

const app = buildApp();

async function seedCatalog() {
  const seller = await prisma.user.create({
    data: { name: 'Seller', email: `sel${Date.now()}${Math.random()}@t.com`, role: 'seller', sellerProfile: { create: { storeName: 'Shop', storeSlug: `shop-${Date.now()}${Math.random()}`, isApproved: true } } },
  });
  const cat = await prisma.category.create({ data: { name: 'Shoes', slug: `shoes-${Date.now()}${Math.random()}` } });
  const active = await prisma.product.create({
    data: { name: 'Blue Running Shoes', slug: `blue-${Date.now()}${Math.random()}`, description: 'fast and comfortable', price: 50, status: 'active', categoryId: cat.id, sellerId: seller.id, images: { create: [{ url: 'u', publicId: 'pid', isPrimary: true }] } },
  });
  const draft = await prisma.product.create({
    data: { name: 'Secret Draft', slug: `draft-${Date.now()}${Math.random()}`, description: 'hidden', price: 10, status: 'draft', categoryId: cat.id, sellerId: seller.id },
  });
  return { seller, cat, active, draft };
}

async function cleanup() {
  await prisma.product.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.user.deleteMany({});
}

describe('GET /api/products', () => {
  afterEach(cleanup);

  it('returns only active products to the public, paginated with the standard envelope', async () => {
    await seedCatalog();
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pagination).toMatchObject({ page: 1, total: 1 });
    expect(res.body.data).toHaveLength(1);
    const p = res.body.data[0];
    expect(p.name).toBe('Blue Running Shoes');
    expect(p.rating).toMatchObject({ average: 0, count: 0 });
    expect(p.category).toMatchObject({ name: 'Shoes' });
    expect(p.seller.sellerProfile.storeName).toBe('Shop');
    expect(p.inStock).toBe(false); // stock 0, trackInventory true
  });

  it('filters by price range', async () => {
    await seedCatalog();
    const res = await request(app).get('/api/products?minPrice=100');
    expect(res.body.data).toHaveLength(0);
  });

  it('ranks full-text search results and excludes non-matches', async () => {
    await seedCatalog();
    const res = await request(app).get('/api/products?search=shoes');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Blue Running Shoes');
  });
});

describe('GET /api/products/:slug', () => {
  afterEach(cleanup);

  it('returns a product by slug and increments views', async () => {
    const { active } = await seedCatalog();
    const res = await request(app).get(`/api/products/${active.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe(active.id);
    expect(res.body.data.images[0].url).toBe('u');
  });

  it('404s an unknown slug', async () => {
    const res = await request(app).get('/api/products/nope-nope');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `npm test -- products.test.js -t "GET /api/products"`
Expected: FAIL — Mongoose.

- [ ] **Step 3: Rewrite the controller header + filter helpers + getProducts + getProduct**

Replace the top of `backend/controllers/productController.js` down through `getProduct` with:

```js
const { Prisma } = require('@prisma/client');
const { prisma } = require('../config/prisma');
const productService = require('../services/productService');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { cache } = require('../config/redis');
const logger = require('../utils/logger');
const { deleteImage } = require('../config/cloudinary');

const { serializeProduct, PRODUCT_INCLUDE } = productService;

// Build a Prisma `where` for listing (non-search path).
const buildProductWhere = (query) => {
  const where = {};
  if (query.category) where.categoryId = query.category;
  if (query.seller) where.sellerId = query.seller;
  if (query.brand) where.brand = { contains: query.brand, mode: 'insensitive' };
  if (query.tags) where.tags = { hasSome: query.tags.split(',') };
  if (query.status) where.status = query.status;
  if (query.featured === 'true') where.isFeatured = true;
  if (query.trending === 'true') where.isTrending = true;
  if (query.newArrival === 'true') where.isNewArrival = true;
  if (query.inStock === 'true') where.stock = { gt: 0 };
  if (query.minPrice || query.maxPrice) {
    where.price = {};
    if (query.minPrice) where.price.gte = parseFloat(query.minPrice);
    if (query.maxPrice) where.price.lte = parseFloat(query.maxPrice);
  }
  if (query.rating) where.ratingAverage = { gte: parseFloat(query.rating) };
  return where;
};

// Build SQL filter fragments mirroring buildProductWhere for the FTS path.
const buildSqlFilters = (query) => {
  const f = [];
  if (query.category) f.push(Prisma.sql`p."categoryId" = ${query.category}`);
  if (query.seller) f.push(Prisma.sql`p."sellerId" = ${query.seller}`);
  if (query.brand) f.push(Prisma.sql`p."brand" ILIKE ${'%' + query.brand + '%'}`);
  if (query.status) f.push(Prisma.sql`p."status" = ${query.status}::"ProductStatus"`);
  if (query.featured === 'true') f.push(Prisma.sql`p."isFeatured" = true`);
  if (query.trending === 'true') f.push(Prisma.sql`p."isTrending" = true`);
  if (query.newArrival === 'true') f.push(Prisma.sql`p."isNewArrival" = true`);
  if (query.inStock === 'true') f.push(Prisma.sql`p."stock" > 0`);
  if (query.minPrice) f.push(Prisma.sql`p."price" >= ${parseFloat(query.minPrice)}`);
  if (query.maxPrice) f.push(Prisma.sql`p."price" <= ${parseFloat(query.maxPrice)}`);
  if (query.rating) f.push(Prisma.sql`p."ratingAverage" >= ${parseFloat(query.rating)}`);
  if (query.tags) f.push(Prisma.sql`p."tags" && ${query.tags.split(',')}`);
  return f;
};

const SORT_MAP = {
  '-createdAt': { createdAt: 'desc' },
  createdAt: { createdAt: 'asc' },
  '-price': { price: 'desc' },
  price: { price: 'asc' },
  '-rating': { ratingAverage: 'desc' },
  '-sales': { sales: 'desc' },
  '-views': { views: 'desc' },
  name: { name: 'asc' },
  '-name': { name: 'desc' },
};

// @desc Get all products (public)
// @route GET /api/products
const getProducts = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const publicOnly = !req.user || req.user.role === 'user';

    let products;
    let total;

    if (req.query.search) {
      const filters = buildSqlFilters(req.query);
      if (publicOnly) filters.push(Prisma.sql`p."status" = 'active'::"ProductStatus"`);
      const result = await productService.searchProductIds({ term: req.query.search, filters, skip, take: limit });
      total = result.total;
      const rows = await prisma.product.findMany({ where: { id: { in: result.ids } }, include: PRODUCT_INCLUDE });
      // preserve rank order from the FTS query
      const byId = new Map(rows.map((r) => [r.id, r]));
      products = result.ids.map((id) => byId.get(id)).filter(Boolean);
    } else {
      const where = buildProductWhere(req.query);
      if (publicOnly) where.status = 'active';
      const orderBy = SORT_MAP[req.query.sort] || { createdAt: 'desc' };
      [products, total] = await Promise.all([
        prisma.product.findMany({ where, orderBy, skip, take: limit, include: PRODUCT_INCLUDE }),
        prisma.product.count({ where }),
      ]);
    }

    const pages = Math.ceil(total / limit);
    return ApiResponse.paginated(res, products.map(serializeProduct), {
      page, limit, total, pages, hasNext: page < pages, hasPrev: page > 1,
    });
  } catch (err) { next(err); }
};

// @desc Get single product
// @route GET /api/products/:slug
const getProduct = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const cacheKey = `product:${slug}`;
    const cached = await cache.get(cacheKey);
    if (cached) return ApiResponse.success(res, cached);

    const product = await prisma.product.findFirst({
      where: { OR: [{ slug }, { id: slug }] },
      include: PRODUCT_INCLUDE,
    });
    if (!product) return next(ApiError.notFound('Product not found'));

    // Increment views (non-blocking)
    prisma.product.update({ where: { id: product.id }, data: { views: { increment: 1 } } }).catch(() => {});

    const data = serializeProduct(product);
    await cache.set(cacheKey, data, 300);
    return ApiResponse.success(res, data);
  } catch (err) { next(err); }
};
```

> `where: { OR: [{ slug }, { id: slug }] }` — Postgres uuid columns reject malformed uuid strings. A non-uuid slug like `nope-nope` would throw on the `{ id: slug }` term. Guard it: only include the `id` term when `slug` looks like a uuid.

Adjust the `findFirst` to:

```js
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const or = [{ slug }];
    if (uuidRe.test(slug)) or.push({ id: slug });
    const product = await prisma.product.findFirst({ where: { OR: or }, include: PRODUCT_INCLUDE });
```

- [ ] **Step 4: Keep the remaining handlers compiling**

The rest of `productController.js` (createProduct…getSellerStats) is still the Mongoose version and is ported in Tasks 8-10. Leave it for now, but the file must still `module.exports` everything. **Do not change the `module.exports` block.**

- [ ] **Step 5: Run and watch pass**

Run: `npm test -- products.test.js -t "GET /api/products"`
Expected: PASS (the 5 GET tests).

- [ ] **Step 6: Commit**

```bash
git add backend/controllers/productController.js backend/tests/products.test.js
git commit -m "feat(products): port getProducts (+FTS) & getProduct to Prisma"
```

---

### Task 8: Port getFeaturedProducts, getRelatedProducts, getMyProducts

**Files:**
- Modify: `backend/controllers/productController.js`
- Test: `backend/tests/products.test.js`

- [ ] **Step 1: Write the failing tests (append)**

Append to `backend/tests/products.test.js`:

```js
describe('product listings', () => {
  afterEach(cleanup);

  it('GET /api/products/featured groups featured/trending/newArrivals', async () => {
    const { seller, cat } = await seedCatalog();
    await prisma.product.create({ data: { name: 'Feat', slug: `feat-${Date.now()}${Math.random()}`, description: 'd', price: 9, status: 'active', isFeatured: true, categoryId: cat.id, sellerId: seller.id } });
    const res = await request(app).get('/api/products/featured');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('featured');
    expect(res.body.data.featured.some((p) => p.name === 'Feat')).toBe(true);
  });

  it('GET /api/products/:id/related returns same-category active products', async () => {
    const { active, cat, seller } = await seedCatalog();
    await prisma.product.create({ data: { name: 'Sibling', slug: `sib-${Date.now()}${Math.random()}`, description: 'd', price: 5, status: 'active', categoryId: cat.id, sellerId: seller.id } });
    const res = await request(app).get(`/api/products/${active.id}/related`);
    expect(res.status).toBe(200);
    expect(res.body.data.some((p) => p.name === 'Sibling')).toBe(true);
    expect(res.body.data.some((p) => p._id === active.id)).toBe(false);
  });

  it('GET /api/products/my-products returns the seller\'s own products', async () => {
    const { seller } = await seedCatalog();
    const token = generateTokenPair(seller.id, 'seller').accessToken;
    const res = await request(app).get('/api/products/my-products').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(2); // active + draft both belong to seller
  });
});
```

> `my-products` needs an **approved** seller (the seed creates `isApproved: true`), because `requireSeller` rejects unapproved sellers.

- [ ] **Step 2: Run and watch fail**

Run: `npm test -- products.test.js -t "product listings"`
Expected: FAIL — Mongoose.

- [ ] **Step 3: Port the three handlers**

In `backend/controllers/productController.js`, replace `getFeaturedProducts`, `getMyProducts`, `getRelatedProducts`:

```js
const getFeaturedProducts = async (req, res, next) => {
  try {
    const cacheKey = 'products:featured';
    const cached = await cache.get(cacheKey);
    if (cached) return ApiResponse.success(res, cached);

    const [featured, trending, newArrivals] = await Promise.all([
      prisma.product.findMany({ where: { isFeatured: true, status: 'active' }, take: 8, include: PRODUCT_INCLUDE }),
      prisma.product.findMany({ where: { isTrending: true, status: 'active' }, orderBy: { sales: 'desc' }, take: 12, include: PRODUCT_INCLUDE }),
      prisma.product.findMany({ where: { isNewArrival: true, status: 'active' }, orderBy: { createdAt: 'desc' }, take: 8, include: PRODUCT_INCLUDE }),
    ]);

    const data = {
      featured: featured.map(serializeProduct),
      trending: trending.map(serializeProduct),
      newArrivals: newArrivals.map(serializeProduct),
    };
    await cache.set(cacheKey, data, 600);
    return ApiResponse.success(res, data);
  } catch (err) { next(err); }
};

const getMyProducts = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const where = { sellerId: req.user._id };
    if (req.query.status) where.status = req.query.status;

    if (req.query.search) {
      const filters = [Prisma.sql`p."sellerId" = ${req.user._id}`];
      if (req.query.status) filters.push(Prisma.sql`p."status" = ${req.query.status}::"ProductStatus"`);
      const result = await productService.searchProductIds({ term: req.query.search, filters, skip, take: limit });
      const rows = await prisma.product.findMany({ where: { id: { in: result.ids } }, include: { category: true } });
      const byId = new Map(rows.map((r) => [r.id, r]));
      const products = result.ids.map((id) => byId.get(id)).filter(Boolean);
      return ApiResponse.paginated(res, products.map(serializeProduct), {
        page, limit, total: result.total, pages: Math.ceil(result.total / limit),
      });
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit, include: { category: true } }),
      prisma.product.count({ where }),
    ]);

    return ApiResponse.paginated(res, products.map(serializeProduct), {
      page, limit, total, pages: Math.ceil(total / limit),
    });
  } catch (err) { next(err); }
};

const getRelatedProducts = async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product) return next(ApiError.notFound('Product not found'));

    const related = await prisma.product.findMany({
      where: { id: { not: product.id }, categoryId: product.categoryId, status: 'active' },
      take: 6,
      include: { category: true },
    });

    return ApiResponse.success(res, related.map(serializeProduct));
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Run and watch pass**

Run: `npm test -- products.test.js -t "product listings"`
Expected: PASS (3).

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/productController.js backend/tests/products.test.js
git commit -m "feat(products): port featured/related/my-products to Prisma"
```

---

### Task 9: Port createProduct, updateProduct, deleteProduct

**Files:**
- Modify: `backend/controllers/productController.js`
- Test: `backend/tests/products.test.js`

- [ ] **Step 1: Write the failing tests (append)**

Append to `backend/tests/products.test.js`:

```js
describe('product mutations', () => {
  afterEach(cleanup);

  async function sellerCtx() {
    const seller = await prisma.user.create({
      data: { name: 'Seller', email: `sel${Date.now()}${Math.random()}@t.com`, role: 'seller', sellerProfile: { create: { storeName: 'Shop', storeSlug: `shop-${Date.now()}${Math.random()}`, isApproved: true } } },
    });
    const cat = await prisma.category.create({ data: { name: 'Shoes', slug: `shoes-${Date.now()}${Math.random()}` } });
    return { seller, cat, token: generateTokenPair(seller.id, 'seller').accessToken };
  }

  it('creates a product (seller), generating slug + SKU', async () => {
    const { cat, token } = await sellerCtx();
    const res = await request(app).post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .field('name', 'Green Boots')
      .field('description', 'sturdy leather boots')
      .field('price', '120')
      .field('category', cat.id)
      .field('tags', 'leather, boots');
    expect(res.status).toBe(201);
    expect(res.body.data.slug).toBe('green-boots');
    expect(res.body.data.sku).toMatch(/^SKU-/);
    expect(res.body.data.tags).toEqual(['leather', 'boots']);
    expect(res.body.data.category).toMatchObject({ name: 'Shoes' });
  });

  it('blocks updating another seller\'s product', async () => {
    const a = await sellerCtx();
    const b = await sellerCtx();
    const prod = await prisma.product.create({ data: { name: 'A prod', slug: `ap-${Date.now()}${Math.random()}`, description: 'd', price: 10, categoryId: a.cat.id, sellerId: a.seller.id } });
    const res = await request(app).put(`/api/products/${prod.id}`).set('Authorization', `Bearer ${b.token}`).field('name', 'Hacked');
    expect(res.status).toBe(403);
  });

  it('updates own product', async () => {
    const { seller, cat, token } = await sellerCtx();
    const prod = await prisma.product.create({ data: { name: 'Mine', slug: `mine-${Date.now()}${Math.random()}`, description: 'd', price: 10, categoryId: cat.id, sellerId: seller.id } });
    const res = await request(app).put(`/api/products/${prod.id}`).set('Authorization', `Bearer ${token}`).field('price', '99');
    expect(res.status).toBe(200);
    expect(res.body.data.price).toBe(99);
  });

  it('soft-deletes (archives) own product', async () => {
    const { seller, cat, token } = await sellerCtx();
    const prod = await prisma.product.create({ data: { name: 'Bye', slug: `bye-${Date.now()}${Math.random()}`, description: 'd', price: 10, categoryId: cat.id, sellerId: seller.id } });
    const res = await request(app).delete(`/api/products/${prod.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const inDb = await prisma.product.findUnique({ where: { id: prod.id } });
    expect(inDb.status).toBe('archived');
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `npm test -- products.test.js -t "product mutations"`
Expected: FAIL — Mongoose.

- [ ] **Step 3: Port the three handlers**

In `backend/controllers/productController.js`, replace `createProduct`, `updateProduct`, `deleteProduct`. (Delete the old `normalizeProductBody`/`addProductVirtuals`/`buildProductFilter`/`buildSort` helpers if any remain from the original file — they are superseded by `productService` and the Task 7 helpers.)

```js
// Build numeric/boolean coercions from multipart string fields.
const coerceProductScalars = (data) => {
  ['price', 'compareAtPrice', 'stock', 'lowStockThreshold'].forEach((k) => {
    if (data[k] !== undefined) data[k] = Number(data[k]);
  });
  ['isFeatured', 'isTrending', 'isNewArrival', 'trackInventory', 'hasVariants'].forEach((k) => {
    if (data[k] !== undefined) data[k] = data[k] === true || data[k] === 'true';
  });
  return data;
};

const createProduct = async (req, res, next) => {
  try {
    const body = coerceProductScalars(productService.normalizeProductBody(req.body));
    const categoryId = body.category;

    const data = {
      name: body.name,
      slug: await productService.generateUniqueSlug(body.name),
      description: body.description,
      shortDescription: body.shortDescription,
      price: body.price,
      compareAtPrice: body.compareAtPrice,
      currency: body.currency || 'USD',
      subcategory: body.subcategory,
      tags: body.tags || [],
      brand: body.brand,
      sku: body.sku || productService.generateSku(),
      stock: body.stock ?? 0,
      status: body.status || 'draft',
      isFeatured: body.isFeatured ?? false,
      isTrending: body.isTrending ?? false,
      isNewArrival: body.isNewArrival ?? false,
      seo: body.seo ?? undefined,
      shipping: body.shipping ?? undefined,
      categoryId,
      sellerId: req.user._id,
    };

    if (req.processedImages?.length) {
      data.images = {
        create: req.processedImages.map((img, i) => ({
          url: img.url, publicId: img.public_id, alt: req.body.name, isPrimary: i === 0,
        })),
      };
    }

    const product = await prisma.product.create({ data, include: PRODUCT_INCLUDE });
    await cache.flush('cache:products:*');
    logger.info(`Product created: ${product.name} by ${req.user.email}`);
    return ApiResponse.created(res, serializeProduct(product), 'Product created successfully');
  } catch (err) { next(err); }
};

const updateProduct = async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id }, include: { images: true } });
    if (!product) return next(ApiError.notFound('Product not found'));

    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
    if (!isAdmin && product.sellerId !== req.user._id) {
      return next(ApiError.forbidden('You can only update your own products'));
    }

    const body = coerceProductScalars(productService.normalizeProductBody(req.body));

    const data = {};
    ['name', 'description', 'shortDescription', 'price', 'compareAtPrice', 'currency',
     'subcategory', 'brand', 'sku', 'stock', 'status', 'isFeatured', 'isTrending',
     'isNewArrival'].forEach((k) => { if (body[k] !== undefined) data[k] = body[k]; });
    if (body.tags !== undefined) data.tags = body.tags;
    if (body.seo !== undefined) data.seo = body.seo;
    if (body.shipping !== undefined) data.shipping = body.shipping;
    if (body.category !== undefined) data.categoryId = body.category;

    // Image handling
    if (req.processedImages?.length) {
      const newImages = req.processedImages.map((img, i) => ({
        url: img.url, publicId: img.public_id, alt: body.name || product.name,
        isPrimary: i === 0 && product.images.length === 0,
      }));
      if (req.body.replaceImages === 'true') {
        await Promise.all(product.images.map((img) => deleteImage(img.publicId)));
        await prisma.productImage.deleteMany({ where: { productId: product.id } });
      }
      data.images = { create: newImages };
    }

    const updated = await prisma.product.update({ where: { id: product.id }, data, include: PRODUCT_INCLUDE });
    await cache.del(`product:${product.slug}`);
    await cache.flush('cache:products:*');
    return ApiResponse.success(res, serializeProduct(updated), 'Product updated successfully');
  } catch (err) { next(err); }
};

const deleteProduct = async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product) return next(ApiError.notFound('Product not found'));

    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
    if (!isAdmin && product.sellerId !== req.user._id) {
      return next(ApiError.forbidden('You can only delete your own products'));
    }

    await prisma.product.update({ where: { id: product.id }, data: { status: 'archived' } });
    await cache.del(`product:${product.slug}`);
    await cache.flush('cache:products:*');
    logger.info(`Product archived: ${product.name}`);
    return ApiResponse.success(res, null, 'Product deleted successfully');
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Run and watch pass**

Run: `npm test -- products.test.js -t "product mutations"`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/productController.js backend/tests/products.test.js
git commit -m "feat(products): port create/update/delete to Prisma"
```

---

### Task 10: Port getSellerStats

**Files:**
- Modify: `backend/controllers/productController.js`
- Test: `backend/tests/products.test.js`

- [ ] **Step 1: Write the failing test (append)**

Append to `backend/tests/products.test.js`:

```js
describe('GET /api/products/seller-stats', () => {
  afterEach(cleanup);

  it('returns product/revenue stats for the seller', async () => {
    const seller = await prisma.user.create({
      data: { name: 'Seller', email: `sel${Date.now()}${Math.random()}@t.com`, role: 'seller', sellerProfile: { create: { storeName: 'Shop', storeSlug: `shop-${Date.now()}${Math.random()}`, isApproved: true } } },
    });
    const cat = await prisma.category.create({ data: { name: 'C', slug: `c-${Date.now()}${Math.random()}` } });
    await prisma.product.create({ data: { name: 'P1', slug: `p1-${Date.now()}${Math.random()}`, description: 'd', price: 10, status: 'active', stock: 5, sales: 3, revenue: 30, views: 100, categoryId: cat.id, sellerId: seller.id } });
    const token = generateTokenPair(seller.id, 'seller').accessToken;

    const res = await request(app).get('/api/products/seller-stats').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('productStats');
    expect(res.body.data).toHaveProperty('revenueStats');
    expect(res.body.data.topProducts[0].name).toBe('P1');
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `npm test -- products.test.js -t "seller-stats"`
Expected: FAIL — Mongoose aggregate.

- [ ] **Step 3: Port the handler**

In `backend/controllers/productController.js`, replace `getSellerStats`:

```js
const getSellerStats = async (req, res, next) => {
  try {
    const sellerId = req.user._id;

    const [byStatus, totals, topProducts] = await Promise.all([
      prisma.product.groupBy({
        by: ['status'],
        where: { sellerId },
        _count: { _all: true },
        _sum: { stock: true },
      }),
      prisma.product.aggregate({
        where: { sellerId },
        _sum: { sales: true, revenue: true, views: true },
      }),
      prisma.product.findMany({
        where: { sellerId, status: 'active' },
        orderBy: { sales: 'desc' },
        take: 5,
        include: { images: true },
      }),
    ]);

    // Shape to mirror the previous aggregate output.
    const productStats = byStatus.map((g) => ({ _id: g.status, count: g._count._all, totalStock: g._sum.stock || 0 }));
    const revenueStats = [{
      _id: null,
      totalSales: totals._sum.sales || 0,
      totalRevenue: totals._sum.revenue || 0,
      totalViews: totals._sum.views || 0,
    }];

    return ApiResponse.success(res, {
      productStats,
      revenueStats,
      topProducts: topProducts.map(serializeProduct),
    });
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Run and watch pass**

Run: `npm test -- products.test.js -t "seller-stats"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/productController.js backend/tests/products.test.js
git commit -m "feat(products): port seller-stats aggregations to Prisma"
```

---

### Task 11: Port toggleWishlist + restore getWishlist + getMe wishlist population

**Files:**
- Modify: `backend/controllers/productController.js` (`toggleWishlist`)
- Modify: `backend/controllers/index.js` (`getWishlist`)
- Modify: `backend/controllers/authController.js` (`getMe`)
- Modify: `backend/services/productService.js` (add `getWishlistProducts`)
- Test: `backend/tests/categories.test.js` (wishlist lives in the user/category suite)

- [ ] **Step 1: Write the failing tests (append to categories.test.js)**

Append to `backend/tests/categories.test.js`:

```js
describe('wishlist', () => {
  afterEach(async () => {
    await prisma.product.deleteMany({});
    await prisma.category.deleteMany({});
    await prisma.user.deleteMany({});
  });

  async function ctx() {
    const user = await prisma.user.create({ data: { name: 'U', email: `u${Date.now()}${Math.random()}@t.com`, role: 'user' } });
    const seller = await prisma.user.create({ data: { name: 'S', email: `s${Date.now()}${Math.random()}@t.com`, role: 'seller' } });
    const cat = await prisma.category.create({ data: { name: 'C', slug: `c-${Date.now()}${Math.random()}` } });
    const prod = await prisma.product.create({ data: { name: 'Wish', slug: `w-${Date.now()}${Math.random()}`, description: 'd', price: 9, status: 'active', categoryId: cat.id, sellerId: seller.id, images: { create: [{ url: 'u', isPrimary: true }] } } });
    return { user, prod, token: generateTokenPair(user.id, 'user').accessToken };
  }

  it('toggles a product into and out of the wishlist', async () => {
    const { user, prod, token } = await ctx();
    const add = await request(app).post(`/api/products/${prod.id}/wishlist`).set('Authorization', `Bearer ${token}`);
    expect(add.status).toBe(200);
    expect(add.body.data.wishlisted).toBe(true);
    let inDb = await prisma.user.findUnique({ where: { id: user.id } });
    expect(inDb.wishlist).toContain(prod.id);

    const remove = await request(app).post(`/api/products/${prod.id}/wishlist`).set('Authorization', `Bearer ${token}`);
    expect(remove.body.data.wishlisted).toBe(false);
    inDb = await prisma.user.findUnique({ where: { id: user.id } });
    expect(inDb.wishlist).not.toContain(prod.id);
  });

  it('GET /api/users/wishlist returns populated product summaries', async () => {
    const { user, prod, token } = await ctx();
    await prisma.user.update({ where: { id: user.id }, data: { wishlist: [prod.id] } });
    const res = await request(app).get('/api/users/wishlist').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ _id: prod.id, name: 'Wish' });
  });

  it('GET /api/auth/me returns wishlist populated with product summaries', async () => {
    const { user, prod, token } = await ctx();
    await prisma.user.update({ where: { id: user.id }, data: { wishlist: [prod.id] } });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.wishlist).toHaveLength(1);
    expect(res.body.data.wishlist[0]).toMatchObject({ _id: prod.id, name: 'Wish' });
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `npm test -- categories.test.js -t "wishlist"`
Expected: FAIL — Mongoose / id-only wishlist.

- [ ] **Step 3: Add `getWishlistProducts` to productService**

In `backend/services/productService.js`, before `module.exports`:

```js
// Returns serialized product summaries for an array of product ids, preserving order.
const getWishlistProducts = async (ids) => {
  if (!ids || ids.length === 0) return [];
  const rows = await prisma.product.findMany({
    where: { id: { in: ids } },
    include: { images: true, category: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean).map(serializeProduct);
};
```

Add `getWishlistProducts` to `module.exports`.

- [ ] **Step 4: Port `toggleWishlist`**

In `backend/controllers/productController.js`, replace `toggleWishlist`:

```js
const toggleWishlist = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) return next(ApiError.notFound('Product not found'));

    const user = await prisma.user.findUnique({ where: { id: req.user._id }, select: { wishlist: true } });
    const isWishlisted = (user.wishlist || []).includes(id);
    const nextWishlist = isWishlisted
      ? user.wishlist.filter((x) => x !== id)
      : [...(user.wishlist || []), id];

    await prisma.user.update({ where: { id: req.user._id }, data: { wishlist: nextWishlist } });
    await prisma.product.update({ where: { id }, data: { wishlistCount: { increment: isWishlisted ? -1 : 1 } } });

    return ApiResponse.success(res, { wishlisted: !isWishlisted });
  } catch (err) { next(err); }
};
```

- [ ] **Step 5: Port `getWishlist`**

In `backend/controllers/index.js`, replace `getWishlist`:

```js
const getWishlist = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user._id }, select: { wishlist: true } });
    const products = await productService.getWishlistProducts(user.wishlist || []);
    return ApiResponse.success(res, products);
  } catch (err) { next(err); }
};
```

- [ ] **Step 6: Restore wishlist population in `getMe`**

In `backend/controllers/authController.js`, add `const productService = require('../services/productService');` near the top, and replace `getMe`:

```js
const getMe = async (req, res, next) => {
  try {
    const user = await userService.findById(req.user._id);
    const safe = userService.toSafeObject(user);
    safe.wishlist = await productService.getWishlistProducts(user.wishlist || []);
    return ApiResponse.success(res, safe, 'User fetched');
  } catch (err) { next(err); }
};
```

> Update the 1B `auth.test.js` expectation that asserted `wishlist` is `[]` for a fresh user — it still holds (empty array), so no change is needed there.

- [ ] **Step 7: Run and watch pass**

Run: `npm test -- categories.test.js -t "wishlist"` then `npm test -- auth.test.js`
Expected: PASS for wishlist; auth suite still green.

- [ ] **Step 8: Commit**

```bash
git add backend/controllers/productController.js backend/controllers/index.js backend/controllers/authController.js backend/services/productService.js backend/tests/categories.test.js
git commit -m "feat(products): port wishlist toggle/list & restore getMe population"
```

---

### Task 12: Port getSellerStore

**Files:**
- Modify: `backend/controllers/index.js` (`getSellerStore`)
- Test: `backend/tests/categories.test.js`

- [ ] **Step 1: Write the failing test (append)**

Append to `backend/tests/categories.test.js`:

```js
describe('GET /api/users/store/:slug', () => {
  afterEach(async () => {
    await prisma.product.deleteMany({});
    await prisma.category.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it('returns the seller and their active products', async () => {
    const slug = `shop-${Date.now()}${Math.random()}`;
    const seller = await prisma.user.create({
      data: { name: 'Seller', email: `sel${Date.now()}${Math.random()}@t.com`, role: 'seller', sellerProfile: { create: { storeName: 'My Shop', storeSlug: slug, isApproved: true } } },
    });
    const cat = await prisma.category.create({ data: { name: 'C', slug: `c-${Date.now()}${Math.random()}` } });
    await prisma.product.create({ data: { name: 'Live', slug: `live-${Date.now()}${Math.random()}`, description: 'd', price: 5, status: 'active', categoryId: cat.id, sellerId: seller.id } });
    await prisma.product.create({ data: { name: 'Draft', slug: `draft-${Date.now()}${Math.random()}`, description: 'd', price: 5, status: 'draft', categoryId: cat.id, sellerId: seller.id } });

    const res = await request(app).get(`/api/users/store/${slug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.seller.sellerProfile.storeName).toBe('My Shop');
    expect(res.body.data.products).toHaveLength(1);
    expect(res.body.data.products[0].name).toBe('Live');
  });

  it('404s an unknown store slug', async () => {
    const res = await request(app).get('/api/users/store/nope-shop');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `npm test -- categories.test.js -t "store"`
Expected: FAIL — Mongoose.

- [ ] **Step 3: Port the handler**

In `backend/controllers/index.js`, replace `getSellerStore`:

```js
const getSellerStore = async (req, res, next) => {
  try {
    const profile = await prisma.sellerProfile.findUnique({
      where: { storeSlug: req.params.slug },
      include: { user: true },
    });
    if (!profile || !profile.user) return next(ApiError.notFound('Store not found'));

    const products = await prisma.product.findMany({
      where: { sellerId: profile.userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { images: true, category: true },
    });

    const seller = {
      _id: profile.user.id,
      id: profile.user.id,
      name: profile.user.name,
      createdAt: profile.user.createdAt,
      sellerProfile: userService.serializeSellerProfile(profile),
    };

    return ApiResponse.success(res, { seller, products: products.map(productService.serializeProduct) });
  } catch (err) { next(err); }
};
```

> `userService.serializeSellerProfile` (from 1B) strips bank fields and the `id`/`userId`. It expects the raw `sellerProfile` row, which `profile` is.

- [ ] **Step 4: Run and watch pass**

Run: `npm test -- categories.test.js`
Expected: PASS (all in file).

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/index.js backend/tests/categories.test.js
git commit -m "feat(products): port seller storefront to Prisma"
```

---

### Task 13: Full verification, roadmap, push & merge

**Files:**
- Modify: `docs/ROADMAP.md`
- Verify: full backend suite + server boot

- [ ] **Step 1: Run the entire backend suite**

Run (from `backend/`): `npm test`
Expected: all suites pass — `userService`, `productService`, `auth`, `passport`, `users`, `categories`, `products`, `foundation`, smoke.

- [ ] **Step 2: Boot the server (dual DB)**

Run: `npm run dev`
Expected: `PostgreSQL (Prisma) connected`, MongoDB + Redis connected, listens on 5000. Stop after confirming.

- [ ] **Step 3: Live smoke — list products & categories**

With the server running, the dev DB is empty of Prisma products (Mongo seed data is separate), so just confirm the endpoints return the envelope:

```bash
curl -s http://localhost:5000/api/products | head -c 300
curl -s http://localhost:5000/api/categories | head -c 300
```

Expected: `{"statusCode":200,"success":true,...,"data":[...],...}` for both. Stop the server.

- [ ] **Step 4: Update the roadmap**

In `docs/ROADMAP.md`, mark sub-plan **1C** done in the "Sub-plan progress" list: `- [x] **1C — Products & Categories + search:** productController, category CRUD, wishlist + storefront on Prisma; tsvector/pg_trgm full-text search; wishlist population restored in getMe.`

- [ ] **Step 5: Commit, push, merge to main**

```bash
git add docs/ROADMAP.md
git commit -m "docs: mark Phase 1C (products, categories, search) complete"
git push origin develop
```

Then merge to main per the user's workflow (only if the user confirms — the user merges develop→main):

```bash
git checkout main && git merge --ff-only develop && git push origin main && git checkout develop
```

---

## Self-review checklist (completed during authoring)

- **Spec coverage:** Phase-1 design items for this slice are covered — products/categories ported (Tasks 6-10), full-text search via tsvector + GIN + pg_trgm (Tasks 1, 4, 7), wishlist population restored (Task 11), seller storefront restored (Task 12). Aggregations (seller stats) ported via Prisma `groupBy`/`aggregate` (Task 10). Order/payment transactions, reviews, admin, audit cleanup remain in 1D/1E per the design sequence.
- **Placeholder scan:** No TBD / "handle errors" / "similar to Task N". Every code step has complete code; shared serialization lives in `productService` and is referenced by path.
- **Type/name consistency:** `productService` exports used across tasks match their definitions (`serializeProduct`, `serializeCategory`, `serializeSellerSummary`, `PRODUCT_INCLUDE`, `normalizeProductBody`, `generateSku`, `generateUniqueSlug`, `searchProductIds`, `getWishlistProducts`, `computeDiscountedPrice/Percentage/InStock`). `req.user._id` (uuid) consumed throughout. `buildSqlFilters`/`buildProductWhere` cover the same query params. The `searchProductIds({ term, filters, skip, take })` signature matches all three call sites (getProducts, getMyProducts, and both unit tests).

## Remaining Phase 1 plans (after 1C)

- **1D — Cart & Orders + coupons:** port cart/order/coupon controllers; wrap order placement in `prisma.$transaction`.
- **1E — Reviews, carriers, warehouse, feedback, admin, audit:** port remaining controllers; complete `Carrier`/`Warehouse` models; audit-log cleanup job; mount `reviewRouter`/`adminRouter` in the harness.
- **1F — Seeder rewrite & Mongoose removal:** rewrite `utils/seeder.js` on Prisma; remove Mongoose/Mongo from code, deps, and compose.
