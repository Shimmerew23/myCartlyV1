const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Order = require('../models/Order');
const Carrier = require('../models/Carrier');
const Product = require('../models/Product');
const { Cart } = require('../models/index');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { sendEmail, emailTemplates } = require('../utils/email');
const logger = require('../utils/logger');

// @desc    Create order + Stripe PaymentIntent
// @route   POST /api/orders
// @access  Private
const createOrder = async (req, res, next) => {
  try {
    const { shippingAddress, paymentMethod, couponCode, customerNote, preferredCarrier, selectedItemIds } = req.body;

    // Get user's cart
    const cart = await Cart.findOne({ user: req.user._id }).populate('items.product');
    if (!cart || cart.items.length === 0) {
      return next(ApiError.badRequest('Cart is empty'));
    }

    // Filter to selected items if provided
    const cartItemsToProcess = selectedItemIds && selectedItemIds.length > 0
      ? cart.items.filter((item) => selectedItemIds.includes(item._id.toString()))
      : cart.items;

    if (cartItemsToProcess.length === 0) {
      return next(ApiError.badRequest('No valid items selected'));
    }

    // Validate stock & build order items
    const orderItems = [];
    let subtotal = 0;

    for (const item of cartItemsToProcess) {
      const product = await Product.findById(item.product._id);
      if (!product) return next(ApiError.notFound(`Product not found: ${item.product.name}`));
      if (product.status !== 'active') {
        return next(ApiError.badRequest(`Product unavailable: ${product.name}`));
      }
      if (product.trackInventory && product.stock < item.quantity) {
        return next(ApiError.badRequest(`Insufficient stock for: ${product.name} (available: ${product.stock})`));
      }

      const price = product.discountedPrice || product.price;
      subtotal += price * item.quantity;

      orderItems.push({
        product: product._id,
        seller: product.seller,
        name: product.name,
        image: product.images[0]?.url,
        price,
        quantity: item.quantity,
        variant: item.variant,
      });
    }

    // Tax calculation (10% example — customize by region)
    const taxRate = 0.1;
    const shippingCost = subtotal > 100 ? 0 : 9.99;
    const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
    const totalPrice = Math.round((subtotal + shippingCost + taxAmount) * 100) / 100;

    // Create order
    const order = await Order.create({
      user: req.user._id,
      items: orderItems,
      shippingAddress,
      subtotal,
      shippingCost,
      taxAmount,
      totalPrice,
      paymentMethod,
      customerNote,
      preferredCarrier: preferredCarrier || undefined,
      statusHistory: [{ status: 'pending', note: 'Order placed' }],
    });

    // Stripe Payment Intent
    let clientSecret = null;
    if (paymentMethod === 'stripe' && process.env.STRIPE_SECRET_KEY) {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(totalPrice * 100), // Stripe uses cents
        currency: 'usd',
        metadata: {
          orderId: order._id.toString(),
          userId: req.user._id.toString(),
        },
        automatic_payment_methods: { enabled: true },
      });
      clientSecret = paymentIntent.client_secret;
      order.paymentResult = { id: paymentIntent.id };
      await order.save();
    }

    // Decrease stock
    for (const item of orderItems) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { stock: -item.quantity },
      });
    }

    // Clear only the processed items from cart (or all if no selection)
    if (selectedItemIds && selectedItemIds.length > 0) {
      await Cart.findOneAndUpdate(
        { user: req.user._id },
        { $pull: { items: { _id: { $in: selectedItemIds } } } }
      );
    } else {
      await Cart.findOneAndUpdate({ user: req.user._id }, { items: [] });
    }

    // Send confirmation email
    try {
      const { subject, html } = emailTemplates.orderConfirmation(order, req.user);
      await sendEmail({ to: req.user.email, subject, html });
    } catch (e) {
      logger.error(`Order confirmation email failed: ${e.message}`);
    }

    logger.info(`Order created: ${order.orderNumber} by ${req.user.email}`);
    return ApiResponse.created(res, { order, clientSecret }, 'Order created successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Get user's orders
// @route   GET /api/orders/my-orders
// @access  Private
const getMyOrders = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 10);
    const skip = (page - 1) * limit;

    const filter = { user: req.user._id };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.paymentStatus) filter.paymentStatus = req.query.paymentStatus;

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort('-createdAt')
        .skip(skip)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter),
    ]);

    return ApiResponse.paginated(res, orders, {
      page, limit, total,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Get single order
// @route   GET /api/orders/:id
// @access  Private (own order or admin)
const getOrder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'name email')
      .populate('items.product', 'name slug images')
      .lean();

    if (!order) return next(ApiError.notFound('Order not found'));

    const isOwner = order.user._id.toString() === req.user._id.toString();
    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
    if (!isOwner && !isAdmin) return next(ApiError.forbidden());

    return ApiResponse.success(res, order);
  } catch (err) {
    next(err);
  }
};

// @desc    Update order status (admin/seller)
// @route   PUT /api/orders/:id/status
// @access  Admin/Seller
const updateOrderStatus = async (req, res, next) => {
  try {
    const { status, note, trackingNumber, carrierId, trackingUrl, lastLocation } = req.body;

    const order = await Order.findById(req.params.id);
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

    order.status = status;
    order.statusHistory.push({ status, note, updatedBy: req.user._id });

    if (status === 'shipped' && trackingNumber) {
      let resolvedCarrierName = null;
      let resolvedTrackingUrl = trackingUrl || null;

      if (carrierId) {
        const carrier = await Carrier.findById(carrierId);
        if (carrier) {
          resolvedCarrierName = carrier.name;
          if (carrier.trackingUrlTemplate) {
            resolvedTrackingUrl = carrier.trackingUrlTemplate.replace('{trackingNumber}', trackingNumber);
          }
        }
      }

      order.tracking = {
        carrier: resolvedCarrierName,
        carrierId: carrierId || undefined,
        trackingNumber,
        trackingUrl: resolvedTrackingUrl,
      };
    }

    if (lastLocation && (status === 'shipped' || status === 'out_for_delivery')) {
      if (!order.tracking) order.tracking = {};
      order.tracking.lastLocation = lastLocation;
      order.tracking.lastLocationUpdatedAt = new Date();
    }
    if (status === 'delivered') order.deliveredAt = Date.now();
    if (status === 'cancelled') {
      order.cancelledAt = Date.now();
      order.cancellationReason = note;
      // Restore stock
      for (const item of order.items) {
        await Product.findByIdAndUpdate(item.product, {
          $inc: { stock: item.quantity },
        });
      }
    }

    await order.save();
    return ApiResponse.success(res, order, `Order status updated to ${status}`);
  } catch (err) {
    next(err);
  }
};

// @desc    Stripe webhook handler
// @route   POST /api/orders/webhook
// @access  Public (Stripe)
const stripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    logger.error(`Stripe webhook error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    await Order.findOneAndUpdate(
      { 'paymentResult.id': pi.id },
      {
        paymentStatus: 'paid',
        paidAt: new Date(),
        'paymentResult.status': 'succeeded',
        'paymentResult.receiptUrl': pi.charges?.data[0]?.receipt_url,
        $push: { statusHistory: { status: 'confirmed', note: 'Payment received' } },
        status: 'confirmed',
      }
    );
  }

  if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object;
    await Order.findOneAndUpdate(
      { 'paymentResult.id': pi.id },
      { paymentStatus: 'failed' }
    );
  }

  res.json({ received: true });
};

// @desc    Request return/refund
// @route   POST /api/orders/:id/return
// @access  Private
const requestReturn = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order) return next(ApiError.notFound('Order not found'));
    if (order.user.toString() !== req.user._id.toString()) {
      return next(ApiError.forbidden());
    }
    if (order.status !== 'delivered') {
      return next(ApiError.badRequest('Only delivered orders can be returned'));
    }

    const deliveredDate = new Date(order.deliveredAt);
    const daysSinceDelivery = (Date.now() - deliveredDate) / (1000 * 60 * 60 * 24);
    if (daysSinceDelivery > 30) {
      return next(ApiError.badRequest('Return window (30 days) has passed'));
    }

    order.status = 'return_requested';
    order.returnReason = reason;
    order.statusHistory.push({ status: 'return_requested', note: reason });
    await order.save();

    return ApiResponse.success(res, order, 'Return request submitted');
  } catch (err) {
    next(err);
  }
};

// @desc    Get seller orders
// @route   GET /api/orders/seller-orders
// @access  Seller
const getSellerOrders = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 10);
    const skip = (page - 1) * limit;

    const filter = { 'items.seller': req.user._id };
    if (req.query.status) filter.status = req.query.status;

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort('-createdAt')
        .skip(skip)
        .limit(limit)
        .populate('user', 'name email')
        .lean(),
      Order.countDocuments(filter),
    ]);

    return ApiResponse.paginated(res, orders, {
      page, limit, total, pages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createOrder,
  getMyOrders,
  getOrder,
  updateOrderStatus,
  stripeWebhook,
  requestReturn,
  getSellerOrders,
};
