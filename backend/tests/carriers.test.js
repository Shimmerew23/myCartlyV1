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

afterEach(async () => {
  await prisma.carrier.deleteMany({});
  await prisma.user.deleteMany({});
});

describe('carriers', () => {
  it('creates a carrier (admin), lowercasing the code', async () => {
    const token = await adminToken();
    const res = await request(app).post('/api/admin/carriers').set('Authorization', `Bearer ${token}`)
      .send({ name: 'FedEx', code: 'FEDEX', trackingUrlTemplate: 'https://x/{trackingNumber}' });
    expect(res.status).toBe(201);
    expect(res.body.data._id).toBeDefined();
    expect(res.body.data.code).toBe('fedex');
    expect(res.body.data.isActive).toBe(true);
  });

  it('requires name and code', async () => {
    const token = await adminToken();
    const res = await request(app).post('/api/admin/carriers').set('Authorization', `Bearer ${token}`).send({ name: 'X' });
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate code', async () => {
    const token = await adminToken();
    await prisma.carrier.create({ data: { name: 'UPS', code: 'ups' } });
    const res = await request(app).post('/api/admin/carriers').set('Authorization', `Bearer ${token}`).send({ name: 'UPS2', code: 'UPS' });
    expect(res.status).toBe(409);
  });

  it('returns only active carriers, sorted by sortOrder then name (public)', async () => {
    await prisma.carrier.create({ data: { name: 'Beta', code: 'beta', sortOrder: 1 } });
    await prisma.carrier.create({ data: { name: 'Alpha', code: 'alpha', sortOrder: 0 } });
    await prisma.carrier.create({ data: { name: 'Hidden', code: 'hidden', isActive: false } });
    const res = await request(app).get('/api/carriers');
    expect(res.status).toBe(200);
    expect(res.body.data.map((c) => c.name)).toEqual(['Alpha', 'Beta']);
  });

  it('updates a carrier (toggle active)', async () => {
    const token = await adminToken();
    const c = await prisma.carrier.create({ data: { name: 'DHL', code: 'dhl' } });
    const res = await request(app).put(`/api/admin/carriers/${c.id}`).set('Authorization', `Bearer ${token}`).send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
  });

  it('deletes a carrier and 404s an unknown one', async () => {
    const token = await adminToken();
    const c = await prisma.carrier.create({ data: { name: 'TNT', code: 'tnt' } });
    const del = await request(app).delete(`/api/admin/carriers/${c.id}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);
    const missing = await request(app).delete('/api/admin/carriers/not-real').set('Authorization', `Bearer ${token}`);
    expect(missing.status).toBe(404);
  });
});
