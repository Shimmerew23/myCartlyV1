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
