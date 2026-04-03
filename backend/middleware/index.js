const jwt = require('jsonwebtoken');
const onHeaders = require('on-headers');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const morgan = require('morgan');
const Joi = require('joi');
const { body, query, param, validationResult } = require('express-validator');

const User = require('../models/User');
const { AuditLog } = require('../models/index');
const ApiError = require('../utils/ApiError');
const { verifyAccessToken } = require('../utils/jwt');
const { cache } = require('../config/redis');
const logger = require('../utils/logger');

// ============================================================
// 1. AUTHENTICATION & AUTHORIZATION MIDDLEWARE
// ============================================================

const authenticate = async (req, res, next) => {
  try {
    let token;

    // Extract from Authorization header or cookie
    if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      return next(ApiError.unauthorized('Authentication required. Please log in.'));
    }

    // Check token blacklist (Redis)
    const isBlacklisted = await cache.isTokenBlacklisted(token);
    if (isBlacklisted) {
      return next(ApiError.unauthorized('Token has been invalidated. Please log in again.'));
    }

    // Verify token
    const decoded = verifyAccessToken(token);

    // Fetch user
    const user = await User.findById(decoded.id).select('-password -refreshToken');
    if (!user) return next(ApiError.unauthorized('User not found'));
    if (!user.isActive) return next(ApiError.forbidden('Account is deactivated'));
    if (user.isBanned) return next(ApiError.forbidden(`Account banned: ${user.banReason}`));

    // Check if password changed after token was issued
    if (user.changedPasswordAfter(decoded.iat)) {
      return next(ApiError.unauthorized('Password changed recently. Please log in again.'));
    }

    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return next(ApiError.unauthorized('Token expired. Please refresh your session.'));
    }
    if (error.name === 'JsonWebTokenError') {
      return next(ApiError.unauthorized('Invalid token'));
    }
    next(error);
  }
};

// Optional auth — doesn't fail if no token
const optionalAuth = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    if (token) {
      const decoded = verifyAccessToken(token);
      const user = await User.findById(decoded.id).select('-password');
      if (user && user.isActive && !user.isBanned) {
        req.user = user;
      }
    }
    next();
  } catch {
    next(); // Silently fail — optional auth
  }
};

// ============================================================
// 2. ROLE-BASED ACCESS CONTROL (RBAC)
// ============================================================

const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized('Authentication required'));
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden(`Access denied. Required role: ${roles.join(' or ')}`));
    }
    next();
  };
};

const requireSeller = (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (!['seller', 'admin', 'superadmin'].includes(req.user.role)) {
    return next(ApiError.forbidden('Seller account required'));
  }
  if (req.user.role === 'seller' && !req.user.sellerProfile?.isApproved) {
    return next(ApiError.forbidden('Seller account pending approval'));
  }
  next();
};

const requireAdmin = requireRole('admin', 'superadmin');
const requireSuperAdmin = requireRole('superadmin');

// Ownership check middleware factory
const requireOwnership = (Model, paramKey = 'id', ownerField = 'user') => {
  return async (req, res, next) => {
    try {
      const doc = await Model.findById(req.params[paramKey]);
      if (!doc) return next(ApiError.notFound());

      const ownerId = doc[ownerField]?.toString?.() || doc[ownerField];
      const userId = req.user._id.toString();
      const isAdmin = ['admin', 'superadmin'].includes(req.user.role);

      if (!isAdmin && ownerId !== userId) {
        return next(ApiError.forbidden('You do not own this resource'));
      }

      req.resource = doc;
      next();
    } catch (err) {
      next(err);
    }
  };
};

// ============================================================
// 3. RATE LIMITING
// ============================================================

const createRateLimiter = (windowMs, max, message) =>
  rateLimit({
    windowMs,
    max,
    message: { success: false, message },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, _res, next) => next(ApiError.tooMany(message)),
    skip: (req) => req.user?.role === 'superadmin', // Superadmin bypass
  });

// Auth routes have their own authLimiter with a stricter limit and a specific
// "Too many login attempts" message. Skipping them here ensures the global
// limiter never fires on those routes and produces a confusingly generic message.
// req.path is relative to the mount point (/api/).
const globalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  message: { success: false, message: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    req.path === '/auth/refresh' ||
    req.path === '/auth/logout' ||
    req.path === '/auth/login' ||
    req.path === '/auth/register' ||
    req.path === '/auth/forgot-password' ||
    req.path.startsWith('/auth/reset-password'),
});

const authLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 min
  parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 10,
  'Too many login attempts, please try again after 15 minutes'
);

const uploadLimiter = createRateLimiter(60 * 60 * 1000, 30, 'Upload limit reached');

// ============================================================
// 4. FILE UPLOAD MIDDLEWARE (Multer + Sharp)
// ============================================================

const ensureUploadDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const storage = multer.memoryStorage(); // Use memory for Sharp processing

const fileFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new ApiError(400, 'Only image files are allowed (JPEG, PNG, WebP, GIF)'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 10,
  },
});

// Image processing middleware using Sharp
const processImages = (options = {}) => {
  return async (req, res, next) => {
    if (!req.files && !req.file) return next();

    const {
      width = 800,
      height = 800,
      quality = 85,
      format = 'webp',
      outputDir = 'uploads/products',
    } = options;

    ensureUploadDir(outputDir);

    const processFile = async (file) => {
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${format}`;
      const outputPath = path.join(outputDir, filename);

      await sharp(file.buffer)
        .resize(width, height, { fit: 'inside', withoutEnlargement: true })
        .toFormat(format, { quality })
        .toFile(outputPath);

      return {
        url: `/${outputPath}`,
        filename,
        originalname: file.originalname,
        size: fs.statSync(outputPath).size,
      };
    };

    try {
      if (req.files) {
        const files = Array.isArray(req.files) ? req.files : Object.values(req.files).flat();
        req.processedImages = await Promise.all(files.map(processFile));
      } else if (req.file) {
        req.processedImage = await processFile(req.file);
      }
      next();
    } catch (err) {
      next(new ApiError(500, `Image processing failed: ${err.message}`));
    }
  };
};

// ============================================================
// 5. VALIDATION MIDDLEWARE (Joi)
// ============================================================

const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    const data = source === 'body' ? req.body : source === 'query' ? req.query : req.params;
    const { error, value } = schema.validate(data, {
      abortEarly: false,
      stripUnknown: true,
      allowUnknown: false,
    });

    if (error) {
      const errors = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message,
      }));
      return next(new ApiError(422, 'Validation failed', errors));
    }

    if (source === 'body') req.body = value;
    else if (source === 'query') req.query = value;
    else req.params = value;

    next();
  };
};

// express-validator middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formatted = errors.array().map((e) => ({ field: e.path, message: e.msg }));
    return next(new ApiError(422, 'Validation failed', formatted));
  }
  next();
};

// ============================================================
// 6. RESPONSE CACHING MIDDLEWARE
// ============================================================

const cacheMiddleware = (ttl = 300, keyPrefix = '') => {
  return async (req, res, next) => {
    if (req.method !== 'GET') return next();

    const key = `cache:${keyPrefix}:${req.originalUrl}:${req.user?._id || 'public'}`;
    const cached = await cache.get(key);

    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached);
    }

    // Intercept res.json to cache the response
    const originalJson = res.json.bind(res);
    res.json = (data) => {
      if (res.statusCode === 200) {
        cache.set(key, data, ttl);
      }
      res.setHeader('X-Cache', 'MISS');
      return originalJson(data);
    };

    next();
  };
};

// ============================================================
// 7. AUDIT LOGGING MIDDLEWARE
// ============================================================

const auditLog = (action, resource) => {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = async (data) => {
      // Log after response
      try {
        await AuditLog.create({
          user: req.user?._id,
          action,
          resource,
          resourceId: req.params?.id,
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          ip: req.ip,
          userAgent: req.get('user-agent'),
          metadata: { query: req.query, body: sanitizeForLog(req.body) },
        });
      } catch (err) {
        logger.error(`Audit log failed: ${err.message}`);
      }
      return originalJson(data);
    };

    next();
  };
};

const sanitizeForLog = (obj) => {
  if (!obj) return obj;
  const sensitiveFields = ['password', 'token', 'secret', 'credit_card', 'cvv'];
  const sanitized = { ...obj };
  sensitiveFields.forEach((field) => {
    if (sanitized[field]) sanitized[field] = '[REDACTED]';
  });
  return sanitized;
};

// ============================================================
// 8. HTTP LOGGING MIDDLEWARE (Morgan)
// ============================================================

const httpLogger = morgan(
  ':method :url :status :res[content-length] - :response-time ms',
  { stream: logger.stream }
);

// ============================================================
// 9. ERROR HANDLING MIDDLEWARE
// ============================================================

const notFound = (req, res, next) => {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
};

const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;
  error.statusCode = err.statusCode || 500;

  // Log error
  if (error.statusCode >= 500) {
    logger.error(`${error.statusCode} - ${error.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`, { stack: err.stack });
  } else {
    logger.warn(`${error.statusCode} - ${error.message} - ${req.originalUrl}`);
  }

  // Mongoose CastError
  if (err.name === 'CastError') {
    error = ApiError.notFound(`Invalid ID: ${err.value}`);
  }

  // Mongoose Duplicate Key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    error = ApiError.conflict(`${field} already exists`);
  }

  // Mongoose Validation Error
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    error = new ApiError(422, 'Validation failed', errors);
  }

  // JWT Errors
  if (err.name === 'JsonWebTokenError') error = ApiError.unauthorized('Invalid token');
  if (err.name === 'TokenExpiredError') error = ApiError.unauthorized('Token expired');

  // Multer Errors
  if (err.code === 'LIMIT_FILE_SIZE') error = new ApiError(400, 'File too large (max 10MB)');
  if (err.code === 'LIMIT_FILE_COUNT') error = new ApiError(400, 'Too many files (max 10)');

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || 'Internal Server Error',
    errors: error.errors || [],
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

// ============================================================
// 10. PERFORMANCE TIMING MIDDLEWARE
// ============================================================

const performanceTiming = (req, res, next) => {
  const start = process.hrtime.bigint();

  onHeaders(res, () => {
    const duration = Number(process.hrtime.bigint() - start) / 1e6;
    res.setHeader('X-Response-Time', `${duration.toFixed(2)}ms`);
  });

  res.on('finish', () => {
    const duration = Number(process.hrtime.bigint() - start) / 1e6;
    if (duration > 1000) {
      logger.warn(`Slow request: ${req.method} ${req.originalUrl} took ${duration.toFixed(2)}ms`);
    }
  });

  next();
};

// ============================================================
// 11. FEATURE FLAGS MIDDLEWARE
// ============================================================

const featureFlags = {
  isEnabled: (flagName, user = null) => {
    const globalFlags = {
      newCheckout: process.env.FEATURE_NEW_CHECKOUT === 'true',
      betaReviews: process.env.FEATURE_BETA_REVIEWS === 'true',
      aiRecommendations: process.env.FEATURE_AI_RECOMMENDATIONS === 'true',
    };
    if (user?.featureFlags?.[flagName] !== undefined) {
      return user.featureFlags[flagName];
    }
    return globalFlags[flagName] || false;
  },

  middleware: (flagName) => (req, res, next) => {
    if (!featureFlags.isEnabled(flagName, req.user)) {
      return res.status(404).json({ success: false, message: 'Feature not available' });
    }
    next();
  },
};

// ============================================================
// 12. REQUEST TRANSFORMATION MIDDLEWARE
// ============================================================

const addRequestMetadata = (req, res, next) => {
  req.requestId = require('crypto').randomUUID();
  req.clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.connection.remoteAddress;
  res.setHeader('X-Request-ID', req.requestId);
  next();
};

// ============================================================
// Joi Schemas for Validation
// ============================================================

const schemas = {
  register: Joi.object({
    name: Joi.string().min(2).max(50).required(),
    email: Joi.string().email().required(),
    password: Joi.string()
      .min(8)
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/)
      .required()
      .messages({
        'string.pattern.base': 'Password must contain uppercase, lowercase, number, and special character',
      }),
    confirmPassword: Joi.string().valid(Joi.ref('password')).required().messages({
      'any.only': 'Passwords do not match',
    }),
  }),

  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
    rememberMe: Joi.boolean().default(false),
  }),

  product: Joi.object({
    name: Joi.string().min(3).max(200).required(),
    description: Joi.string().min(10).max(5000).required(),
    shortDescription: Joi.string().max(300),
    price: Joi.number().min(0).required(),
    compareAtPrice: Joi.number().min(0),
    category: Joi.string().required(),
    tags: Joi.string().allow(''),       // comma-separated string; split into array in controller
    stock: Joi.number().min(0).default(0),
    brand: Joi.string().max(100),
    sku: Joi.string().max(100),
    status: Joi.string().valid('draft', 'active', 'inactive'),
    isFeatured: Joi.boolean(),
    isTrending: Joi.boolean(),
    isNewArrival: Joi.boolean(),
    weight: Joi.number().min(0),        // flat; built into shipping.weight in controller
    isFreeShipping: Joi.boolean(),      // flat; built into shipping.isFreeShipping in controller
    metaTitle: Joi.string().max(200).allow(''),
    metaDescription: Joi.string().max(500).allow(''),
  }),

  updateProfile: Joi.object({
    name: Joi.string().min(2).max(50),
    phone: Joi.string().pattern(/^\+?[\d\s-]{7,20}$/),
    dateOfBirth: Joi.date().max('now'),
    gender: Joi.string().valid('male', 'female', 'other', 'prefer-not-to-say'),
  }),

  address: Joi.object({
    label: Joi.string().max(50),
    street: Joi.string().required(),
    city: Joi.string().required(),
    state: Joi.string().required(),
    country: Joi.string().required(),
    zipCode: Joi.string().required(),
    isDefault: Joi.boolean(),
  }),

  review: Joi.object({
    rating: Joi.number().min(1).max(5).required(),
    title: Joi.string().max(100),
    body: Joi.string().max(1000),
    orderId: Joi.string(),
  }),

  pagination: Joi.object({
    page: Joi.number().min(1).default(1),
    limit: Joi.number().min(1).max(100).default(20),
    sort: Joi.string().default('-createdAt'),
    search: Joi.string().allow(''),
    category: Joi.string().allow(''),
    minPrice: Joi.number().min(0),
    maxPrice: Joi.number().min(0),
    rating: Joi.number().min(0).max(5),
    inStock: Joi.boolean(),
    seller: Joi.string().allow(''),
    status: Joi.string().allow(''),
    featured: Joi.boolean(),
    trending: Joi.boolean(),
  }),
};

module.exports = {
  authenticate,
  optionalAuth,
  requireRole,
  requireSeller,
  requireAdmin,
  requireSuperAdmin,
  requireOwnership,
  globalLimiter,
  authLimiter,
  uploadLimiter,
  upload,
  processImages,
  validate,
  handleValidationErrors,
  cacheMiddleware,
  auditLog,
  httpLogger,
  notFound,
  errorHandler,
  performanceTiming,
  featureFlags,
  addRequestMetadata,
  schemas,
  mongoSanitize,
};
