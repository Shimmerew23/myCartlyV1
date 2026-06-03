const { prisma } = require('../config/prisma');
const logger = require('../utils/logger');

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Replaces the Mongoose AuditLog TTL index: delete logs older than 90 days.
const deleteOldAuditLogs = async (client = prisma) => {
  const cutoff = new Date(Date.now() - NINETY_DAYS_MS);
  const { count } = await client.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return count;
};

let timer = null;

// Run once at startup, then daily. No-op under tests.
const startAuditCleanup = () => {
  if (process.env.NODE_ENV === 'test') return null;

  const run = async () => {
    try {
      const n = await deleteOldAuditLogs();
      if (n) logger.info(`Audit cleanup: removed ${n} audit log(s) older than 90 days`);
    } catch (e) {
      logger.error(`Audit cleanup failed: ${e.message}`);
    }
  };

  run();
  timer = setInterval(run, DAY_MS);
  if (timer.unref) timer.unref(); // don't keep the process alive
  return timer;
};

const stopAuditCleanup = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

module.exports = { deleteOldAuditLogs, startAuditCleanup, stopAuditCleanup };
