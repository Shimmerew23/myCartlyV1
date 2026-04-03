const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const generateAccessToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRE || '15m',
    issuer: 'CartLy-ecommerce',
    audience: 'CartLy-users',
  });
};

const generateRefreshToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d',
    issuer: 'CartLy-ecommerce',
    audience: 'CartLy-users',
  });
};

const verifyAccessToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET, {
    issuer: 'CartLy-ecommerce',
    audience: 'CartLy-users',
  });
};

const verifyRefreshToken = (token) => {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET, {
    issuer: 'CartLy-ecommerce',
    audience: 'CartLy-users',
  });
};

const generateTokenPair = (userId, role) => {
  const payload = { id: userId, role };
  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken(payload),
  };
};

// Cookie options for secure token storage
const getAccessTokenCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
  maxAge: 15 * 60 * 1000, // 15 minutes
  path: '/',
});

const getRefreshTokenCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
  maxAge: parseInt(process.env.JWT_COOKIE_EXPIRE || 7) * 24 * 60 * 60 * 1000,
  path: '/api/auth/refresh',
});

// Generate cryptographic reset token
const generateResetToken = () => {
  const resetToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  const expiry = Date.now() + 10 * 60 * 1000; // 10 minutes
  return { resetToken, hashedToken, expiry };
};

// Generate email verification token
const generateEmailToken = () => {
  const token = crypto.randomBytes(20).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  const expiry = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  return { token, hashedToken, expiry };
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  generateTokenPair,
  getAccessTokenCookieOptions,
  getRefreshTokenCookieOptions,
  generateResetToken,
  generateEmailToken,
};
