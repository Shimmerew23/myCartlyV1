// Focused per-route-group integration tests asserting the API still returns the
// frozen response envelope/shape after the MongoDB -> PostgreSQL/Prisma migration
// (Phase 1 workstream: "Focused integration test per route group asserting
// unchanged envelope/shape"). One representative endpoint per mounted router.
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
const { expectEnvelope, expectPaginatedEnvelope, expectErrorEnvelope } = require('./helpers/envelope');
const { prisma } = require('../config/prisma');
const { generateTokenPair } = require('../utils/jwt');

const app = buildApp();
const uniq = () => `${Date.now()}${Math.random()}`;

let ctx;

beforeAll(async () => {
  const u = uniq();
  const user = await prisma.user.create({ data: { name: 'Buyer', email: `buyer-${u}@t.com`, role: 'user' } });
  const admin = await prisma.user.create({ data: { name: 'Admin', email: `admin-${u}@t.com`, role: 'admin' } });
  const warehouse = await prisma.user.create({ data: { name: 'WH', email: `wh-${u}@t.com`, role: 'warehouse' } });
  const seller = await prisma.user.create({
    data: {
      name: 'Seller', email: `seller-${u}@t.com`, role: 'seller',
      sellerProfile: { create: { storeName: 'Shop', storeSlug: `shop-${u}`, isApproved: true } },
    },
  });
  const category = await prisma.category.create({ data: { name: 'Shoes', slug: `shoes-${u}` } });
  const product = await prisma.product.create({
    data: {
      name: 'Blue Running Shoes', slug: `blue-${u}`, description: 'fast and comfortable',
      price: 50, stock: 5, status: 'active', categoryId: category.id, sellerId: seller.id,
      images: { create: [{ url: 'u', publicId: 'pid', isPrimary: true }] },
    },
  });

  ctx = {
    product,
    userToken: generateTokenPair(user.id, 'user').accessToken,
    adminToken: generateTokenPair(admin.id, 'admin').accessToken,
    warehouseToken: generateTokenPair(warehouse.id, 'warehouse').accessToken,
  };
});

afterAll(async () => {
  await prisma.feedback.deleteMany({});
  await prisma.orderStatusEvent.deleteMany({});
  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.cartItem.deleteMany({});
  await prisma.cart.deleteMany({});
  await prisma.review.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.user.deleteMany({});
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe('Response envelope/shape per route group', () => {
  it('auth: POST /api/auth/register -> created envelope, _id alias + password stripped', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Jane', email: `jane-${uniq()}@t.com`, password: 'Passw0rd!@', confirmPassword: 'Passw0rd!@',
    });
    expectEnvelope(res, 201);
    expect(res.body.data.user._id).toBeDefined();
    expect(res.body.data.user.password).toBeUndefined();
    expect(res.body.data.accessToken).toBeDefined();
  });

  it('products: GET /api/products -> paginated envelope with legacy product shape', async () => {
    const res = await request(app).get('/api/products');
    expectPaginatedEnvelope(res);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]._id).toBeDefined();
    expect(res.body.data[0].category).toBeDefined();
    expect(res.body.data[0].rating).toBeDefined();
  });

  it('reviews: GET /api/products/:productId/reviews -> envelope with array data', async () => {
    const res = await request(app).get(`/api/products/${ctx.product.id}/reviews`);
    expectEnvelope(res, 200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('categories: GET /api/categories -> envelope with array data', async () => {
    const res = await request(app).get('/api/categories');
    expectEnvelope(res, 200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('carriers: GET /api/carriers -> envelope with array data', async () => {
    const res = await request(app).get('/api/carriers');
    expectEnvelope(res, 200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('cart: GET /api/cart -> envelope with cart shape', async () => {
    const res = await request(app).get('/api/cart').set(auth(ctx.userToken));
    expectEnvelope(res, 200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  it('users: GET /api/users/wishlist -> envelope with array data', async () => {
    const res = await request(app).get('/api/users/wishlist').set(auth(ctx.userToken));
    expectEnvelope(res, 200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('orders: GET /api/orders/my-orders -> envelope with array data', async () => {
    const res = await request(app).get('/api/orders/my-orders').set(auth(ctx.userToken));
    expectEnvelope(res, 200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('feedback: POST /api/feedback -> created envelope with _id alias', async () => {
    const res = await request(app).post('/api/feedback').send({
      category: 'general', subject: 'Hi', message: 'Great store',
    });
    expectEnvelope(res, 201);
    expect(res.body.data._id).toBeDefined();
  });

  it('admin: GET /api/admin/dashboard -> envelope with object data', async () => {
    const res = await request(app).get('/api/admin/dashboard').set(auth(ctx.adminToken));
    expectEnvelope(res, 200);
    expect(typeof res.body.data).toBe('object');
    expect(res.body.data).not.toBeNull();
  });

  it('warehouse: GET /api/warehouse/scan (no match) -> standard error envelope', async () => {
    const res = await request(app).get('/api/warehouse/scan?q=NO-SUCH-ORDER-9999').set(auth(ctx.warehouseToken));
    expectErrorEnvelope(res, 404);
  });
});
