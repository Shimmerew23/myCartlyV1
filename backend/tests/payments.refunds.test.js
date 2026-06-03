jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
  emailTemplates: { verification: () => ({ subject: 's', html: 'h' }), orderConfirmation: () => ({ subject: 's', html: 'h' }) },
}));
jest.mock('../config/paypal');
jest.mock('../config/paymongo');

const request = require('supertest');
const paypal = require('../config/paypal');
const paymongo = require('../config/paymongo');
const { buildApp } = require('./helpers/buildApp');
const { prisma } = require('../config/prisma');
const { generateTokenPair } = require('../utils/jwt');

const app = buildApp();
const uniq = () => `${Date.now()}${Math.random()}`;

beforeEach(() => {
  jest.clearAllMocks();
  paypal.isConfigured.mockReturnValue(true);
  paymongo.isConfigured.mockReturnValue(true);
});

afterEach(async () => {
  await prisma.orderStatusEvent.deleteMany({});
  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.user.deleteMany({});
});

async function actors() {
  const admin = await prisma.user.create({ data: { name: 'A', email: `a${uniq()}@t.com`, role: 'admin' } });
  const buyer = await prisma.user.create({ data: { name: 'B', email: `b${uniq()}@t.com`, role: 'user' } });
  return {
    admin, buyer,
    adminToken: generateTokenPair(admin.id, 'admin').accessToken,
    buyerToken: generateTokenPair(buyer.id, 'user').accessToken,
  };
}

const paidOrder = (userId, over = {}) => prisma.order.create({
  data: {
    orderNumber: `RF-${uniq()}`, userId, shippingAddress: {}, subtotal: 100, totalPrice: 100,
    paymentMethod: 'paypal', paymentStatus: 'paid', paidAt: new Date(),
    paymentResult: { id: 'PP-1', provider: 'paypal', captureId: 'CAP-1', status: 'completed' },
    ...over,
  },
});

describe('POST /api/orders/:id/refund', () => {
  it('admin issues a full refund → paymentStatus refunded, order status refunded', async () => {
    const { admin, buyer, adminToken } = await actors();
    const order = await paidOrder(buyer.id);
    paypal.refundCapture.mockResolvedValue({ id: 'RE-1', status: 'COMPLETED' });

    const res = await request(app).post(`/api/orders/${order.id}/refund`)
      .set('Authorization', `Bearer ${adminToken}`).send({ reason: 'changed mind' });

    expect(res.status).toBe(200);
    expect(paypal.refundCapture).toHaveBeenCalledWith('CAP-1', 100, 'USD');
    expect(res.body.data.order.paymentStatus).toBe('refunded');
    expect(res.body.data.order.status).toBe('refunded');

    const db = await prisma.order.findUnique({ where: { id: order.id } });
    expect(db.paymentStatus).toBe('refunded');
    expect(db.status).toBe('refunded');
    expect(db.paymentResult.refundedAmount).toBe(100);
    expect(db.paymentResult.refunds).toHaveLength(1);
    expect(db.paymentResult.refunds[0]).toMatchObject({ id: 'RE-1', amount: 100 });
    // (audit row is wired via auditLog('REFUND_ORDER') but the middleware skips the DB write under NODE_ENV=test)
  });

  it('admin issues a partial refund → partially_refunded, accumulates on a second partial', async () => {
    const { buyer, adminToken } = await actors();
    const order = await paidOrder(buyer.id);
    paypal.refundCapture.mockResolvedValue({ id: 'RE-A', status: 'COMPLETED' });

    const r1 = await request(app).post(`/api/orders/${order.id}/refund`)
      .set('Authorization', `Bearer ${adminToken}`).send({ amount: 40 });
    expect(r1.status).toBe(200);
    expect(r1.body.data.order.paymentStatus).toBe('partially_refunded');

    const mid = await prisma.order.findUnique({ where: { id: order.id } });
    expect(mid.paymentResult.refundedAmount).toBe(40);
    expect(mid.status).not.toBe('refunded');

    // Second partial completes the balance → refunded.
    paypal.refundCapture.mockResolvedValue({ id: 'RE-B', status: 'COMPLETED' });
    const fresh = await prisma.order.findUnique({ where: { id: order.id } });
    const r2 = await request(app).post(`/api/orders/${fresh.id}/refund`)
      .set('Authorization', `Bearer ${adminToken}`).send({ amount: 60 });
    expect(r2.status).toBe(200);
    expect(r2.body.data.order.paymentStatus).toBe('refunded');

    const db = await prisma.order.findUnique({ where: { id: order.id } });
    expect(db.paymentResult.refundedAmount).toBe(100);
    expect(db.paymentResult.refunds).toHaveLength(2);
  });

  it('dispatches a GCash refund through PayMongo', async () => {
    const { buyer, adminToken } = await actors();
    const order = await paidOrder(buyer.id, {
      paymentMethod: 'gcash',
      paymentResult: { id: 'src_1', provider: 'gcash', captureId: 'pay_1', status: 'completed' },
    });
    paymongo.refundPayment.mockResolvedValue({ id: 'ref_1', status: 'pending' });

    const res = await request(app).post(`/api/orders/${order.id}/refund`)
      .set('Authorization', `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(200);
    expect(paymongo.refundPayment).toHaveBeenCalledWith('pay_1', 100, expect.any(String));
    expect(res.body.data.order.paymentStatus).toBe('refunded');
  });

  it('rejects a refund on an unpaid order (400)', async () => {
    const { buyer, adminToken } = await actors();
    const order = await paidOrder(buyer.id, { paymentStatus: 'pending', paidAt: null });
    const res = await request(app).post(`/api/orders/${order.id}/refund`)
      .set('Authorization', `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(400);
    expect(paypal.refundCapture).not.toHaveBeenCalled();
  });

  it('forbids non-admin callers (403)', async () => {
    const { buyer, buyerToken } = await actors();
    const order = await paidOrder(buyer.id);
    const res = await request(app).post(`/api/orders/${order.id}/refund`)
      .set('Authorization', `Bearer ${buyerToken}`).send({});
    expect(res.status).toBe(403);
  });
});
