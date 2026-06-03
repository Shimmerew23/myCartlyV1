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

const whBody = (over = {}) => ({
  name: 'NYC Hub', code: `wh${uniq()}`.slice(0, 18), street: '1 St', city: 'NYC', state: 'NY', zipCode: '10001',
  managerName: 'Manager', managerEmail: `m${uniq()}@t.com`, ...over,
});

afterEach(async () => {
  await prisma.orderStatusEvent.deleteMany({});
  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.warehouse.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.user.deleteMany({});
});

describe('admin warehouse management', () => {
  it('creates a warehouse + manager user with a locationLabel', async () => {
    const token = await adminToken();
    const res = await request(app).post('/api/admin/warehouses').set('Authorization', `Bearer ${token}`).send(whBody({ managerEmail: 'mgr1@t.com' }));
    expect(res.status).toBe(201);
    expect(res.body.data._id).toBeDefined();
    expect(res.body.data.manager).toMatchObject({ name: 'Manager', email: 'mgr1@t.com' });
    expect(res.body.data.locationLabel).toBe('NYC Hub — NYC, NY');
    const user = await prisma.user.findUnique({ where: { email: 'mgr1@t.com' } });
    expect(user.role).toBe('warehouse');
    expect(user.password).toBeTruthy();
  });

  it('rejects a duplicate manager email', async () => {
    const token = await adminToken();
    await request(app).post('/api/admin/warehouses').set('Authorization', `Bearer ${token}`).send(whBody({ managerEmail: 'dup@t.com' }));
    const res = await request(app).post('/api/admin/warehouses').set('Authorization', `Bearer ${token}`).send(whBody({ managerEmail: 'dup@t.com' }));
    expect(res.status).toBe(409);
  });

  it('lists warehouses and toggles isActive (cascading to the manager)', async () => {
    const token = await adminToken();
    const created = await request(app).post('/api/admin/warehouses').set('Authorization', `Bearer ${token}`).send(whBody({ managerEmail: 'mgr2@t.com' }));
    const id = created.body.data._id;

    const list = await request(app).get('/api/admin/warehouses').set('Authorization', `Bearer ${token}`);
    expect(list.body.data.length).toBeGreaterThanOrEqual(1);

    const upd = await request(app).put(`/api/admin/warehouses/${id}`).set('Authorization', `Bearer ${token}`).send({ isActive: false });
    expect(upd.body.data.isActive).toBe(false);
    const mgr = await prisma.user.findUnique({ where: { email: 'mgr2@t.com' } });
    expect(mgr.isActive).toBe(false);
  });

  it('deletes a warehouse and its manager account', async () => {
    const token = await adminToken();
    const created = await request(app).post('/api/admin/warehouses').set('Authorization', `Bearer ${token}`).send(whBody({ managerEmail: 'mgr3@t.com' }));
    const id = created.body.data._id;
    const res = await request(app).delete(`/api/admin/warehouses/${id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(await prisma.warehouse.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { email: 'mgr3@t.com' } })).toBeNull();
  });
});

describe('warehouse scan + check-in', () => {
  async function makeWarehouseCtx() {
    const manager = await prisma.user.create({ data: { name: 'WH', email: `wh${uniq()}@t.com`, role: 'warehouse' } });
    await prisma.warehouse.create({ data: { name: 'Hub', code: `H${uniq()}`.slice(0, 18), address: { street: 's', city: 'LA', state: 'CA', country: 'US', zipCode: '90001' }, managerId: manager.id } });
    const buyer = await prisma.user.create({ data: { name: 'B', email: `b${uniq()}@t.com`, role: 'user' } });
    const seller = await prisma.user.create({ data: { name: 'S', email: `s${uniq()}@t.com`, role: 'seller' } });
    const cat = await prisma.category.create({ data: { name: 'C', slug: `c-${uniq()}` } });
    const product = await prisma.product.create({ data: { name: 'P', slug: `p-${uniq()}`, description: 'd', price: 10, status: 'active', categoryId: cat.id, sellerId: seller.id } });
    const order = await prisma.order.create({
      data: {
        orderNumber: `CUR-${Date.now()}-000001`, userId: buyer.id, shippingAddress: {}, subtotal: 10, totalPrice: 10,
        paymentMethod: 'cod', status: 'confirmed',
        items: { create: [{ productId: product.id, sellerId: seller.id, name: 'P', price: 10, quantity: 1 }] },
        statusHistory: { create: [{ status: 'pending', note: 'placed' }] },
      },
    });
    return { token: generateTokenPair(manager.id, 'warehouse').accessToken, order, cat };
  }

  it('scans an order by order number', async () => {
    const { token, order } = await makeWarehouseCtx();
    const res = await request(app).get(`/api/warehouse/scan?q=${order.orderNumber}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe(order.id);
    expect(res.body.data.items).toHaveLength(1);
  });

  it('400s a too-short scan query', async () => {
    const { token } = await makeWarehouseCtx();
    const res = await request(app).get('/api/warehouse/scan?q=ab').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('advances status via a valid check-in action with a warehouse-labelled event', async () => {
    const { token, order } = await makeWarehouseCtx();
    const res = await request(app).put(`/api/warehouse/orders/${order.id}/check-in`).set('Authorization', `Bearer ${token}`)
      .send({ action: 'mark_processing', location: 'Dock 3' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('processing');
    const last = res.body.data.statusHistory.at(-1);
    expect(last.status).toBe('processing');
    expect(last.warehouseName).toBe('Hub — LA, CA');
  });

  it('rejects an invalid check-in transition', async () => {
    const { token, order } = await makeWarehouseCtx();
    const res = await request(app).put(`/api/warehouse/orders/${order.id}/check-in`).set('Authorization', `Bearer ${token}`)
      .send({ action: 'mark_delivered' });
    expect(res.status).toBe(400);
  });

  it('records a location_update without changing status', async () => {
    const { token, order } = await makeWarehouseCtx();
    const res = await request(app).put(`/api/warehouse/orders/${order.id}/check-in`).set('Authorization', `Bearer ${token}`)
      .send({ action: 'location_update', location: 'Sorting Center' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('confirmed');
    expect(res.body.data.tracking.lastLocation).toBe('Sorting Center');
  });
});
