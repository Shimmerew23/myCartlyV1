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

const VALID = { name: 'Jane Doe', email: 'jane@test.com', password: 'Passw0rd!@', confirmPassword: 'Passw0rd!@' };

async function registerAndToken() {
  const res = await request(app).post('/api/auth/register').send(VALID);
  return res.body.data.accessToken;
}

describe('authenticate middleware (via GET /api/auth/me)', () => {
  afterEach(async () => { await prisma.user.deleteMany({}); });

  it('rejects requests with no token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects an invalid token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
  });

  it('accepts a valid token and resolves the Postgres user', async () => {
    const user = await prisma.user.create({ data: { name: 'Auth', email: 'auth@test.com', role: 'user' } });
    const { accessToken } = generateTokenPair(user.id, user.role);
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe(user.id);
    expect(res.body.data.email).toBe('auth@test.com');
  });

  it('403s a banned user', async () => {
    const user = await prisma.user.create({ data: { name: 'B', email: 'banned@test.com', isBanned: true, banReason: 'spam' } });
    const { accessToken } = generateTokenPair(user.id, user.role);
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/auth/register', () => {
  afterEach(async () => { await prisma.user.deleteMany({}); });

  it('creates a user and returns the standard envelope', async () => {
    const res = await request(app).post('/api/auth/register').send(VALID);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ statusCode: 201, success: true });
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.data.user.email).toBe('jane@test.com');
    expect(res.body.data.user.password).toBeUndefined();
    expect(res.body.data.user._id).toBeDefined();
    expect(res.body.data.accessToken).toBeDefined();
    const inDb = await prisma.user.findUnique({ where: { email: 'jane@test.com' } });
    expect(inDb.password).not.toBe(VALID.password);
    expect(inDb.preferences).toMatchObject({ currency: 'USD' });
  });

  it('rejects a duplicate email with 409', async () => {
    await request(app).post('/api/auth/register').send(VALID);
    const res = await request(app).post('/api/auth/register').send(VALID);
    expect(res.status).toBe(409);
  });
});

describe('POST /api/auth/login', () => {
  afterEach(async () => { await prisma.user.deleteMany({}); });

  it('logs in with correct credentials', async () => {
    await request(app).post('/api/auth/register').send(VALID);
    const res = await request(app).post('/api/auth/login').send({ email: 'jane@test.com', password: 'Passw0rd!@' });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.user._id).toBeDefined();
  });

  it('401s on a wrong password and increments attempts', async () => {
    await request(app).post('/api/auth/register').send(VALID);
    const res = await request(app).post('/api/auth/login').send({ email: 'jane@test.com', password: 'wrongpass' });
    expect(res.status).toBe(401);
    const inDb = await prisma.user.findUnique({ where: { email: 'jane@test.com' } });
    expect(inDb.loginAttempts).toBe(1);
  });

  it('401s on an unknown email', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@test.com', password: 'whatever' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  afterEach(async () => { await prisma.user.deleteMany({}); });
  it('returns the current user', async () => {
    const token = await registerAndToken();
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('jane@test.com');
    expect(res.body.data.wishlist).toEqual([]); // id-only until Plan 1C
  });
});

describe('POST /api/auth/logout', () => {
  afterEach(async () => { await prisma.user.deleteMany({}); });
  it('clears the stored refresh token', async () => {
    const token = await registerAndToken();
    const res = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const inDb = await prisma.user.findUnique({ where: { email: 'jane@test.com' } });
    expect(inDb.refreshToken).toBeNull();
  });
});

describe('POST /api/auth/refresh', () => {
  afterEach(async () => { await prisma.user.deleteMany({}); });
  it('issues a new token pair from a valid refresh token', async () => {
    const reg = await request(app).post('/api/auth/register').send(VALID);
    const refresh = reg.body.data.refreshToken;
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: refresh });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
  });
  it('401s when no refresh token is supplied', async () => {
    const res = await request(app).post('/api/auth/refresh').send({});
    expect(res.status).toBe(401);
  });
});

describe('password reset & email verification flows', () => {
  afterEach(async () => { await prisma.user.deleteMany({}); });

  it('forgot-password always 200s, even for unknown emails (no enumeration)', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@test.com' });
    expect(res.status).toBe(200);
  });

  it('forgot-password stores a reset token for a known user', async () => {
    await request(app).post('/api/auth/register').send(VALID);
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'jane@test.com' });
    expect(res.status).toBe(200);
    const inDb = await prisma.user.findUnique({ where: { email: 'jane@test.com' } });
    expect(inDb.passwordResetToken).not.toBeNull();
  });

  it('reset-password sets a new password for a valid token', async () => {
    await request(app).post('/api/auth/register').send(VALID);
    const user = await prisma.user.findUnique({ where: { email: 'jane@test.com' } });
    const crypto = require('crypto');
    const raw = crypto.randomBytes(32).toString('hex');
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordResetToken: crypto.createHash('sha256').update(raw).digest('hex'), passwordResetExpiry: new Date(Date.now() + 600000) },
    });
    const res = await request(app).put(`/api/auth/reset-password/${raw}`).send({ password: 'NewPassw0rd!@' });
    expect(res.status).toBe(200);
    const login = await request(app).post('/api/auth/login').send({ email: 'jane@test.com', password: 'NewPassw0rd!@' });
    expect(login.status).toBe(200);
  });

  it('reset-password 400s for an invalid token', async () => {
    const res = await request(app).put('/api/auth/reset-password/bogus').send({ password: 'NewPassw0rd!@' });
    expect(res.status).toBe(400);
  });

  it('verify-email marks the user verified', async () => {
    await request(app).post('/api/auth/register').send(VALID);
    const user = await prisma.user.findUnique({ where: { email: 'jane@test.com' } });
    const crypto = require('crypto');
    const raw = crypto.randomBytes(20).toString('hex');
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerificationToken: crypto.createHash('sha256').update(raw).digest('hex'), emailVerificationExpiry: new Date(Date.now() + 600000) },
    });
    const res = await request(app).get(`/api/auth/verify-email/${raw}`);
    expect(res.status).toBe(200);
    const inDb = await prisma.user.findUnique({ where: { email: 'jane@test.com' } });
    expect(inDb.isEmailVerified).toBe(true);
  });

  it('change-password updates the password for an authenticated user', async () => {
    const token = await registerAndToken();
    const res = await request(app).put('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'Passw0rd!@', newPassword: 'Another1!@' });
    expect(res.status).toBe(200);
    const login = await request(app).post('/api/auth/login').send({ email: 'jane@test.com', password: 'Another1!@' });
    expect(login.status).toBe(200);
  });
});
