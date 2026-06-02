const crypto = require('crypto');
const { prisma } = require('../config/prisma');
const userService = require('../services/userService');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { authLimiter } = require('../middleware');
const {
  generateTokenPair,
  verifyRefreshToken,
  getAccessTokenCookieOptions,
  getRefreshTokenCookieOptions,
} = require('../utils/jwt');
const { cache } = require('../config/redis');
const { sendEmail, emailTemplates } = require('../utils/email');
const logger = require('../utils/logger');

// Helper: persist refresh token, set cookies, return the safe user + tokens.
const sendTokens = async (user, statusCode, res, message) => {
  const { accessToken, refreshToken } = generateTokenPair(user.id, user.role);
  const hashedRefresh = crypto.createHash('sha256').update(refreshToken).digest('hex');
  await prisma.user.update({ where: { id: user.id }, data: { refreshToken: hashedRefresh, lastLoginAt: new Date() } });

  res.cookie('accessToken', accessToken, getAccessTokenCookieOptions());
  res.cookie('refreshToken', refreshToken, getRefreshTokenCookieOptions());

  return ApiResponse.success(res, { user: userService.toSafeObject(user), accessToken, refreshToken }, message, statusCode);
};

// @desc    Register new user
// @route   POST /api/auth/register
// @access  Public
const register = async (req, res, next) => {
  try {
    const { name, password } = req.body;
    const email = String(req.body.email).toLowerCase().trim();

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) return next(ApiError.conflict('Email already registered'));

    const { token, hashedToken, expiry } = userService.generateEmailVerificationToken();
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: await userService.hashPassword(password),
        emailVerificationToken: hashedToken,
        emailVerificationExpiry: expiry,
        preferences: userService.DEFAULT_PREFERENCES,
        featureFlags: userService.DEFAULT_FEATURE_FLAGS,
      },
    });

    try {
      const { subject, html } = emailTemplates.verification(name, token, process.env.FRONTEND_URL);
      await sendEmail({ to: email, subject, html });
    } catch (emailErr) {
      logger.error(`Failed to send verification email: ${emailErr.message}`);
      // Don't fail registration if email fails
    }

    logger.info(`New user registered: ${email}`);
    return sendTokens(user, 201, res, 'Registration successful. Please verify your email.');
  } catch (err) { next(err); }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res, next) => {
  try {
    const password = req.body.password;
    const user = await userService.findByEmail(req.body.email);
    if (!user) return next(ApiError.unauthorized('Invalid email or password'));

    // Check if account is locked
    if (userService.isLocked(user)) {
      const lockMins = Math.ceil((new Date(user.lockUntil).getTime() - Date.now()) / 60000);
      const lockCount = user.lockCount || 0;
      // lockCount >= 4 means they've hit the 30-min tier — suggest password recovery
      if (lockCount >= 4) {
        return next(ApiError.tooMany(
          `Account locked. Try again in ${lockMins} minute${lockMins !== 1 ? 's' : ''}, or reset your password to regain access immediately.`,
          [{ suggestPasswordReset: true }]
        ));
      }
      return next(ApiError.tooMany(`Account locked. Try again in ${lockMins} minute${lockMins !== 1 ? 's' : ''}`));
    }

    // Check if OAuth user (no password)
    if (!user.password) return next(ApiError.badRequest('Please use social login for this account'));

    // Verify password
    const isPasswordValid = await userService.comparePassword(password, user.password);
    if (!isPasswordValid) {
      await userService.incLoginAttempts(user);
      return next(ApiError.unauthorized('Invalid email or password'));
    }

    // Check account status
    if (!user.isActive) return next(ApiError.forbidden('Account is deactivated'));
    if (user.isBanned) return next(ApiError.forbidden(`Account banned: ${user.banReason}`));

    // Reset login attempts and lockout state on success
    if (user.loginAttempts > 0 || user.lockCount > 0) {
      await prisma.user.update({ where: { id: user.id }, data: { loginAttempts: 0, lockCount: 0, lockUntil: null } });
    }

    try { authLimiter.resetKey(req.ip); } catch { /* no-op in tests */ }
    logger.info(`User logged in: ${user.email}`);
    return sendTokens(user, 200, res, 'Login successful');
  } catch (err) { next(err); }
};

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
const logout = async (req, res, next) => {
  try {
    // Blacklist the current access token
    if (req.token) {
      const decoded = require('jsonwebtoken').decode(req.token);
      const ttl = decoded ? decoded.exp - Math.floor(Date.now() / 1000) : 900;
      await cache.blacklistToken(req.token, ttl > 0 ? ttl : 900);
    }

    // Clear refresh token from DB
    await prisma.user.update({ where: { id: req.user._id }, data: { refreshToken: null } });

    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');

    return ApiResponse.success(res, null, 'Logged out successfully');
  } catch (err) { next(err); }
};

// @desc    Refresh access token
// @route   POST /api/auth/refresh
// @access  Public (requires refresh token cookie)
const refreshToken = async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!token) return next(ApiError.unauthorized('Refresh token required'));

    let decoded;
    try {
      decoded = verifyRefreshToken(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return next(ApiError.unauthorized('Refresh token expired. Please log in again.'));
      }
      return next(err);
    }

    const user = await userService.findById(decoded.id);
    if (!user) return next(ApiError.unauthorized('User not found'));

    // Verify stored refresh token matches
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    if (user.refreshToken !== hashedToken) {
      return next(ApiError.unauthorized('Invalid refresh token'));
    }

    return sendTokens(user, 200, res, 'Token refreshed');
  } catch (err) { next(err); }
};

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res, next) => {
  try {
    // NOTE: wishlist is returned as id strings until Plan 1C re-adds product population.
    const user = await userService.findById(req.user._id);
    return ApiResponse.success(res, userService.toSafeObject(user), 'User fetched');
  } catch (err) { next(err); }
};

// @desc    Forgot password
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = async (req, res, next) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    const user = await prisma.user.findUnique({ where: { email } });

    // Always return success to prevent email enumeration
    if (!user) {
      return ApiResponse.success(res, null, 'If that email exists, a reset link has been sent');
    }

    const { resetToken, hashedToken, expiry } = userService.generatePasswordResetToken();
    await prisma.user.update({ where: { id: user.id }, data: { passwordResetToken: hashedToken, passwordResetExpiry: expiry } });

    try {
      const { subject, html } = emailTemplates.passwordReset(user.name, resetToken, process.env.FRONTEND_URL);
      await sendEmail({ to: email, subject, html });
    } catch (emailErr) {
      await prisma.user.update({ where: { id: user.id }, data: { passwordResetToken: null, passwordResetExpiry: null } });
      return next(ApiError.internal('Failed to send reset email'));
    }

    return ApiResponse.success(res, null, 'Password reset email sent');
  } catch (err) { next(err); }
};

// @desc    Reset password
// @route   PUT /api/auth/reset-password/:token
// @access  Public
const resetPassword = async (req, res, next) => {
  try {
    const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');
    const user = await prisma.user.findFirst({
      where: { passwordResetToken: hashedToken, passwordResetExpiry: { gt: new Date() } },
    });
    if (!user) return next(ApiError.badRequest('Invalid or expired reset token'));

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: await userService.hashPassword(req.body.password),
        passwordChangedAt: new Date(Date.now() - 1000),
        passwordResetToken: null,
        passwordResetExpiry: null,
        loginAttempts: 0,
        lockUntil: null,
        lockCount: 0,
      },
    });

    const fresh = await userService.findById(user.id);
    logger.info(`Password reset for: ${user.email}`);
    return sendTokens(fresh, 200, res, 'Password reset successful');
  } catch (err) { next(err); }
};

// @desc    Verify email
// @route   GET /api/auth/verify-email/:token
// @access  Public
const verifyEmail = async (req, res, next) => {
  try {
    const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');
    const user = await prisma.user.findFirst({
      where: { emailVerificationToken: hashedToken, emailVerificationExpiry: { gt: new Date() } },
    });
    if (!user) return next(ApiError.badRequest('Invalid or expired verification token'));

    // Idempotent: leave the token in place until natural expiry so repeat clicks still succeed.
    if (!user.isEmailVerified) {
      await prisma.user.update({ where: { id: user.id }, data: { isEmailVerified: true } });
    }

    return ApiResponse.success(res, null, 'Email verified successfully');
  } catch (err) { next(err); }
};

// @desc    Change password (authenticated)
// @route   PUT /api/auth/change-password
// @access  Private
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user._id } });

    if (!user.password) {
      return next(ApiError.badRequest('Cannot change password for social accounts'));
    }

    const isValid = await userService.comparePassword(currentPassword, user.password);
    if (!isValid) return next(ApiError.unauthorized('Current password is incorrect'));

    await prisma.user.update({
      where: { id: user.id },
      data: { password: await userService.hashPassword(newPassword), passwordChangedAt: new Date(Date.now() - 1000) },
    });

    logger.info(`Password changed for: ${user.email}`);
    return ApiResponse.success(res, null, 'Password changed successfully');
  } catch (err) { next(err); }
};

// @desc    OAuth callback handler
// @route   Used by passport.js
// @access  Internal
const oauthCallback = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { accessToken, refreshToken } = generateTokenPair(userId, req.user.role);
    const hashedRefresh = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await prisma.user.update({ where: { id: userId }, data: { refreshToken: hashedRefresh, lastLoginAt: new Date() } });

    res.cookie('accessToken', accessToken, getAccessTokenCookieOptions());
    res.cookie('refreshToken', refreshToken, getRefreshTokenCookieOptions());

    res.redirect(`${process.env.FRONTEND_URL}/oauth/callback?token=${accessToken}`);
  } catch (err) {
    logger.error(`OAuth callback error: ${err.message}`);
    res.redirect(`${process.env.FRONTEND_URL}/login?error=oauth_failed`);
  }
};

// @desc    Resend verification email
// @route   POST /api/auth/resend-verification
// @access  Private
const resendVerification = async (req, res, next) => {
  try {
    if (req.user.isEmailVerified) {
      return next(ApiError.badRequest('Email is already verified'));
    }

    const { token, hashedToken, expiry } = userService.generateEmailVerificationToken();
    const user = await prisma.user.update({
      where: { id: req.user._id },
      data: { emailVerificationToken: hashedToken, emailVerificationExpiry: expiry },
    });

    const { subject, html } = emailTemplates.verification(user.name, token, process.env.FRONTEND_URL);
    await sendEmail({ to: user.email, subject, html });

    return ApiResponse.success(res, null, 'Verification email resent');
  } catch (err) { next(err); }
};

module.exports = {
  register,
  login,
  logout,
  refreshToken,
  getMe,
  forgotPassword,
  resetPassword,
  verifyEmail,
  changePassword,
  oauthCallback,
  resendVerification,
};
