const request = require('supertest');
const { buildApp } = require('./helpers/buildApp');
const { prisma } = require('../config/prisma');
const redis = require('../config/redis');

const app = buildApp();

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GET /health/live', () => {
  it('returns 200 alive', async () => {
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('alive');
    expect(res.body.timestamp).toBeDefined();
  });
});

describe('GET /health/ready', () => {
  it('returns 200 ready with postgres ok (redis degraded when not connected)', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks.postgres).toBe('ok');
    expect(res.body.checks.redis).toBe('degraded');
    expect(res.body.timestamp).toBeDefined();
  });

  it('returns 503 not ready when postgres is down', async () => {
    jest.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('not ready');
    expect(res.body.checks.postgres).toBe('down');
  });

  it('reports redis ok when a reachable client responds to ping', async () => {
    jest.spyOn(redis, 'getRedisClient').mockReturnValue({
      ping: jest.fn().mockResolvedValue('PONG'),
    });
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.checks.redis).toBe('ok');
  });
});
