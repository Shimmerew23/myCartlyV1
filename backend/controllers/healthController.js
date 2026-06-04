const { prisma } = require('../config/prisma');
const redis = require('../config/redis');

// Postgres is the system of record — required for readiness.
async function checkPostgres() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return 'ok';
  } catch (_err) {
    return 'down';
  }
}

// Redis is optional (graceful degradation) — never blocks readiness.
async function checkRedis() {
  try {
    const client = redis.getRedisClient();
    if (!client) return 'degraded';
    await client.ping();
    return 'ok';
  } catch (_err) {
    return 'degraded';
  }
}

// Liveness — is the process up? No dependency checks; used to decide restarts.
function live(_req, res) {
  res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
}

// Readiness — can the service serve traffic? 503 only if Postgres is down.
async function ready(_req, res) {
  const [postgres, redisState] = await Promise.all([checkPostgres(), checkRedis()]);
  const checks = { postgres, redis: redisState };
  const ok = postgres === 'ok';
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ready' : 'not ready',
    checks,
    timestamp: new Date().toISOString(),
  });
}

module.exports = { live, ready };
