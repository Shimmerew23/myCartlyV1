const Sentry = require('@sentry/node');
const logger = require('../utils/logger');

// Initialize Sentry only when a DSN is configured. No DSN -> complete no-op,
// matching the app's Cloudinary/Redis graceful-degradation pattern.
function initSentry() {
  if (!process.env.SENTRY_DSN) {
    logger.info('Sentry: disabled (no DSN)');
    return;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0, // lean: errors only, no performance tracing
    release: process.env.npm_package_version || '1.0.0',
  });

  logger.info('Sentry: enabled');
}

module.exports = { initSentry };
