const crypto = require('crypto');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const {
  generateTokenPair,
  verifyRefreshToken,
  getAccessTokenCookieOptions,
  getRefreshTokenCookieOptions,
  generateEmailToken,
} = require('../utils/jwt');
const { cache } = require('../config/redis');
const { sendEmail, emailTemplates } = require('../utils/email');
const logger = require('../utils/logger');

// Helper: send tokens
const sendTokens = async (user, statusCode, res, message) => {
  const { accessToken, refreshToken } = generateTokenPair(user._id, user.role);

  // Save refresh token hash to DB
  const hashedRefresh = crypto.createHash('sha256').update(refreshToken).digest('hex');
  await User.findByIdAndUpdate(user._id, { refreshToken: hashedRefresh, lastLoginAt: Date.now() });

  // Set secure cookies
  res.cookie('accessToken', accessToken, getAccessTokenCookieOptions());
  res.cookie('refreshToken', refreshToken, getRefreshTokenCookieOptions());

  return ApiResponse.success(
    res,
    { user: user.toSafeObject(), accessToken, refreshToken },
    message,
    statusCode
  );
};

// @desc    Register new user
// @route   POST /api/auth/register
// @access  Public
const register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    // Check if email exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return next(ApiError.conflict('Email already registered'));
    }

    // Create user
    const user = await User.create({ name, email, password });

    // Generate email verification token
    const verifyToken = user.generateEmailVerificationToken();
    await user.save({ validateBeforeSave: false });

    // Send verification email
    try {
      const { subject, html } = emailTemplates.verification(
        name,
        verifyToken,
        process.env.FRONTEND_URL
      );
      await sendEmail({ to: email, subject, html });
    } catch (emailErr) {
      logger.error(`Failed to send verification email: ${emailErr.message}`);
      // Don't fail registration if email fails
    }

    logger.info(`New user registered: ${email}`);
    return sendTokens(user, 201, res, 'Registration successful. Please verify your email.');
  } catch (err) {
    next(err);
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Find user with password
    const user = await User.findOne({ email }).select('+password +refreshToken +loginAttempts +lockUntil +lockCount');

    if (!user) {
      return next(ApiError.unauthorized('Invalid email or password'));
    }

    // Check if account is locked
    if (user.isLocked) {
      const lockMins = Math.ceil((user.lockUntil - Date.now()) / 60000);
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
    if (!user.password) {
      return next(ApiError.badRequest('Please use social login for this account'));
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      await user.incLoginAttempts();
      return next(ApiError.unauthorized('Invalid email or password'));
    }

    // Check account status
    if (!user.isActive) return next(ApiError.forbidden('Account is deactivated'));
    if (user.isBanned) return next(ApiError.forbidden(`Account banned: ${user.banReason}`));

    // Reset login attempts and lockout state on success
    if (user.loginAttempts > 0 || user.lockCount > 0) {
      await user.updateOne({ $set: { loginAttempts: 0, lockCount: 0 }, $unset: { lockUntil: 1 } });
    }

    // Update last login info
    user.lastLoginAt = Date.now();
    user.lastLoginIp = req.clientIp;

    logger.info(`User logged in: ${email}`);
    return sendTokens(user, 200, res, 'Login successful');
  } catch (err) {
    next(err);
  }
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
    await User.findByIdAndUpdate(req.user._id, { $unset: { refreshToken: 1 } });

    // Clear cookies
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');

    return ApiResponse.success(res, null, 'Logged out successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Refresh access token
// @route   POST /api/auth/refresh
// @access  Public (requires refresh token cookie)
const refreshToken = async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!token) return next(ApiError.unauthorized('Refresh token required'));

    const decoded = verifyRefreshToken(token);
    const user = await User.findById(decoded.id).select('+refreshToken');

    if (!user) return next(ApiError.unauthorized('User not found'));

    // Verify stored refresh token matches
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    if (user.refreshToken !== hashedToken) {
      return next(ApiError.unauthorized('Invalid refresh token'));
    }

    return sendTokens(user, 200, res, 'Token refreshed');
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(ApiError.unauthorized('Refresh token expired. Please log in again.'));
    }
    next(err);
  }
};

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('wishlist', 'name price images slug')
      .lean();

    return ApiResponse.success(res, user, 'User fetched');
  } catch (err) {
    next(err);
  }
};

// @desc    Forgot password
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    // Always return success to prevent email enumeration
    if (!user) {
      return ApiResponse.success(res, null, 'If that email exists, a reset link has been sent');
    }

    const resetToken = user.generatePasswordResetToken();
    await user.save({ validateBeforeSave: false });

    try {
      const { subject, html } = emailTemplates.passwordReset(
        user.name,
        resetToken,
        process.env.FRONTEND_URL
      );
      await sendEmail({ to: email, subject, html });
    } catch (emailErr) {
      user.passwordResetToken = undefined;
      user.passwordResetExpiry = undefined;
      await user.save({ validateBeforeSave: false });
      return next(ApiError.internal('Failed to send reset email'));
    }

    return ApiResponse.success(res, null, 'Password reset email sent');
  } catch (err) {
    next(err);
  }
};

// @desc    Reset password
// @route   PUT /api/auth/reset-password/:token
// @access  Public
const resetPassword = async (req, res, next) => {
  try {
    const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpiry: { $gt: Date.now() },
    });

    if (!user) return next(ApiError.badRequest('Invalid or expired reset token'));

    user.password = req.body.password;
    user.passwordResetToken = undefined;
    user.passwordResetExpiry = undefined;
    user.loginAttempts = 0;
    user.lockUntil = undefined;
    user.lockCount = 0;
    await user.save();

    logger.info(`Password reset for: ${user.email}`);
    return sendTokens(user, 200, res, 'Password reset successful');
  } catch (err) {
    next(err);
  }
};

// @desc    Verify email
// @route   GET /api/auth/verify-email/:token
// @access  Public
const verifyEmail = async (req, res, next) => {
  try {
    const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

    const user = await User.findOne({
      emailVerificationToken: hashedToken,
      emailVerificationExpiry: { $gt: Date.now() },
    });

    if (!user) return next(ApiError.badRequest('Invalid or expired verification token'));

    // Idempotent: keep the token in DB until it expires naturally so that
    // subsequent clicks (e.g. after an email scanner pre-fetches the link)
    // still find the user and return success instead of 400.
    if (!user.isEmailVerified) {
      await User.findByIdAndUpdate(user._id, { isEmailVerified: true });
    }

    return ApiResponse.success(res, null, 'Email verified successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Change password (authenticated)
// @route   PUT /api/auth/change-password
// @access  Private
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id).select('+password');

    if (!user.password) {
      return next(ApiError.badRequest('Cannot change password for social accounts'));
    }

    const isValid = await user.comparePassword(currentPassword);
    if (!isValid) return next(ApiError.unauthorized('Current password is incorrect'));

    user.password = newPassword;
    await user.save();

    logger.info(`Password changed for: ${user.email}`);
    return ApiResponse.success(res, null, 'Password changed successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    OAuth callback handler
// @route   Used by passport.js
// @access  Internal
const oauthCallback = async (req, res) => {
  try {
    return sendTokens(req.user, 200, res, 'OAuth login successful');
  } catch (err) {
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

    const user = await User.findById(req.user._id);
    const verifyToken = user.generateEmailVerificationToken();
    await user.save({ validateBeforeSave: false });

    const { subject, html } = emailTemplates.verification(
      user.name,
      verifyToken,
      process.env.FRONTEND_URL
    );
    await sendEmail({ to: user.email, subject, html });

    return ApiResponse.success(res, null, 'Verification email resent');
  } catch (err) {
    next(err);
  }
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
