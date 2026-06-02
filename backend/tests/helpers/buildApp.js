require('express-async-errors');
const express = require('express');
const cookieParser = require('cookie-parser');
const { authRouter, userRouter, productRouter, categoryRouter } = require('../../routes/index');
const { errorHandler, notFound, addRequestMetadata } = require('../../middleware/index');

// Minimal app for Supertest — mounts the routers under test (Phase 1B + 1C).
function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(cookieParser());
  app.use(addRequestMetadata);
  app.use('/api/auth', authRouter);
  app.use('/api/users', userRouter);
  app.use('/api/products', productRouter);
  app.use('/api/categories', categoryRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { buildApp };
