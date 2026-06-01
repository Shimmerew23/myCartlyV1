const { prisma } = require('../config/prisma');

describe('Prisma foundation', () => {
  afterEach(async () => {
    await prisma.user.deleteMany({});
  });

  it('connects and round-trips a User row', async () => {
    const created = await prisma.user.create({
      data: { name: 'Test User', email: 'foundation@test.com', role: 'user' },
    });
    expect(created.id).toBeDefined();
    expect(created.role).toBe('user');

    const found = await prisma.user.findUnique({ where: { email: 'foundation@test.com' } });
    expect(found.name).toBe('Test User');
  });

  it('enforces the unique email constraint', async () => {
    await prisma.user.create({ data: { name: 'A', email: 'dup@test.com' } });
    await expect(
      prisma.user.create({ data: { name: 'B', email: 'dup@test.com' } })
    ).rejects.toThrow();
  });
});
