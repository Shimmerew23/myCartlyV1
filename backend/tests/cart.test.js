jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
  emailTemplates: {
    verification: () => ({ subject: 's', html: 'h' }),
    orderConfirmation: () => ({ subject: 's', html: 'h' }),
  },
}));

const request = require('supertest');
const { buildApp } = require('./helpers/buildApp');
const { prisma } = require('../config/prisma');
const { generateTokenPair } = require('../utils/jwt');

const app = buildApp();
const uniq = () => `${Date.now()}${Math.random()}`;

async function ctx(productOver = {}) {
  const user = await prisma.user.create({ data: { name: 'U', email: `u${uniq()}@t.com`, role: 'user' } });
  const seller = await prisma.user.create({ data: { name: 'S', email: `s${uniq()}@t.com`, role: 'seller', sellerProfile: { create: { storeName: 'Shop' } } } });
  const cat = await prisma.category.create({ data: { name: 'C', slug: `c-${uniq()}` } });
  const product = await prisma.product.create({
    data: {
      name: 'Tee', slug: `tee-${uniq()}`, description: 'd', price: 20, status: 'active',
      stock: 5, trackInventory: true, categoryId: cat.id, sellerId: seller.id,
      images: { create: [{ url: 'u', isPrimary: true }] },
      ...productOver,
    },
  });
  return { user, seller, cat, product, token: generateTokenPair(user.id, 'user').accessToken };
}

afterEach(async () => {
  await prisma.cartItem.deleteMany({});
  await prisma.cart.deleteMany({});
  await prisma.couponUsage.deleteMany({});
  await prisma.coupon.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.user.deleteMany({});
});

describe('cart', () => {
  it('GET /api/cart returns an empty cart envelope for a new user', async () => {
    const { token } = await ctx();
    const res = await request(app).get('/api/cart').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ items: [], subtotal: 0, itemCount: 0, coupon: null });
  });

  it('POST /api/cart/add adds an item with a populated product summary', async () => {
    const { product, token } = await ctx();
    const res = await request(app).post('/api/cart/add').set('Authorization', `Bearer ${token}`).send({ productId: product.id, quantity: 2 });
    expect(res.status).toBe(200);
    expect(res.body.data.itemCount).toBe(2);
    expect(res.body.data.subtotal).toBe(40);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0]._id).toBeDefined();
    expect(res.body.data.items[0].product).toMatchObject({ _id: product.id, name: 'Tee' });
    expect(res.body.data.items[0].product.seller.sellerProfile.storeName).toBe('Shop');
  });

  it('merges quantity when the same product+variant is added twice', async () => {
    const { product, token } = await ctx();
    await request(app).post('/api/cart/add').set('Authorization', `Bearer ${token}`).send({ productId: product.id, quantity: 1 });
    const res = await request(app).post('/api/cart/add').set('Authorization', `Bearer ${token}`).send({ productId: product.id, quantity: 2 });
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].quantity).toBe(3);
  });

  it('rejects adding more than available stock', async () => {
    const { product, token } = await ctx();
    const res = await request(app).post('/api/cart/add').set('Authorization', `Bearer ${token}`).send({ productId: product.id, quantity: 99 });
    expect(res.status).toBe(400);
  });

  it('PUT updates quantity and removes the item when quantity <= 0', async () => {
    const { product, token } = await ctx();
    const add = await request(app).post('/api/cart/add').set('Authorization', `Bearer ${token}`).send({ productId: product.id, quantity: 1 });
    const itemId = add.body.data.items[0]._id;

    const up = await request(app).put(`/api/cart/items/${itemId}`).set('Authorization', `Bearer ${token}`).send({ quantity: 4 });
    expect(up.body.data.items[0].quantity).toBe(4);

    const zero = await request(app).put(`/api/cart/items/${itemId}`).set('Authorization', `Bearer ${token}`).send({ quantity: 0 });
    expect(zero.body.data.items).toHaveLength(0);
  });

  it('DELETE removes a single item', async () => {
    const { product, token } = await ctx();
    const add = await request(app).post('/api/cart/add').set('Authorization', `Bearer ${token}`).send({ productId: product.id, quantity: 1 });
    const itemId = add.body.data.items[0]._id;
    const res = await request(app).delete(`/api/cart/items/${itemId}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(0);
  });

  it('DELETE /api/cart clears the cart and coupon', async () => {
    const { product, token } = await ctx();
    await request(app).post('/api/cart/add').set('Authorization', `Bearer ${token}`).send({ productId: product.id, quantity: 1 });
    const res = await request(app).delete('/api/cart').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
    const after = await request(app).get('/api/cart').set('Authorization', `Bearer ${token}`);
    expect(after.body.data.items).toHaveLength(0);
  });

  it('GET filters out items whose product is no longer active', async () => {
    const { product, token } = await ctx();
    await request(app).post('/api/cart/add').set('Authorization', `Bearer ${token}`).send({ productId: product.id, quantity: 1 });
    await prisma.product.update({ where: { id: product.id }, data: { status: 'archived' } });
    const res = await request(app).get('/api/cart').set('Authorization', `Bearer ${token}`);
    expect(res.body.data.items).toHaveLength(0);
  });
});

describe('cart coupon', () => {
  async function withCart(couponData) {
    const { product, user, token } = await ctx();
    await request(app).post('/api/cart/add').set('Authorization', `Bearer ${token}`).send({ productId: product.id, quantity: 2 }); // subtotal 40
    const coupon = couponData ? await prisma.coupon.create({ data: couponData }) : null;
    return { product, user, token, coupon };
  }

  it('applies a valid coupon and returns coupon + subtotal', async () => {
    const { token } = await withCart({
      code: 'SAVE10', discountType: 'percentage', discountValue: 10, minimumOrderAmount: 0,
      validFrom: new Date(Date.now() - 1000), validUntil: new Date(Date.now() + 86400000), isActive: true,
    });
    const res = await request(app).post('/api/cart/coupon').set('Authorization', `Bearer ${token}`).send({ code: 'save10' });
    expect(res.status).toBe(200);
    expect(res.body.data.coupon).toMatchObject({ code: 'SAVE10', discountType: 'percentage', discountValue: 10 });
    expect(res.body.data.subtotal).toBe(40);
  });

  it('404s an unknown coupon code', async () => {
    const { token } = await withCart(null);
    const res = await request(app).post('/api/cart/coupon').set('Authorization', `Bearer ${token}`).send({ code: 'NOPE' });
    expect(res.status).toBe(404);
  });

  it('rejects an expired coupon', async () => {
    const { token } = await withCart({
      code: 'OLD', discountType: 'fixed', discountValue: 5,
      validFrom: new Date(Date.now() - 100000), validUntil: new Date(Date.now() - 1000), isActive: true,
    });
    const res = await request(app).post('/api/cart/coupon').set('Authorization', `Bearer ${token}`).send({ code: 'OLD' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expired/i);
  });

  it('rejects when subtotal is below the minimum order amount', async () => {
    const { token } = await withCart({
      code: 'BIG', discountType: 'fixed', discountValue: 5, minimumOrderAmount: 1000,
      validFrom: new Date(Date.now() - 1000), validUntil: new Date(Date.now() + 86400000), isActive: true,
    });
    const res = await request(app).post('/api/cart/coupon').set('Authorization', `Bearer ${token}`).send({ code: 'BIG' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/minimum/i);
  });
});
