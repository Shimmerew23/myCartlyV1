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

async function adminToken() {
  const u = await prisma.user.create({ data: { name: 'Adm', email: `a${uniq()}@t.com`, role: 'admin' } });
  return generateTokenPair(u.id, 'admin').accessToken;
}

const validCouponBody = (over = {}) => ({
  code: 'save20',
  discountType: 'percentage',
  discountValue: 20,
  minimumOrderAmount: 50,
  validFrom: new Date(Date.now() - 1000).toISOString(),
  validUntil: new Date(Date.now() + 86400000).toISOString(),
  ...over,
});

afterEach(async () => {
  await prisma.couponUsage.deleteMany({});
  await prisma.coupon.deleteMany({});
  await prisma.user.deleteMany({});
});

describe('admin coupons', () => {
  it('creates a coupon (admin), uppercasing the code, with createdBy and empty usedBy', async () => {
    const token = await adminToken();
    const res = await request(app).post('/api/admin/coupons').set('Authorization', `Bearer ${token}`).send(validCouponBody());
    expect(res.status).toBe(201);
    expect(res.body.data._id).toBeDefined();
    expect(res.body.data.code).toBe('SAVE20');
    expect(res.body.data.discountType).toBe('percentage');
    expect(res.body.data.usageCount).toBe(0);
    expect(res.body.data.usedBy).toEqual([]);
    expect(res.body.data.createdBy).toBeDefined();
  });

  it('requires admin (non-admin is forbidden)', async () => {
    const u = await prisma.user.create({ data: { name: 'U', email: `u${uniq()}@t.com`, role: 'user' } });
    const token = generateTokenPair(u.id, 'user').accessToken;
    const res = await request(app).post('/api/admin/coupons').set('Authorization', `Bearer ${token}`).send(validCouponBody());
    expect(res.status).toBe(403);
  });

  it('lists coupons newest first', async () => {
    const token = await adminToken();
    await prisma.coupon.create({ data: { code: 'OLD', discountType: 'fixed', discountValue: 5, validFrom: new Date(Date.now() - 20000), validUntil: new Date(Date.now() + 86400000), createdAt: new Date(Date.now() - 20000) } });
    await prisma.coupon.create({ data: { code: 'NEW', discountType: 'fixed', discountValue: 5, validFrom: new Date(), validUntil: new Date(Date.now() + 86400000) } });
    const res = await request(app).get('/api/admin/coupons').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((c) => c.code)).toEqual(['NEW', 'OLD']);
    expect(res.body.data[0]._id).toBeDefined();
  });

  it('deletes a coupon', async () => {
    const token = await adminToken();
    const c = await prisma.coupon.create({ data: { code: 'DEL', discountType: 'fixed', discountValue: 5, validFrom: new Date(), validUntil: new Date(Date.now() + 86400000) } });
    const res = await request(app).delete(`/api/admin/coupons/${c.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(await prisma.coupon.findUnique({ where: { id: c.id } })).toBeNull();
  });
});
