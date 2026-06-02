jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
  emailTemplates: { verification: () => ({ subject: 's', html: 'h' }), passwordReset: () => ({ subject: 's', html: 'h' }), sellerApproval: () => ({ subject: 's', html: 'h' }) },
}));

const request = require('supertest');
const { buildApp } = require('./helpers/buildApp');
const { prisma } = require('../config/prisma');
const { generateTokenPair } = require('../utils/jwt');

const app = buildApp();

async function adminToken() {
  const u = await prisma.user.create({ data: { name: 'A', email: `a${Date.now()}${Math.random()}@t.com`, role: 'admin' } });
  return generateTokenPair(u.id, u.role).accessToken;
}

describe('categories', () => {
  afterEach(async () => {
    await prisma.product.deleteMany({});
    await prisma.category.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it('creates a category with a generated slug (admin)', async () => {
    const token = await adminToken();
    const res = await request(app).post('/api/categories').set('Authorization', `Bearer ${token}`).send({ name: 'Foot Wear' });
    expect(res.status).toBe(201);
    expect(res.body.data.slug).toBe('foot-wear');
    expect(res.body.data._id).toBeDefined();
  });

  it('lists active categories sorted by sortOrder then name', async () => {
    await prisma.category.create({ data: { name: 'Beta', slug: 'beta', sortOrder: 1 } });
    await prisma.category.create({ data: { name: 'Alpha', slug: 'alpha', sortOrder: 0 } });
    await prisma.category.create({ data: { name: 'Hidden', slug: 'hidden', isActive: false } });
    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(200);
    const names = res.body.data.map((c) => c.name);
    expect(names).toEqual(['Alpha', 'Beta']);
    expect(res.body.data[0]._id).toBeDefined();
  });

  it('updates a category (admin)', async () => {
    const token = await adminToken();
    const c = await prisma.category.create({ data: { name: 'Old', slug: 'old' } });
    const res = await request(app).put(`/api/categories/${c.id}`).set('Authorization', `Bearer ${token}`).send({ description: 'new' });
    expect(res.status).toBe(200);
    expect(res.body.data.description).toBe('new');
  });

  it('soft-deletes a category (admin)', async () => {
    const token = await adminToken();
    const c = await prisma.category.create({ data: { name: 'Del', slug: 'del' } });
    const res = await request(app).delete(`/api/categories/${c.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const inDb = await prisma.category.findUnique({ where: { id: c.id } });
    expect(inDb.isActive).toBe(false);
  });
});
