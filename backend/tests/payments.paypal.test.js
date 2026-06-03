jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
  emailTemplates: { verification: () => ({ subject: 's', html: 'h' }), orderConfirmation: () => ({ subject: 's', html: 'h' }) },
}));
jest.mock('../config/paypal');

const request = require('supertest');
const paypal = require('../config/paypal');
const { buildApp } = require('./helpers/buildApp');
const { prisma } = require('../config/prisma');
const { generateTokenPair } = require('../utils/jwt');

const app = buildApp();
const uniq = () => `${Date.now()}${Math.random()}`;

beforeEach(() => {
  jest.clearAllMocks();
  paypal.isConfigured.mockReturnValue(true);
});

async function setup() {
  const buyer = await prisma.user.create({ data: { name: 'B', email: `b${uniq()}@t.com`, role: 'user' } });
  const seller = await prisma.user.create({ data: { name: 'S', email: `s${uniq()}@t.com`, role: 'seller' } });
  const cat = await prisma.category.create({ data: { name: 'C', slug: `c-${uniq()}` } });
  const product = await prisma.product.create({ data: { name: 'P', slug: `p-${uniq()}`, description: 'd', price: 50, status: 'active', stock: 5, categoryId: cat.id, sellerId: seller.id } });
  return { buyer, product, token: generateTokenPair(buyer.id, 'user').accessToken };
}

const ADDRESS = { name: 'B', street: '1 St', city: 'Town', state: 'ST', country: 'US', zipCode: '00001' };

afterEach(async () => {
  await prisma.orderStatusEvent.deleteMany({});
  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.cartItem.deleteMany({});
  await prisma.cart.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.user.deleteMany({});
});

describe('PayPal checkout', () => {
  it('creates a PayPal order and returns the approve URL', async () => {
    const { buyer, product, token } = await setup();
    paypal.createOrder.mockResolvedValue({ id: 'PP-1', status: 'CREATED', approveUrl: 'https://paypal/approve/PP-1' });
    await request(app).post('/api/cart/add').set('Authorization', `Bearer ${token}`).send({ productId: product.id, quantity: 1 });

    const res = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`)
      .send({ shippingAddress: ADDRESS, paymentMethod: 'paypal' });
    expect(res.status).toBe(201);
    expect(res.body.data.payment).toMatchObject({ provider: 'paypal', status: 'created', approveUrl: 'https://paypal/approve/PP-1', providerRef: 'PP-1' });
    expect(res.body.data.order.paymentMethod).toBe('paypal');

    const dbOrder = await prisma.order.findFirst({ where: { userId: buyer.id } });
    expect(dbOrder.paymentStatus).toBe('pending');
    expect(dbOrder.paymentResult).toMatchObject({ id: 'PP-1', provider: 'paypal' });
  });

  it('400s when PayPal is not configured', async () => {
    const { product, token } = await setup();
    paypal.isConfigured.mockReturnValue(false);
    await request(app).post('/api/cart/add').set('Authorization', `Bearer ${token}`).send({ productId: product.id, quantity: 1 });
    const res = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send({ shippingAddress: ADDRESS, paymentMethod: 'paypal' });
    expect(res.status).toBe(400);
  });

  it('captures the payment on return and marks the order paid', async () => {
    const { product, token } = await setup();
    paypal.createOrder.mockResolvedValue({ id: 'PP-2', status: 'CREATED', approveUrl: 'https://paypal/approve/PP-2' });
    paypal.captureOrder.mockResolvedValue({ id: 'PP-2', status: 'COMPLETED', captureId: 'CAP-2', raw: {} });
    await request(app).post('/api/cart/add').set('Authorization', `Bearer ${token}`).send({ productId: product.id, quantity: 1 });
    const created = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send({ shippingAddress: ADDRESS, paymentMethod: 'paypal' });
    const id = created.body.data.order._id;

    const res = await request(app).post(`/api/orders/${id}/capture`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.payment).toMatchObject({ status: 'paid', captureId: 'CAP-2' });
    expect(res.body.data.order.paymentStatus).toBe('paid');
    expect(res.body.data.order.status).toBe('confirmed');

    const db = await prisma.order.findUnique({ where: { id } });
    expect(db.paymentStatus).toBe('paid');
    expect(db.paymentResult).toMatchObject({ captureId: 'CAP-2', status: 'completed' });
  });

  it('forbids a non-owner from capturing', async () => {
    const { product, token } = await setup();
    paypal.createOrder.mockResolvedValue({ id: 'PP-3', status: 'CREATED', approveUrl: 'u' });
    await request(app).post('/api/cart/add').set('Authorization', `Bearer ${token}`).send({ productId: product.id, quantity: 1 });
    const created = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send({ shippingAddress: ADDRESS, paymentMethod: 'paypal' });
    const id = created.body.data.order._id;

    const stranger = await prisma.user.create({ data: { name: 'X', email: `x${uniq()}@t.com`, role: 'user' } });
    const res = await request(app).post(`/api/orders/${id}/capture`).set('Authorization', `Bearer ${generateTokenPair(stranger.id, 'user').accessToken}`);
    expect(res.status).toBe(403);
  });
});

describe('PayPal webhook', () => {
  it('marks the order paid on PAYMENT.CAPTURE.COMPLETED', async () => {
    const buyer = await prisma.user.create({ data: { name: 'B', email: `b${uniq()}@t.com`, role: 'user' } });
    const order = await prisma.order.create({
      data: { orderNumber: `CUR-${uniq()}`, userId: buyer.id, shippingAddress: {}, subtotal: 50, totalPrice: 50, paymentMethod: 'paypal', paymentResult: { id: 'PP-WH', provider: 'paypal' } },
    });
    paypal.verifyWebhookSignature.mockResolvedValue(true);

    const res = await request(app).post('/api/orders/webhook/paypal').send({
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: 'CAP-WH', supplementary_data: { related_ids: { order_id: 'PP-WH' } } },
    });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const db = await prisma.order.findUnique({ where: { id: order.id } });
    expect(db.paymentStatus).toBe('paid');
  });

  it('rejects an unverified webhook', async () => {
    paypal.verifyWebhookSignature.mockResolvedValue(false);
    const res = await request(app).post('/api/orders/webhook/paypal').send({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {} });
    expect(res.status).toBe(400);
  });
});
