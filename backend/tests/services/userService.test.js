const userService = require('../../services/userService');
const { prisma } = require('../../config/prisma');

describe('userService crypto helpers', () => {
  it('hashes a password so it is not stored in plaintext and verifies it', async () => {
    const hash = await userService.hashPassword('Passw0rd!@');
    expect(hash).not.toBe('Passw0rd!@');
    expect(await userService.comparePassword('Passw0rd!@', hash)).toBe(true);
    expect(await userService.comparePassword('wrong', hash)).toBe(false);
  });

  it('comparePassword returns false when there is no hash', async () => {
    expect(await userService.comparePassword('x', null)).toBe(false);
    expect(await userService.comparePassword('x', undefined)).toBe(false);
  });

  it('generates a password reset token whose hash matches sha256(token)', () => {
    const crypto = require('crypto');
    const { resetToken, hashedToken, expiry } = userService.generatePasswordResetToken();
    expect(hashedToken).toBe(crypto.createHash('sha256').update(resetToken).digest('hex'));
    expect(expiry.getTime()).toBeGreaterThan(Date.now());
  });

  it('generates an email verification token whose hash matches sha256(token)', () => {
    const crypto = require('crypto');
    const { token, hashedToken, expiry } = userService.generateEmailVerificationToken();
    expect(hashedToken).toBe(crypto.createHash('sha256').update(token).digest('hex'));
    expect(expiry.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('userService lockout', () => {
  afterEach(async () => { await prisma.user.deleteMany({}); });

  it('isLocked reflects lockUntil', () => {
    expect(userService.isLocked({ lockUntil: null })).toBe(false);
    expect(userService.isLocked({ lockUntil: new Date(Date.now() - 1000) })).toBe(false);
    expect(userService.isLocked({ lockUntil: new Date(Date.now() + 60000) })).toBe(true);
  });

  it('changedPasswordAfter compares seconds correctly', () => {
    const changedAt = new Date('2026-01-01T00:00:00Z');
    const before = Math.floor(changedAt.getTime() / 1000) - 10;
    const after = Math.floor(changedAt.getTime() / 1000) + 10;
    expect(userService.changedPasswordAfter(changedAt, before)).toBe(true);
    expect(userService.changedPasswordAfter(changedAt, after)).toBe(false);
    expect(userService.changedPasswordAfter(null, before)).toBe(false);
  });

  it('locks the account on the 5th failed attempt with a 3-minute first lock', async () => {
    let user = await prisma.user.create({ data: { name: 'L', email: 'lock@test.com', loginAttempts: 4, lockCount: 0 } });
    user = await userService.incLoginAttempts(user);
    expect(user.loginAttempts).toBe(0);
    expect(user.lockCount).toBe(1);
    expect(user.lockUntil).not.toBeNull();
    const mins = Math.round((new Date(user.lockUntil).getTime() - Date.now()) / 60000);
    expect(mins).toBe(3);
  });

  it('increments attempts below the threshold without locking', async () => {
    let user = await prisma.user.create({ data: { name: 'L', email: 'lock2@test.com', loginAttempts: 1 } });
    user = await userService.incLoginAttempts(user);
    expect(user.loginAttempts).toBe(2);
    expect(user.lockUntil).toBeNull();
  });

  it('starts a fresh round when a previous lock has expired', async () => {
    let user = await prisma.user.create({
      data: { name: 'L', email: 'lock3@test.com', loginAttempts: 0, lockCount: 1, lockUntil: new Date(Date.now() - 1000) },
    });
    user = await userService.incLoginAttempts(user);
    expect(user.loginAttempts).toBe(1);
    expect(user.lockUntil).toBeNull();
    expect(user.lockCount).toBe(1); // preserved for escalation
  });
});

describe('userService serializers & finders', () => {
  afterEach(async () => { await prisma.user.deleteMany({}); });

  it('toSafeObject strips secrets and adds _id/id/isSeller aliases', () => {
    const row = {
      id: 'uuid-1', name: 'Jane', email: 'jane@test.com', role: 'seller',
      password: 'HASH', refreshToken: 'RT', passwordResetToken: 'PRT',
      emailVerificationToken: 'EVT', loginAttempts: 3, lockUntil: null,
      avatar: null, isEmailVerified: true, isActive: true, isBanned: false,
      preferences: { currency: 'USD' }, wishlist: ['p1'], featureFlags: { newCheckout: false },
      addresses: [{ id: 'a1', label: 'Home', street: 'S', city: 'C', state: 'ST', country: 'US', zipCode: '1', isDefault: true }],
      sellerProfile: { storeName: 'Shop', isApproved: true, bankAccountNumber: 'SECRET' },
      googleId: 'g1', createdAt: new Date(), updatedAt: new Date(),
    };
    const safe = userService.toSafeObject(row);
    expect(safe._id).toBe('uuid-1');
    expect(safe.id).toBe('uuid-1');
    expect(safe.isSeller).toBe(true);
    expect(safe.password).toBeUndefined();
    expect(safe.refreshToken).toBeUndefined();
    expect(safe.passwordResetToken).toBeUndefined();
    expect(safe.emailVerificationToken).toBeUndefined();
    expect(safe.loginAttempts).toBeUndefined();
    expect(safe.oauth).toEqual({ googleId: 'g1' });
    expect(safe.addresses[0]._id).toBe('a1');
    expect(safe.sellerProfile.bankAccountNumber).toBeUndefined(); // bank fields never leak
    expect(safe.wishlist).toEqual(['p1']);
  });

  it('findByEmail lowercases and includes relations', async () => {
    await prisma.user.create({ data: { name: 'Jane', email: 'mixed@test.com', addresses: { create: { street: 'S', city: 'C', state: 'ST', zipCode: '1' } } } });
    const found = await userService.findByEmail('MIXED@test.com');
    expect(found).not.toBeNull();
    expect(found.addresses).toHaveLength(1);
  });

  it('findById includes addresses and sellerProfile', async () => {
    const u = await prisma.user.create({ data: { name: 'Jane', email: 'byid@test.com' } });
    const found = await userService.findById(u.id);
    expect(found.id).toBe(u.id);
    expect(found).toHaveProperty('addresses');
  });
});
