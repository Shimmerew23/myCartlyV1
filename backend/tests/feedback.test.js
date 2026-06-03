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
  await prisma.feedback.deleteMany({});
  await prisma.user.deleteMany({});
});

describe('feedback', () => {
  it('accepts a guest submission', async () => {
    const res = await request(app).post('/api/feedback').send({ category: 'bug', subject: 'Hi', message: 'Found a bug', guestName: 'Guest', guestEmail: 'g@t.com' });
    expect(res.status).toBe(201);
    expect(res.body.data._id).toBeDefined();
    expect(res.body.data.guestName).toBe('Guest');
    expect(res.body.data.status).toBe('new');
  });

  it('rejects a guest message longer than 300 chars', async () => {
    const res = await request(app).post('/api/feedback').send({ category: 'general', subject: 'x', message: 'a'.repeat(301) });
    expect(res.status).toBe(400);
  });

  it('requires category, subject, and message', async () => {
    const res = await request(app).post('/api/feedback').send({ subject: 'x' });
    expect(res.status).toBe(400);
  });

  it('attaches the user when authenticated', async () => {
    const u = await prisma.user.create({ data: { name: 'U', email: `u${uniq()}@t.com`, role: 'user' } });
    const token = generateTokenPair(u.id, 'user').accessToken;
    const res = await request(app).post('/api/feedback').set('Authorization', `Bearer ${token}`).send({ category: 'praise', subject: 'Nice', message: 'Great app' });
    expect(res.status).toBe(201);
    expect(res.body.data.user).toBe(u.id);
  });

  it('lists feedback for admin and updates status', async () => {
    const token = await adminToken();
    const fb = await prisma.feedback.create({ data: { category: 'bug', subject: 's', message: 'm' } });

    const list = await request(app).get('/api/admin/feedback').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const upd = await request(app).put(`/api/admin/feedback/${fb.id}`).set('Authorization', `Bearer ${token}`).send({ status: 'resolved', adminNote: 'fixed' });
    expect(upd.status).toBe(200);
    expect(upd.body.data.status).toBe('resolved');
    expect(upd.body.data.adminNote).toBe('fixed');
  });

  it('404s updating unknown feedback', async () => {
    const token = await adminToken();
    const res = await request(app).put('/api/admin/feedback/not-real').set('Authorization', `Bearer ${token}`).send({ status: 'read' });
    expect(res.status).toBe(404);
  });
});
