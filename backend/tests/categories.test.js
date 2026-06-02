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
