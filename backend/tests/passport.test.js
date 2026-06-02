const { prisma } = require('../config/prisma');
const { googleVerify } = require('../config/passport');

describe('Google OAuth verify callback (Prisma)', () => {
  afterEach(async () => { await prisma.user.deleteMany({}); });

  const profile = { id: 'g-123', displayName: 'Gmail User', emails: [{ value: 'GUSER@test.com' }], photos: [{ value: 'http://pic' }] };

  it('creates a new verified user on first Google login', async () => {
    await new Promise((resolve, reject) => {
      googleVerify('at', 'rt', profile, (err, user) => {
        try {
          expect(err).toBeFalsy();
          expect(user.googleId).toBe('g-123');
          expect(user.email).toBe('guser@test.com');
          expect(user.isEmailVerified).toBe(true);
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });

  it('links googleId to an existing email account', async () => {
    await prisma.user.create({ data: { name: 'Existing', email: 'guser@test.com' } });
    await new Promise((resolve, reject) => {
      googleVerify('at', 'rt', profile, async (err, user) => {
        try {
          expect(err).toBeFalsy();
          expect(user.googleId).toBe('g-123');
          const count = await prisma.user.count();
          expect(count).toBe(1); // linked, not duplicated
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });
});
