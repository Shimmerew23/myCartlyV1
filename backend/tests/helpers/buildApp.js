require('express-async-errors');
const express = require('express');
const cookieParser = require('cookie-parser');
const {
  authRouter, userRouter, productRouter, categoryRouter, cartRouter, orderRouter, adminRouter,
} = require('../../routes/index');
const { errorHandler, notFound, addRequestMetadata } = require('../../middleware/index');

// Minimal app for Supertest — mounts the routers under test (Phase 1B–1D).
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
  app.use('/api/cart', cartRouter);
  app.use('/api/orders', orderRouter);
  app.use('/api/admin', adminRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { buildApp };
