const { prisma } = require('../../config/prisma');
const { deleteOldAuditLogs } = require('../../jobs/auditCleanup');

afterEach(async () => {
  await prisma.auditLog.deleteMany({});
});

describe('deleteOldAuditLogs', () => {
  it('removes logs older than 90 days and keeps recent ones', async () => {
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await prisma.auditLog.create({ data: { action: 'OLD', createdAt: old } });
    await prisma.auditLog.create({ data: { action: 'RECENT', createdAt: recent } });

    const removed = await deleteOldAuditLogs();
    expect(removed).toBe(1);

    const left = await prisma.auditLog.findMany();
    expect(left).toHaveLength(1);
    expect(left[0].action).toBe('RECENT');
  });
});
