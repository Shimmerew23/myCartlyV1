jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
  emailTemplates: { verification: () => ({ subject: 's', html: 'h' }), orderConfirmation: () => ({ subject: 's', html: 'h' }) },
}));
jest.mock('../config/paymongo');

const request = require('supertest');
const paymongo = require('../config/paymongo');
const { buildApp } = require('./helpers/buildApp');
const { prisma } = require('../config/prisma');
const { generateTokenPair } = require('../utils/jwt');

const app = buildApp();
const uniq = () => `${Date.now()}${Math.random()}`;

beforeEach(() => {
  jest.clearAllMocks();
  paymongo.isConfigured.mockReturnValue(true);
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

describe('GCash checkout', () => {
  it('creates a GCash source and returns the checkout URL', async () => {
    const { buyer, product, token } = await setup();
    paymongo.createSource.mockResolvedValue({ id: 'src_1', checkoutUrl: 'https://paymongo/checkout/src_1', status: 'pending' });
    await request(app).post('/api/cart/add').set('Authorization', `Bearer ${token}`).send({ productId: product.id, quantity: 1 });

    const res = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`)
      .send({ shippingAddress: ADDRESS, paymentMethod: 'gcash' });
    expect(res.status).toBe(201);
    expect(res.body.data.payment).toMatchObject({ provider: 'gcash', status: 'pending', approveUrl: 'https://paymongo/checkout/src_1', providerRef: 'src_1' });
    expect(res.body.data.order.paymentMethod).toBe('gcash');

    const dbOrder = await prisma.order.findFirst({ where: { userId: buyer.id } });
    expect(dbOrder.paymentStatus).toBe('pending');
    expect(dbOrder.paymentResult).toMatchObject({ id: 'src_1', provider: 'gcash' });
  });

  it('400s when GCash is not configured', async () => {
    const { product, token } = await setup();
    paymongo.isConfigured.mockReturnValue(false);
    await request(app).post('/api/cart/add').set('Authorization', `Bearer ${token}`).send({ productId: product.id, quantity: 1 });
    const res = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send({ shippingAddress: ADDRESS, paymentMethod: 'gcash' });
    expect(res.status).toBe(400);
  });
});

describe('GCash (PayMongo) webhook', () => {
  it('creates the payment and marks the order paid on source.chargeable', async () => {
    const buyer = await prisma.user.create({ data: { name: 'B', email: `b${uniq()}@t.com`, role: 'user' } });
    const order = await prisma.order.create({
      data: { orderNumber: `CUR-${uniq()}`, userId: buyer.id, shippingAddress: {}, subtotal: 50, totalPrice: 50, paymentMethod: 'gcash', paymentResult: { id: 'src_WH', provider: 'gcash' } },
    });
    paymongo.verifyWebhookSignature.mockReturnValue(true);
    paymongo.createPaymentFromSource.mockResolvedValue({ id: 'pay_WH', status: 'paid' });

    const res = await request(app).post('/api/orders/webhook/paymongo').send({
      data: { attributes: { type: 'source.chargeable', data: { id: 'src_WH' } } },
    });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(paymongo.createPaymentFromSource).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'src_WH', currency: 'PHP' }));

    const db = await prisma.order.findUnique({ where: { id: order.id } });
    expect(db.paymentStatus).toBe('paid');
    expect(db.status).toBe('confirmed');
    expect(db.paymentResult).toMatchObject({ captureId: 'pay_WH', status: 'completed' });
  });

  it('is idempotent for an already-paid order on payment.paid', async () => {
    const buyer = await prisma.user.create({ data: { name: 'B', email: `b${uniq()}@t.com`, role: 'user' } });
    const order = await prisma.order.create({
      data: { orderNumber: `CUR-${uniq()}`, userId: buyer.id, shippingAddress: {}, subtotal: 50, totalPrice: 50, paymentMethod: 'gcash', paymentStatus: 'paid', paidAt: new Date(), paymentResult: { id: 'src_PD', provider: 'gcash', captureId: 'pay_PD', status: 'completed' } },
    });
    paymongo.verifyWebhookSignature.mockReturnValue(true);

    const res = await request(app).post('/api/orders/webhook/paymongo').send({
      data: { attributes: { type: 'payment.paid', data: { id: 'pay_PD2', attributes: { source: { id: 'src_PD' } } } } },
    });
    expect(res.status).toBe(200);

    const db = await prisma.order.findUnique({ where: { id: order.id } });
    expect(db.paymentStatus).toBe('paid');
    // Idempotent: the original capture id is preserved (markOrderPaid returns early).
    expect(db.paymentResult.captureId).toBe('pay_PD');
  });

  it('rejects an unverified webhook', async () => {
    paymongo.verifyWebhookSignature.mockReturnValue(false);
    const res = await request(app).post('/api/orders/webhook/paymongo').send({ data: { attributes: { type: 'source.chargeable', data: {} } } });
    expect(res.status).toBe(400);
  });
});
