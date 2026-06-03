jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
  emailTemplates: { verification: () => ({ subject: 's', html: 'h' }) },
}));

const request = require('supertest');
const { buildApp } = require('./helpers/buildApp');
const { prisma } = require('../config/prisma');
const { generateTokenPair } = require('../utils/jwt');

const app = buildApp();
const uniq = () => `${Date.now()}${Math.random()}`;

async function setup() {
  const seller = await prisma.user.create({ data: { name: 'S', email: `s${uniq()}@t.com`, role: 'seller' } });
  const cat = await prisma.category.create({ data: { name: 'C', slug: `c-${uniq()}` } });
  const product = await prisma.product.create({ data: { name: 'Tee', slug: `tee-${uniq()}`, description: 'd', price: 20, status: 'active', categoryId: cat.id, sellerId: seller.id } });
  const user = await prisma.user.create({ data: { name: 'Rev', email: `u${uniq()}@t.com`, role: 'user', avatar: 'a.jpg' } });
  return { seller, cat, product, user, token: generateTokenPair(user.id, 'user').accessToken };
}

afterEach(async () => {
  await prisma.review.deleteMany({});
  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.user.deleteMany({});
});

describe('reviews', () => {
  it('creates a review and recomputes the product rating', async () => {
    const { product, token } = await setup();
    const res = await request(app).post(`/api/products/${product.id}/reviews`).set('Authorization', `Bearer ${token}`).send({ rating: 4, title: 'Good', body: 'nice' });
    expect(res.status).toBe(201);
    expect(res.body.data._id).toBeDefined();
    expect(res.body.data.product).toBe(product.id);
    expect(res.body.data.user).toMatchObject({ name: 'Rev', avatar: 'a.jpg' });
    expect(res.body.data.isVerifiedPurchase).toBe(false);

    const dbProduct = await prisma.product.findUnique({ where: { id: product.id } });
    expect(dbProduct.ratingAverage).toBe(4);
    expect(dbProduct.ratingCount).toBe(1);
    expect(dbProduct.ratingDistribution).toMatchObject({ '4': 1 });
  });

  it('marks the review as a verified purchase when a delivered order exists', async () => {
    const { product, user, token } = await setup();
    await prisma.order.create({
      data: {
        orderNumber: `CUR-${uniq()}`, userId: user.id, shippingAddress: {}, subtotal: 20, totalPrice: 20,
        paymentMethod: 'cod', status: 'delivered',
        items: { create: [{ productId: product.id, sellerId: product.sellerId, name: 'Tee', price: 20, quantity: 1 }] },
      },
    });
    const res = await request(app).post(`/api/products/${product.id}/reviews`).set('Authorization', `Bearer ${token}`).send({ rating: 5 });
    expect(res.body.data.isVerifiedPurchase).toBe(true);
  });

  it('rejects a duplicate review from the same user', async () => {
    const { product, token } = await setup();
    await request(app).post(`/api/products/${product.id}/reviews`).set('Authorization', `Bearer ${token}`).send({ rating: 3 });
    const res = await request(app).post(`/api/products/${product.id}/reviews`).set('Authorization', `Bearer ${token}`).send({ rating: 4 });
    expect(res.status).toBe(409);
  });

  it('lists approved reviews paginated, newest first', async () => {
    const { product, token } = await setup();
    await request(app).post(`/api/products/${product.id}/reviews`).set('Authorization', `Bearer ${token}`).send({ rating: 5, body: 'a' });
    const res = await request(app).get(`/api/products/${product.id}/reviews`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.data[0].user).toMatchObject({ name: 'Rev' });
  });

  it('updates a review (owner) and recomputes rating', async () => {
    const { product, token } = await setup();
    const c = await request(app).post(`/api/products/${product.id}/reviews`).set('Authorization', `Bearer ${token}`).send({ rating: 2 });
    const id = c.body.data._id;
    const res = await request(app).put(`/api/products/${product.id}/reviews/${id}`).set('Authorization', `Bearer ${token}`).send({ rating: 5 });
    expect(res.status).toBe(200);
    expect(res.body.data.rating).toBe(5);
    const dbProduct = await prisma.product.findUnique({ where: { id: product.id } });
    expect(dbProduct.ratingAverage).toBe(5);
  });

  it('forbids updating someone else\'s review', async () => {
    const { product, token } = await setup();
    const c = await request(app).post(`/api/products/${product.id}/reviews`).set('Authorization', `Bearer ${token}`).send({ rating: 2 });
    const id = c.body.data._id;
    const other = await prisma.user.create({ data: { name: 'O', email: `o${uniq()}@t.com`, role: 'user' } });
    const otherToken = generateTokenPair(other.id, 'user').accessToken;
    const res = await request(app).put(`/api/products/${product.id}/reviews/${id}`).set('Authorization', `Bearer ${otherToken}`).send({ rating: 1 });
    expect(res.status).toBe(403);
  });

  it('deletes a review (owner) and recomputes rating to zero', async () => {
    const { product, token } = await setup();
    const c = await request(app).post(`/api/products/${product.id}/reviews`).set('Authorization', `Bearer ${token}`).send({ rating: 4 });
    const id = c.body.data._id;
    const res = await request(app).delete(`/api/products/${product.id}/reviews/${id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const dbProduct = await prisma.product.findUnique({ where: { id: product.id } });
    expect(dbProduct.ratingCount).toBe(0);
    expect(dbProduct.ratingAverage).toBe(0);
  });

  it('increments helpful votes', async () => {
    const { product, token } = await setup();
    const c = await request(app).post(`/api/products/${product.id}/reviews`).set('Authorization', `Bearer ${token}`).send({ rating: 4 });
    const id = c.body.data._id;
    await request(app).post(`/api/products/${product.id}/reviews/${id}/helpful`).set('Authorization', `Bearer ${token}`);
    const review = await prisma.review.findUnique({ where: { id } });
    expect(review.helpfulVotes).toBe(1);
  });
});
