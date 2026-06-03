const { prisma } = require('../config/prisma');
const orderService = require('../services/orderService');
const productService = require('../services/productService');
const paymentService = require('../services/paymentService');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { sendEmail, emailTemplates } = require('../utils/email');
const logger = require('../utils/logger');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// @desc    Create order (+ Stripe PaymentIntent) — atomic stock/cart mutation
// @route   POST /api/orders
// @access  Private
const createOrder = async (req, res, next) => {
  const { shippingAddress, paymentMethod, customerNote, preferredCarrier, selectedItemIds } = req.body;

  const cart = await prisma.cart.findUnique({ where: { userId: req.user._id }, include: { items: true } });
  if (!cart || cart.items.length === 0) return next(ApiError.badRequest('Cart is empty'));

  const itemsToProcess = selectedItemIds && selectedItemIds.length > 0
    ? cart.items.filter((i) => selectedItemIds.includes(i.id))
    : cart.items;
  if (itemsToProcess.length === 0) return next(ApiError.badRequest('No valid items selected'));

  const products = await prisma.product.findMany({
    where: { id: { in: itemsToProcess.map((i) => i.productId) } },
    include: { images: true },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  const orderItems = [];
  let subtotal = 0;

  for (const item of itemsToProcess) {
    const product = productById.get(item.productId);
    if (!product) return next(ApiError.notFound(`Product not found: ${item.productId}`));
    if (product.status !== 'active') return next(ApiError.badRequest(`Product unavailable: ${product.name}`));
    if (product.trackInventory && product.stock < item.quantity) {
      return next(ApiError.badRequest(`Insufficient stock for: ${product.name} (available: ${product.stock})`));
    }

    const price = productService.computeDiscountedPrice(product.price, product.discount) || product.price;
    subtotal += price * item.quantity;

    const primaryImg = (product.images || []).find((im) => im.isPrimary) || (product.images || [])[0];
    orderItems.push({
      productId: product.id,
      sellerId: product.sellerId,
      name: product.name,
      image: primaryImg?.url,
      price,
      quantity: item.quantity,
      variantName: item.variantName,
      variantValue: item.variantValue,
    });
  }

  const { shippingCost, taxAmount, totalPrice } = orderService.computeTotals(subtotal);

  // Atomic: create order + items + initial status event, decrement stock, clear processed cart items.
  const order = await prisma.$transaction(async (tx) => {
    const orderNumber = await orderService.generateOrderNumber(tx);
    const created = await tx.order.create({
      data: {
        orderNumber,
        userId: req.user._id,
        shippingAddress,
        subtotal,
        shippingCost,
        taxAmount,
        totalPrice,
        paymentMethod,
        customerNote: customerNote ?? undefined,
        preferredCarrier: preferredCarrier || undefined,
        items: { create: orderItems },
        statusHistory: { create: [{ status: 'pending', note: 'Order placed' }] },
      },
      include: orderService.ORDER_INCLUDE,
    });

    for (const item of itemsToProcess) {
      // eslint-disable-next-line no-await-in-loop
      await tx.product.update({ where: { id: item.productId }, data: { stock: { decrement: item.quantity } } });
    }

    await tx.cartItem.deleteMany({ where: { id: { in: itemsToProcess.map((i) => i.id) } } });
    return created;
  });

  // Initiate payment via the provider seam (after commit — network calls must not
  // sit inside a DB transaction). COD returns pending; PayPal/GCash (2B/2C) will
  // return an approve/redirect URL. The order already exists as `pending`.
  const payment = await paymentService.createPayment({ order, method: paymentMethod });
  if (payment.providerRef) {
    order.paymentResult = { id: payment.providerRef, provider: payment.provider };
    await prisma.order.update({ where: { id: order.id }, data: { paymentResult: order.paymentResult } });
  }

  try {
    const { subject, html } = emailTemplates.orderConfirmation(orderService.serializeOrder(order), req.user);
    await sendEmail({ to: req.user.email, subject, html });
  } catch (e) {
    logger.error(`Order confirmation email failed: ${e.message}`);
  }

  logger.info(`Order created: ${order.orderNumber} by ${req.user.email}`);
  return ApiResponse.created(res, { order: orderService.serializeOrder(order), payment }, 'Order created successfully');
};

// @desc    Get user's orders
// @route   GET /api/orders/my-orders
// @access  Private
const getMyOrders = async (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, parseInt(req.query.limit, 10) || 10);
  const skip = (page - 1) * limit;

  const where = { userId: req.user._id };
  if (req.query.status) where.status = req.query.status;
  if (req.query.paymentStatus) where.paymentStatus = req.query.paymentStatus;

  const [orders, total] = await Promise.all([
    prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit, include: orderService.ORDER_INCLUDE }),
    prisma.order.count({ where }),
  ]);

  return ApiResponse.paginated(res, orders.map((o) => orderService.serializeOrder(o)), {
    page, limit, total, pages: Math.ceil(total / limit),
  });
};

// @desc    Get single order
// @route   GET /api/orders/:id
// @access  Private (own order or admin)
const getOrder = async (req, res, next) => {
  if (!UUID_RE.test(req.params.id)) return next(ApiError.notFound('Order not found'));

  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: { ...orderService.ORDER_INCLUDE, user: true },
  });
  if (!order) return next(ApiError.notFound('Order not found'));

  const isOwner = order.userId === req.user._id;
  const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
  if (!isOwner && !isAdmin) return next(ApiError.forbidden());

  const productMap = await orderService.getItemProductMap(order.items.map((i) => i.productId));
  return ApiResponse.success(res, orderService.serializeOrder(order, { productMap }));
};

// @desc    Update order status (admin/seller)
// @route   PUT /api/orders/:id/status
// @access  Admin/Seller
const updateOrderStatus = async (req, res, next) => {
  if (!UUID_RE.test(req.params.id)) return next(ApiError.notFound('Order not found'));
  const { status, note, trackingNumber, carrierId, trackingUrl, lastLocation } = req.body;

  const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { items: true } });
  if (!order) return next(ApiError.notFound('Order not found'));

  const validTransitions = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['processing', 'cancelled'],
    processing: ['shipped', 'cancelled'],
    shipped: ['out_for_delivery', 'delivered'],
    out_for_delivery: ['delivered'],
    delivered: ['return_requested'],
    return_requested: ['returned', 'delivered'],
    returned: ['refunded'],
  };
  if (!validTransitions[order.status]?.includes(status)) {
    return next(ApiError.badRequest(`Invalid status transition: ${order.status} → ${status}`));
  }

  const data = { status };
  let newTracking;

  if (status === 'shipped' && trackingNumber) {
    let resolvedCarrierName = null;
    let resolvedTrackingUrl = trackingUrl || null;
    if (carrierId) {
      const carrier = await prisma.carrier.findUnique({ where: { id: carrierId } }).catch(() => null);
      if (carrier) {
        resolvedCarrierName = carrier.name;
        if (carrier.trackingUrlTemplate) {
          resolvedTrackingUrl = carrier.trackingUrlTemplate.replace('{trackingNumber}', trackingNumber);
        }
      }
    }
    newTracking = { carrier: resolvedCarrierName, carrierId: carrierId || undefined, trackingNumber, trackingUrl: resolvedTrackingUrl };
  }

  if (lastLocation && (status === 'shipped' || status === 'out_for_delivery')) {
    newTracking = { ...(newTracking || order.tracking || {}), lastLocation, lastLocationUpdatedAt: new Date() };
  }

  if (newTracking !== undefined) data.tracking = newTracking;
  if (status === 'delivered') data.deliveredAt = new Date();
  if (status === 'cancelled') {
    data.cancelledAt = new Date();
    data.cancellationReason = note ?? undefined;
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (status === 'cancelled') {
      for (const item of order.items) {
        // eslint-disable-next-line no-await-in-loop
        await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
      }
    }
    await tx.orderStatusEvent.create({ data: { orderId: order.id, status, note: note ?? undefined, updatedById: req.user._id } });
    return tx.order.update({ where: { id: order.id }, data, include: orderService.ORDER_INCLUDE });
  });

  return ApiResponse.success(res, orderService.serializeOrder(updated), `Order status updated to ${status}`);
};

// @desc    Request return/refund
// @route   POST /api/orders/:id/return
// @access  Private
const requestReturn = async (req, res, next) => {
  if (!UUID_RE.test(req.params.id)) return next(ApiError.notFound('Order not found'));
  const { reason } = req.body;

  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) return next(ApiError.notFound('Order not found'));
  if (order.userId !== req.user._id) return next(ApiError.forbidden());
  if (order.status !== 'delivered') return next(ApiError.badRequest('Only delivered orders can be returned'));

  const daysSinceDelivery = (Date.now() - new Date(order.deliveredAt)) / (1000 * 60 * 60 * 24);
  if (daysSinceDelivery > 30) return next(ApiError.badRequest('Return window (30 days) has passed'));

  const updated = await prisma.$transaction(async (tx) => {
    await tx.orderStatusEvent.create({ data: { orderId: order.id, status: 'return_requested', note: reason } });
    return tx.order.update({
      where: { id: order.id },
      data: { status: 'return_requested', returnReason: reason },
      include: orderService.ORDER_INCLUDE,
    });
  });

  return ApiResponse.success(res, orderService.serializeOrder(updated), 'Return request submitted');
};

// @desc    Get seller orders
// @route   GET /api/orders/seller-orders
// @access  Seller
const getSellerOrders = async (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, parseInt(req.query.limit, 10) || 10);
  const skip = (page - 1) * limit;

  const where = { items: { some: { sellerId: req.user._id } } };
  if (req.query.status) where.status = req.query.status;

  const [orders, total] = await Promise.all([
    prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit, include: { ...orderService.ORDER_INCLUDE, user: true } }),
    prisma.order.count({ where }),
  ]);

  return ApiResponse.paginated(res, orders.map((o) => orderService.serializeOrder(o)), {
    page, limit, total, pages: Math.ceil(total / limit),
  });
};

module.exports = {
  createOrder,
  getMyOrders,
  getOrder,
  updateOrderStatus,
  requestReturn,
  getSellerOrders,
};
