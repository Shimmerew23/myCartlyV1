jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
  emailTemplates: { verification: () => ({ subject: 's', html: 'h' }), sellerApproval: () => ({ subject: 's', html: 'h' }) },
}));

const request = require('supertest');
const { buildApp } = require('./helpers/buildApp');
const { prisma } = require('../config/prisma');
const { generateTokenPair } = require('../utils/jwt');

const app = buildApp();
const uniq = () => `${Date.now()}${Math.random()}`;

async function admin(role = 'admin') {
  const u = await prisma.user.create({ data: { name: 'Adm', email: `a${uniq()}@t.com`, role } });
  return { user: u, token: generateTokenPair(u.id, role).accessToken };
}

afterEach(async () => {
  await prisma.orderStatusEvent.deleteMany({});
  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.sellerProfile.deleteMany({});
  await prisma.user.deleteMany({});
});

describe('admin dashboard', () => {
  it('returns the dashboard stats envelope', async () => {
    const { token } = await admin();
    const seller = await prisma.user.create({ data: { name: 'Sel', email: `s${uniq()}@t.com`, role: 'seller', sellerProfile: { create: { isApproved: false } } } });
    const cat = await prisma.category.create({ data: { name: 'Cat', slug: `c-${uniq()}` } });
    await prisma.product.create({ data: { name: 'P', slug: `p-${uniq()}`, description: 'd', price: 10, status: 'active', sales: 3, categoryId: cat.id, sellerId: seller.id } });

    const res = await request(app).get('/api/admin/dashboard').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('users.total');
    expect(res.body.data.sellers.pendingApprovals).toBeGreaterThanOrEqual(1);
    expect(res.body.data.products.active).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.data.orders.byStatus)).toBe(true);
    expect(Array.isArray(res.body.data.categoryStats)).toBe(true);
    expect(res.body.data.categoryStats[0]).toMatchObject({ name: 'Cat', productCount: 1 });
  });
});

describe('admin users', () => {
  it('lists users (safe objects, no password) with search', async () => {
    const { token } = await admin();
    await prisma.user.create({ data: { name: 'Zelda Searchable', email: `z${uniq()}@t.com`, role: 'user', password: 'secret' } });
    const res = await request(app).get('/api/admin/users?search=zelda').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].password).toBeUndefined();
  });

  it('updates a user role (superadmin only) and bans a user', async () => {
    const { token } = await admin('superadmin');
    const target = await prisma.user.create({ data: { name: 'T', email: `t${uniq()}@t.com`, role: 'user' } });
    const res = await request(app).put(`/api/admin/users/${target.id}`).set('Authorization', `Bearer ${token}`).send({ role: 'seller', isBanned: true });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('seller');
    const inDb = await prisma.user.findUnique({ where: { id: target.id } });
    expect(inDb.isBanned).toBe(true);
    expect(inDb.bannedAt).not.toBeNull();
  });

  it('does not let a non-superadmin change role', async () => {
    const { token } = await admin('admin');
    const target = await prisma.user.create({ data: { name: 'T', email: `t${uniq()}@t.com`, role: 'user' } });
    const res = await request(app).put(`/api/admin/users/${target.id}`).set('Authorization', `Bearer ${token}`).send({ role: 'admin' });
    expect(res.status).toBe(200);
    const inDb = await prisma.user.findUnique({ where: { id: target.id } });
    expect(inDb.role).toBe('user'); // unchanged
  });

  it('soft-deletes (deactivates) a user but refuses superadmin', async () => {
    const { token } = await admin('superadmin');
    const target = await prisma.user.create({ data: { name: 'T', email: `t${uniq()}@t.com`, role: 'user' } });
    const del = await request(app).delete(`/api/admin/users/${target.id}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);
    const inDb = await prisma.user.findUnique({ where: { id: target.id } });
    expect(inDb.isActive).toBe(false);

    const sa = await prisma.user.create({ data: { name: 'SA', email: `sa${uniq()}@t.com`, role: 'superadmin' } });
    const res = await request(app).delete(`/api/admin/users/${sa.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('approves a seller (creating/updating the seller profile)', async () => {
    const { token } = await admin();
    const seller = await prisma.user.create({ data: { name: 'Sel', email: `s${uniq()}@t.com`, role: 'seller', sellerProfile: { create: { isApproved: false } } } });
    const res = await request(app).post(`/api/admin/users/${seller.id}/approve-seller`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const profile = await prisma.sellerProfile.findUnique({ where: { userId: seller.id } });
    expect(profile.isApproved).toBe(true);
  });
});

describe('admin orders + products + audit', () => {
  it('lists all orders with the serialized envelope', async () => {
    const { token } = await admin();
    const buyer = await prisma.user.create({ data: { name: 'B', email: `b${uniq()}@t.com`, role: 'user' } });
    await prisma.order.create({ data: { orderNumber: `CUR-${uniq()}`, userId: buyer.id, shippingAddress: {}, subtotal: 5, totalPrice: 5, paymentMethod: 'cod' } });
    const res = await request(app).get('/api/admin/orders').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data[0].orderNumber).toBeDefined();
    expect(res.body.pagination.total).toBe(1);
  });

  it('lists all products and updates one', async () => {
    const { token } = await admin();
    const seller = await prisma.user.create({ data: { name: 'S', email: `s${uniq()}@t.com`, role: 'seller' } });
    const cat = await prisma.category.create({ data: { name: 'C', slug: `c-${uniq()}` } });
    const product = await prisma.product.create({ data: { name: 'P', slug: `p-${uniq()}`, description: 'd', price: 10, status: 'draft', categoryId: cat.id, sellerId: seller.id } });

    const list = await request(app).get('/api/admin/products').set('Authorization', `Bearer ${token}`);
    expect(list.body.data.length).toBeGreaterThanOrEqual(1);

    const upd = await request(app).put(`/api/admin/products/${product.id}`).set('Authorization', `Bearer ${token}`).send({ status: 'active', isFeatured: true });
    expect(upd.status).toBe(200);
    expect(upd.body.data.status).toBe('active');
    expect(upd.body.data.isFeatured).toBe(true);
  });

  it('lists audit logs (superadmin)', async () => {
    const { token } = await admin('superadmin');
    await prisma.auditLog.create({ data: { action: 'TEST_ACTION', resource: 'Thing' } });
    const res = await request(app).get('/api/admin/audit-logs').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ action: 'TEST_ACTION', resource: 'Thing' });
    expect(res.body.data[0]._id).toBeDefined();
  });
});
