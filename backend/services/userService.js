const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { prisma } = require('../config/prisma');

const SALT_ROUNDS = 12;
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

const DEFAULT_PREFERENCES = {
  currency: 'USD',
  language: 'en',
  notifications: { email: true, push: true, sms: false, orderUpdates: true, promotions: true },
  theme: 'system',
};
const DEFAULT_FEATURE_FLAGS = { newCheckout: false, betaFeatures: false };

// ============================================================
// Password & token helpers (replace Mongoose instance methods)
// ============================================================

const hashPassword = async (plain) => {
  const salt = await bcrypt.genSalt(SALT_ROUNDS);
  return bcrypt.hash(plain, salt);
};

const comparePassword = async (plain, hash) => {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
};

const generatePasswordResetToken = () => {
  const resetToken = crypto.randomBytes(32).toString('hex');
  return { resetToken, hashedToken: sha256(resetToken), expiry: new Date(Date.now() + 10 * 60 * 1000) };
};

const generateEmailVerificationToken = () => {
  const token = crypto.randomBytes(20).toString('hex');
  return { token, hashedToken: sha256(token), expiry: new Date(Date.now() + 24 * 60 * 60 * 1000) };
};

// ============================================================
// Progressive lockout & password-change checks
// ============================================================

const LOCK_DURATIONS_MS = [3, 5, 15, 30].map((m) => m * 60 * 1000);

const isLocked = (user) => !!(user.lockUntil && new Date(user.lockUntil).getTime() > Date.now());

const changedPasswordAfter = (passwordChangedAt, jwtIat) => {
  if (!passwordChangedAt) return false;
  const changedTs = Math.floor(new Date(passwordChangedAt).getTime() / 1000);
  return jwtIat < changedTs;
};

const incLoginAttempts = async (user) => {
  // Expired lock — start a new round but keep lockCount for escalation
  if (user.lockUntil && new Date(user.lockUntil).getTime() < Date.now()) {
    return prisma.user.update({ where: { id: user.id }, data: { loginAttempts: 1, lockUntil: null } });
  }

  const newAttempts = (user.loginAttempts || 0) + 1;

  if (newAttempts >= 5 && !isLocked(user)) {
    const lockCount = user.lockCount || 0;
    const durationMs = LOCK_DURATIONS_MS[Math.min(lockCount, LOCK_DURATIONS_MS.length - 1)];
    return prisma.user.update({
      where: { id: user.id },
      data: { lockUntil: new Date(Date.now() + durationMs), loginAttempts: 0, lockCount: { increment: 1 } },
    });
  }

  return prisma.user.update({ where: { id: user.id }, data: { loginAttempts: { increment: 1 } } });
};

// ============================================================
// Serializers & finders
// ============================================================

const RELATIONS = { addresses: true, sellerProfile: true };

const isSellerRole = (role) => ['seller', 'admin', 'superadmin'].includes(role);

const serializeAddress = (a) => ({
  _id: a.id,
  id: a.id,
  label: a.label,
  street: a.street,
  city: a.city,
  state: a.state,
  country: a.country,
  zipCode: a.zipCode,
  isDefault: a.isDefault,
});

const serializeSellerProfile = (p) => {
  if (!p) return undefined;
  const { id, userId, bankAccountNumber, bankRoutingNumber, bankName, ...rest } = p;
  return rest; // bank fields intentionally omitted, matching Mongoose toSafeObject
};

const toSafeObject = (user) => {
  if (!user) return null;
  return {
    _id: user.id,
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar ?? null,
    avatarPublicId: user.avatarPublicId ?? undefined,
    phone: user.phone ?? undefined,
    dateOfBirth: user.dateOfBirth ?? undefined,
    gender: user.gender ?? undefined,
    addresses: (user.addresses || []).map(serializeAddress),
    sellerProfile: serializeSellerProfile(user.sellerProfile),
    oauth: { googleId: user.googleId ?? undefined },
    isEmailVerified: user.isEmailVerified,
    isActive: user.isActive,
    isBanned: user.isBanned,
    banReason: user.banReason ?? undefined,
    preferences: user.preferences ?? undefined,
    wishlist: user.wishlist || [],
    featureFlags: user.featureFlags ?? undefined,
    lastLoginAt: user.lastLoginAt ?? undefined,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    isSeller: isSellerRole(user.role),
    isLocked: isLocked(user),
  };
};

// req.user must keep the shape downstream Mongoose code reads (_id, role, sellerProfile.isApproved, _id.toString()).
const toReqUser = toSafeObject;

const findById = (id) => prisma.user.findUnique({ where: { id }, include: RELATIONS });

const findByEmail = (email) =>
  prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() }, include: RELATIONS });

const pickAddressFields = (body) => {
  const out = {};
  ['label', 'street', 'city', 'state', 'country', 'zipCode', 'isDefault'].forEach((f) => {
    if (body[f] !== undefined) out[f] = body[f];
  });
  return out;
};

module.exports = {
  prisma,
  DEFAULT_PREFERENCES,
  DEFAULT_FEATURE_FLAGS,
  hashPassword,
  comparePassword,
  generatePasswordResetToken,
  generateEmailVerificationToken,
  isLocked,
  changedPasswordAfter,
  incLoginAttempts,
  isSellerRole,
  serializeAddress,
  serializeSellerProfile,
  toSafeObject,
  toReqUser,
  findById,
  findByEmail,
  pickAddressFields,
};
