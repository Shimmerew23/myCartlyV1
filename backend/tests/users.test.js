jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
  emailTemplates: {
    verification: () => ({ subject: 's', html: 'h' }),
    passwordReset: () => ({ subject: 's', html: 'h' }),
    sellerApproval: () => ({ subject: 's', html: 'h' }),
  },
}));

const request = require('supertest');
const { buildApp } = require('./helpers/buildApp');
const { prisma } = require('../config/prisma');
const { generateTokenPair } = require('../utils/jwt');

const app = buildApp();

async function makeUser(overrides = {}) {
  const user = await prisma.user.create({ data: { name: 'U', email: `u${Date.now()}${Math.random()}@test.com`, role: 'user', ...overrides } });
  const { accessToken } = generateTokenPair(user.id, user.role);
  return { user, token: accessToken };
}

describe('PUT /api/users/profile', () => {
  afterEach(async () => { await prisma.user.deleteMany({}); });

  it('updates allowed fields and returns the safe user', async () => {
    const { token } = await makeUser();
    const res = await request(app).put('/api/users/profile')
      .set('Authorization', `Bearer ${token}`)
      .field('name', 'New Name')
      .field('phone', '+1 555 1234');
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('New Name');
    expect(res.body.data.phone).toBe('+1 555 1234');
    expect(res.body.data.password).toBeUndefined();
  });
});

const ADDR = { label: 'Home', street: '1 Main', city: 'Town', state: 'CA', country: 'US', zipCode: '90001', isDefault: true };

describe('address book', () => {
  afterEach(async () => { await prisma.user.deleteMany({}); });

  it('adds an address and returns the list with _id aliases', async () => {
    const { token } = await makeUser();
    const res = await request(app).post('/api/users/addresses').set('Authorization', `Bearer ${token}`).send(ADDR);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]._id).toBeDefined();
    expect(res.body.data[0].isDefault).toBe(true);
  });

  it('only one address stays default when a second default is added', async () => {
    const { token } = await makeUser();
    await request(app).post('/api/users/addresses').set('Authorization', `Bearer ${token}`).send(ADDR);
    const res = await request(app).post('/api/users/addresses').set('Authorization', `Bearer ${token}`).send({ ...ADDR, street: '2 Main' });
    const defaults = res.body.data.filter((a) => a.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].street).toBe('2 Main');
  });

  it('updates an address', async () => {
    const { token } = await makeUser();
    const add = await request(app).post('/api/users/addresses').set('Authorization', `Bearer ${token}`).send(ADDR);
    const id = add.body.data[0]._id;
    const res = await request(app).put(`/api/users/addresses/${id}`).set('Authorization', `Bearer ${token}`).send({ city: 'Newtown' });
    expect(res.status).toBe(200);
    expect(res.body.data[0].city).toBe('Newtown');
  });

  it('deletes an address', async () => {
    const { token } = await makeUser();
    const add = await request(app).post('/api/users/addresses').set('Authorization', `Bearer ${token}`).send(ADDR);
    const id = add.body.data[0]._id;
    const res = await request(app).delete(`/api/users/addresses/${id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

describe('seller upgrade & profile', () => {
  afterEach(async () => { await prisma.user.deleteMany({}); });

  it('upgrades a user to seller (pending approval) and creates a sellerProfile', async () => {
    const { user, token } = await makeUser();
    const res = await request(app).post('/api/users/upgrade-seller')
      .set('Authorization', `Bearer ${token}`)
      .field('storeName', 'Janes Shop')
      .field('storeBio', 'Nice things');
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('seller');
    expect(res.body.data.sellerProfile.storeName).toBe('Janes Shop');
    expect(res.body.data.sellerProfile.isApproved).toBe(false);
    const inDb = await prisma.sellerProfile.findUnique({ where: { userId: user.id } });
    expect(inDb.storeSlug).toBe('janes-shop');
  });

  it('409s when the store slug is already taken', async () => {
    const a = await makeUser();
    await request(app).post('/api/users/upgrade-seller').set('Authorization', `Bearer ${a.token}`).field('storeName', 'Dup Shop');
    const b = await makeUser();
    const res = await request(app).post('/api/users/upgrade-seller').set('Authorization', `Bearer ${b.token}`).field('storeName', 'Dup Shop');
    expect(res.status).toBe(409);
  });

  it('409s when the user is already a seller', async () => {
    const { token } = await makeUser({ role: 'seller', sellerProfile: { create: { storeName: 'S', storeSlug: 'already-seller', isApproved: true } } });
    const res = await request(app).post('/api/users/upgrade-seller').set('Authorization', `Bearer ${token}`).field('storeName', 'Other');
    expect(res.status).toBe(409);
  });

  it('updates an existing seller profile text fields', async () => {
    const { token } = await makeUser({ role: 'seller', sellerProfile: { create: { storeName: 'Old', storeSlug: `s-${Date.now()}`, isApproved: true } } });
    const res = await request(app).put('/api/users/seller-profile')
      .set('Authorization', `Bearer ${token}`)
      .field('storeBio', 'Updated bio');
    expect(res.status).toBe(200);
    expect(res.body.data.sellerProfile.storeBio).toBe('Updated bio');
  });
});
