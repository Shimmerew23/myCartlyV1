require('dotenv').config();
require('express-async-errors');

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const hpp = require('hpp');
const path = require('path');
const fs = require('fs');

const { connectPrisma } = require('./config/prisma');
const { connectRedis } = require('./config/redis');
const { connectCloudinary } = require('./config/cloudinary');
const { startAuditCleanup } = require('./jobs/auditCleanup');
const passport = require('./config/passport');
const logger = require('./utils/logger');

const {
  globalLimiter,
  httpLogger,
  notFound,
  errorHandler,
  performanceTiming,
  addRequestMetadata,
} = require('./middleware/index');

const {
  authRouter, productRouter, reviewRouter, orderRouter,
  userRouter, cartRouter, categoryRouter, carrierRouter, adminRouter, feedbackRouter, warehouseRouter,
} = require('./routes/index');

// ============================================================
// Ensure required directories exist
// ============================================================
['logs'].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ============================================================
// Initialize app
// ============================================================
const app = express();

// Trust the first proxy hop (required on Render/Heroku/etc. for express-rate-limit
// to correctly read the client IP from X-Forwarded-For)
app.set('trust proxy', 1);

// ============================================================
// SECURITY MIDDLEWARE
// ============================================================

// Helmet — secure HTTP headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        scriptSrc: ["'self'", 'https://www.paypal.com', 'https://www.sandbox.paypal.com'],
        connectSrc: ["'self'", 'https://api-m.paypal.com', 'https://api-m.sandbox.paypal.com', 'https://api.paymongo.com'],
        frameSrc: ["'self'", 'https://www.paypal.com', 'https://www.sandbox.paypal.com'],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// CORS
app.use(
  cors({
    origin: (origin, callback) => {
      // List of explicitly allowed origins
      const allowedOrigins = [
        'https://mcartly.vercel.app',
        process.env.FRONTEND_URL,
      ].filter(Boolean);

      // Allow LAN IPs for development (192.168.x.x)
      if (!origin || allowedOrigins.includes(origin) || origin.startsWith('http://192.168.')) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked: ${origin}`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token'],
    exposedHeaders: ['X-Response-Time', 'X-Cache', 'X-Request-ID'],
  })
);

// ============================================================
// PARSING & FORMATTING MIDDLEWARE
// ============================================================

// Provider webhooks need the raw body for signature verification — register
// raw parsing for those paths BEFORE the JSON parser. (PayMongo added in 2C.)
app.use('/api/orders/webhook/paypal', express.raw({ type: '*/*' }));

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parser
app.use(cookieParser(process.env.SESSION_SECRET));

// Compression
app.use(compression({ level: 6, threshold: 1024 }));

// HPP — HTTP Parameter Pollution protection
app.use(hpp({ whitelist: ['price', 'rating', 'tags'] }));

// ============================================================
// SESSION & PASSPORT (for OAuth)
// ============================================================
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'fallback-secret-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 1 day
      // 'none' required for cross-domain (Vercel frontend + Render backend)
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// ============================================================
// RATE LIMITING
// ============================================================
app.use('/api/', globalLimiter);

// ============================================================
// LOGGING & PERFORMANCE
// ============================================================
app.use(addRequestMetadata);
app.use(performanceTiming);
app.use(httpLogger);

// ============================================================
// API ROUTES
// ============================================================
app.use('/api/auth', authRouter);
app.use('/api/products', productRouter);
app.use('/api/products/:productId/reviews', reviewRouter);
app.use('/api/orders', orderRouter);
app.use('/api/users', userRouter);
app.use('/api/cart', cartRouter);
app.use('/api/categories', categoryRouter);
app.use('/api/carriers', carrierRouter);
app.use('/api/admin', adminRouter);
app.use('/api/feedback', feedbackRouter);
app.use('/api/warehouse', warehouseRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    version: process.env.npm_package_version || '1.0.0',
  });
});

// API Info
app.get('/api', (req, res) => {
  res.json({
    name: 'CartLy eCommerce API',
    version: '1.0.0',
    docs: '/api/docs',
    health: '/health',
  });
});

// ============================================================
// ERROR HANDLING
// ============================================================
app.use(notFound);
app.use(errorHandler);

// ============================================================
// START SERVER
// ============================================================
const startServer = async () => {
  try {
    // Connect to PostgreSQL via Prisma (system of record)
    await connectPrisma();

    // Connect to Redis (optional — fails gracefully)
    await connectRedis();

    // Verify Cloudinary credentials
    try {
      await connectCloudinary();
      logger.info('🖼️  Cloudinary: Connected');
    } catch (err) {
      logger.warn(`⚠️  Cloudinary: ${err.message || err.error?.message || JSON.stringify(err)}`);
    }

    // Schedule the audit-log cleanup (replaces the Mongoose TTL index)
    startAuditCleanup();

    const PORT = parseInt(process.env.PORT);
    const server = app.listen(PORT, () => {
      logger.info(`🚀 Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
      logger.info(`🐘 PostgreSQL: Connected`);
      logger.info(`🌐 API: http://<Domain>:${PORT}/api`);
    });

    // Keep-alive ping — prevent Render free tier from sleeping (every 12 min)
    if (process.env.NODE_ENV === 'production') {
      const https = require('https');
      const PING_URL = `https://mcartly.onrender.com/health`;
      setInterval(() => {
        https.get(PING_URL, (res) => {
          if (res.statusCode !== 200) {
            logger.warn(`Keep-alive ping returned status: ${res.statusCode}`);
          } else {
            logger.info(`Keep-alive ping success: ${res.statusCode}`);
          }
        }).on('error', (err) => {
          logger.warn(`Keep-alive ping failed: ${err.message}`);
        });
      }, 12 * 60 * 1000); // 12 minutes
    }

    // Graceful shutdown
    const gracefulShutdown = (signal) => {
      logger.info(`${signal} received. Starting graceful shutdown...`);
      server.close(async () => {
        logger.info('HTTP server closed');
        process.exit(0);
      });

      // Force close after 10s
      setTimeout(() => {
        logger.error('Force closing server after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
      gracefulShutdown('unhandledRejection');
    });

    // Uncaught exceptions
    process.on('uncaughtException', (err) => {
      logger.error('Uncaught Exception:', err);
      gracefulShutdown('uncaughtException');
    });

    return server;
  } catch (error) {
    logger.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
};

startServer();

module.exports = app;
