const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const addressSchema = new mongoose.Schema({
  label: { type: String, default: 'Home' },
  street: { type: String, required: true },
  city: { type: String, required: true },
  state: { type: String, required: true },
  country: { type: String, required: true, default: 'US' },
  zipCode: { type: String, required: true },
  isDefault: { type: Boolean, default: false },
});

const sellerProfileSchema = new mongoose.Schema({
  storeName: { type: String, trim: true },
  storeBio: { type: String, maxlength: 500 },
  storeLogo: String,
  storeLogoPublicId: String,
  storeBanner: String,
  storeBannerPublicId: String,
  storeSlug: { type: String, unique: true, sparse: true },
  bankAccount: {
    accountNumber: String, // encrypted
    routingNumber: String, // encrypted
    bankName: String,
  },
  stripeAccountId: String,
  storeEmail: String,
  storePhone: String,
  returnPolicy: String,
  shippingPolicy: String,
  socialLinks: {
    website: String,
    instagram: String,
    twitter: String,
  },
  totalSales: { type: Number, default: 0 },
  totalRevenue: { type: Number, default: 0 },
  rating: { type: Number, default: 0 },
  reviewCount: { type: Number, default: 0 },
  isApproved: { type: Boolean, default: false },
  approvedAt: Date,
  suspendedAt: Date,
  suspendReason: String,
});

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [50, 'Name cannot exceed 50 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
    },
    password: {
      type: String,
      minlength: [8, 'Password must be at least 8 characters'],
      select: false,
    },
    role: {
      type: String,
      enum: ['user', 'seller', 'admin', 'superadmin'],
      default: 'user',
    },
    avatar: {
      type: String,
      default: null,
    },
    avatarPublicId: String,
    phone: String,
    dateOfBirth: Date,
    gender: { type: String, enum: ['male', 'female', 'other', 'prefer-not-to-say'] },

    // Address book
    addresses: [addressSchema],

    // Seller profile (when user upgrades to seller)
    sellerProfile: sellerProfileSchema,

    // OAuth providers
    oauth: {
      googleId: String,
      facebookId: String,
    },

    // Email verification
    isEmailVerified: { type: Boolean, default: false },
    emailVerificationToken: String,
    emailVerificationExpiry: Date,

    // Password reset
    passwordResetToken: String,
      passwordResetExpiry: Date,
    passwordChangedAt: Date,

    // Refresh token for rotation
    refreshToken: { type: String, select: false },

    // Account status
    isActive: { type: Boolean, default: true },
    isBanned: { type: Boolean, default: false },
    banReason: String,
    bannedAt: Date,

    // Security
    loginAttempts: { type: Number, default: 0 },
    lockUntil: Date,
    lockCount: { type: Number, default: 0, select: false }, // how many times locked (drives progressive duration)
    lastLoginAt: Date,
    lastLoginIp: String,

    // Preferences
    preferences: {
      currency: { type: String, default: 'USD' },
      language: { type: String, default: 'en' },
      notifications: {
        email: { type: Boolean, default: true },
        push: { type: Boolean, default: true },
        sms: { type: Boolean, default: false },
        orderUpdates: { type: Boolean, default: true },
        promotions: { type: Boolean, default: true },
      },
      theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
    },

    // Wishlist
    wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],

    // Feature flags for A/B testing
    featureFlags: {
      newCheckout: { type: Boolean, default: false },
      betaFeatures: { type: Boolean, default: false },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for performance
userSchema.index({ role: 1 });
userSchema.index({ 'oauth.googleId': 1 }, { sparse: true });
userSchema.index({ 'oauth.facebookId': 1 }, { sparse: true });
userSchema.index({ createdAt: -1 });

// Virtual: isLocked
userSchema.virtual('isLocked').get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Virtual: isSeller
userSchema.virtual('isSeller').get(function () {
  return this.role === 'seller' || this.role === 'admin' || this.role === 'superadmin';
});

// Pre-save: Hash password
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    if (!this.isNew) this.passwordChangedAt = Date.now() - 1000;
    next();
  } catch (err) {
    next(err);
  }
});

// Instance method: Compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

// Instance method: Check if password changed after JWT was issued
userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

// Instance method: Generate password reset token
userSchema.methods.generatePasswordResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString('hex');
  this.passwordResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  this.passwordResetExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes
  return resetToken;
};

// Instance method: Generate email verification token
userSchema.methods.generateEmailVerificationToken = function () {
  const token = crypto.randomBytes(20).toString('hex');
  this.emailVerificationToken = crypto.createHash('sha256').update(token).digest('hex');
  this.emailVerificationExpiry = Date.now() + 24 * 60 * 60 * 1000;
  return token;
};

// Progressive lockout durations (minutes): 3 → 5 → 15 → 30
const LOCK_DURATIONS_MS = [3, 5, 15, 30].map((m) => m * 60 * 1000);

// Instance method: Increment login attempts with progressive lockout
userSchema.methods.incLoginAttempts = async function () {
  // Lock expired — start a new round, keep lockCount for escalation
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({ $set: { loginAttempts: 1 }, $unset: { lockUntil: 1 } });
  }

  const newAttempts = (this.loginAttempts || 0) + 1;

  // Every 5th failed attempt triggers a lock
  if (newAttempts >= 5 && !this.isLocked) {
    const lockCount = this.lockCount || 0;
    const durationMs = LOCK_DURATIONS_MS[Math.min(lockCount, LOCK_DURATIONS_MS.length - 1)];
    return this.updateOne({
      $set: { lockUntil: Date.now() + durationMs, loginAttempts: 0 },
      $inc: { lockCount: 1 },
    });
  }

  return this.updateOne({ $inc: { loginAttempts: 1 } });
};

// Remove sensitive fields from JSON output
userSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refreshToken;
  delete obj.passwordResetToken;
  delete obj.passwordResetExpiry;
  delete obj.emailVerificationToken;
  delete obj.emailVerificationExpiry;
  delete obj.loginAttempts;
  delete obj.lockUntil;
  if (obj.sellerProfile?.bankAccount) {
    delete obj.sellerProfile.bankAccount;
  }
  return obj;
};

const User = mongoose.model('User', userSchema);
module.exports = User;
