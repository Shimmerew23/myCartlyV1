const request = require('supertest');
const { buildApp } = require('./buildApp');

it('builds an app and returns the JSON envelope on unknown route', async () => {
  const app = buildApp();
  const res = await request(app).get('/api/auth/does-not-exist');
  expect(res.status).toBe(404);
  expect(res.body).toHaveProperty('success', false);
});
