const { prisma } = require('../config/prisma');
const paypal = require('../config/paypal');
const paymongo = require('../config/paymongo');
const ApiError = require('../utils/ApiError');

// ============================================================
// Provider-agnostic payment seam
// ------------------------------------------------------------
// COD (2A), PayPal (2B), GCash via PayMongo (2C), refunds (2D).
// Keeps orderController thin; dispatches by payment method/provider.
// ============================================================

const SUPPORTED_METHODS = ['paypal', 'gcash', 'cod'];

// PayMongo (GCash) settles in PHP regardless of the catalog currency (USD).
// Full multi-currency is Phase 4 — see ADR 0004.
const GCASH_CURRENCY = 'PHP';

const paypalReturnUrls = (orderId) => ({
  returnUrl: `${process.env.FRONTEND_URL}/checkout/paypal/return?orderId=${orderId}`,
  cancelUrl: `${process.env.FRONTEND_URL}/checkout/paypal/cancel?orderId=${orderId}`,
});

const gcashRedirectUrls = (orderId) => ({
  successUrl: `${process.env.FRONTEND_URL}/checkout/gcash/return?orderId=${orderId}`,
  failedUrl: `${process.env.FRONTEND_URL}/checkout/gcash/cancel?orderId=${orderId}`,
});

// Initiate payment for a freshly created (pending) order.
// Returns: { provider, status, redirectUrl, approveUrl, providerRef }
const createPayment = async ({ order, method }) => {
  switch (method) {
    case 'cod':
      return { provider: 'cod', status: 'pending', redirectUrl: null, approveUrl: null, providerRef: null };

    case 'paypal': {
      if (!paypal.isConfigured()) throw ApiError.badRequest('PayPal is not configured');
      const { returnUrl, cancelUrl } = paypalReturnUrls(order.id);
      const pp = await paypal.createOrder({
        amount: order.totalPrice,
        currency: order.currency,
        referenceId: order.id,
        returnUrl,
        cancelUrl,
      });
      return { provider: 'paypal', status: 'created', redirectUrl: pp.approveUrl, approveUrl: pp.approveUrl, providerRef: pp.id };
    }

    case 'gcash': {
      if (!paymongo.isConfigured()) throw ApiError.badRequest('GCash is not configured');
      const { successUrl, failedUrl } = gcashRedirectUrls(order.id);
      const src = await paymongo.createSource({
        amount: order.totalPrice,
        currency: GCASH_CURRENCY,
        successUrl,
        failedUrl,
      });
      return { provider: 'gcash', status: 'pending', redirectUrl: src.checkoutUrl, approveUrl: src.checkoutUrl, providerRef: src.id };
    }

    default:
      throw ApiError.badRequest(`Unsupported payment method: ${method}`);
  }
};

// Capture/confirm an approved payment, then mark the order paid.
const capturePayment = async ({ order }) => {
  if (order.paymentMethod !== 'paypal') {
    throw ApiError.badRequest('This order does not support capture');
  }
  if (order.paymentStatus === 'paid') {
    return { status: 'paid', captureId: order.paymentResult?.captureId || null, alreadyPaid: true };
  }
  const ppOrderId = order.paymentResult?.id;
  if (!ppOrderId) throw ApiError.badRequest('No PayPal order reference on this order');

  const cap = await paypal.captureOrder(ppOrderId);
  if (cap.status !== 'COMPLETED') throw ApiError.badRequest(`PayPal capture not completed (status: ${cap.status})`);

  await markOrderPaid(order.id, { provider: 'paypal', captureId: cap.captureId });
  return { status: 'paid', captureId: cap.captureId };
};

// Transactional, idempotent transition to a paid/confirmed order.
const markOrderPaid = async (orderId, { provider, captureId } = {}, client = prisma) =>
  client.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw ApiError.notFound('Order not found');
    if (order.paymentStatus === 'paid') return order; // idempotent

    await tx.orderStatusEvent.create({ data: { orderId, status: 'confirmed', note: 'Payment received' } });
    return tx.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: 'paid',
        paidAt: new Date(),
        status: order.status === 'pending' ? 'confirmed' : order.status,
        paymentResult: { ...(order.paymentResult || {}), provider, captureId, status: 'completed' },
      },
    });
  });

// Refund a paid order (full or partial) — Plan 2D.
// Dispatches to the original provider, then transitions paymentStatus to
// refunded / partially_refunded and records the refund in paymentResult.
// Returns: { status, refundId, refundedAmount, paymentStatus }
const refundPayment = async ({ order, amount, reason, adminId } = {}) => {
  if (!order) throw ApiError.badRequest('Order is required');
  if (!['paid', 'partially_refunded'].includes(order.paymentStatus)) {
    throw ApiError.badRequest('Order is not refundable');
  }

  const prev = order.paymentResult || {};
  const provider = prev.provider || order.paymentMethod;
  const already = Number(prev.refundedAmount || 0);
  const remaining = Number(order.totalPrice) - already;

  // Default: refund the full remaining balance.
  const refundAmount = amount == null ? remaining : Number(amount);
  if (!(refundAmount > 0)) throw ApiError.badRequest('Refund amount must be greater than zero');
  if (refundAmount > remaining + 1e-9) {
    throw ApiError.badRequest(`Refund amount exceeds the remaining balance (${remaining.toFixed(2)})`);
  }

  // Provider call happens before the DB transaction (network must not sit inside a tx).
  let refundId = null;
  if (provider === 'paypal') {
    if (!paypal.isConfigured()) throw ApiError.badRequest('PayPal is not configured');
    if (!prev.captureId) throw ApiError.badRequest('No PayPal capture reference on this order');
    const r = await paypal.refundCapture(prev.captureId, refundAmount, order.currency || 'USD');
    refundId = r.id;
  } else if (provider === 'gcash') {
    if (!paymongo.isConfigured()) throw ApiError.badRequest('GCash is not configured');
    if (!prev.captureId) throw ApiError.badRequest('No PayMongo payment reference on this order');
    const r = await paymongo.refundPayment(prev.captureId, refundAmount, reason || 'requested_by_customer');
    refundId = r.id;
  } else if (provider !== 'cod') {
    throw ApiError.badRequest(`Refunds are not supported for provider: ${provider}`);
  }
  // COD: manual refund (cash returned out-of-band) — no provider call, refundId stays null.

  const newRefunded = Number((already + refundAmount).toFixed(2));
  const fully = newRefunded >= Number(order.totalPrice) - 1e-9;
  const paymentStatus = fully ? 'refunded' : 'partially_refunded';

  return prisma.$transaction(async (tx) => {
    await tx.orderStatusEvent.create({
      data: { orderId: order.id, status: paymentStatus, note: reason ?? undefined, updatedById: adminId ?? undefined },
    });
    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        paymentStatus,
        ...(fully ? { status: 'refunded' } : {}),
        paymentResult: {
          ...prev,
          status: paymentStatus,
          refundedAmount: newRefunded,
          refunds: [...(prev.refunds || []), { id: refundId, amount: refundAmount, reason: reason ?? null, at: new Date().toISOString() }],
        },
      },
    });
    return { status: paymentStatus, refundId, refundedAmount: newRefunded, paymentStatus, order: updated };
  });
};

// Provider webhook entry point.
const handleWebhook = async (provider, { headers, rawBody } = {}) => {
  if (provider === 'paypal') {
    const ok = await paypal.verifyWebhookSignature({ headers, body: rawBody });
    if (!ok) throw ApiError.badRequest('Invalid PayPal webhook signature');
    const event = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;

    if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      const ppOrderId = event.resource?.supplementary_data?.related_ids?.order_id;
      if (ppOrderId) {
        const order = await prisma.order.findFirst({ where: { paymentResult: { path: ['id'], equals: ppOrderId } } });
        if (order) await markOrderPaid(order.id, { provider: 'paypal', captureId: event.resource?.id });
      }
    }
    return { received: true };
  }

  if (provider === 'paymongo') {
    const ok = paymongo.verifyWebhookSignature({ headers, rawBody });
    if (!ok) throw ApiError.badRequest('Invalid PayMongo webhook signature');
    const event = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
    const type = event.data?.attributes?.type;
    const resource = event.data?.attributes?.data; // the source/payment object

    // source.chargeable → create the payment from the source, then mark the order paid.
    if (type === 'source.chargeable') {
      const sourceId = resource?.id;
      const order = sourceId && await findOrderByProviderRef(sourceId);
      if (order && order.paymentStatus !== 'paid') {
        const payment = await paymongo.createPaymentFromSource({
          amount: order.totalPrice,
          currency: GCASH_CURRENCY,
          sourceId,
          description: `Order ${order.orderNumber}`,
        });
        await markOrderPaid(order.id, { provider: 'gcash', captureId: payment.id });
      }
    } else if (type === 'payment.paid') {
      // Idempotent backstop — map the payment back to the order via its source id.
      const sourceId = resource?.attributes?.source?.id;
      const order = sourceId && await findOrderByProviderRef(sourceId);
      if (order) await markOrderPaid(order.id, { provider: 'gcash', captureId: resource?.id });
    }
    return { received: true };
  }

  throw ApiError.badRequest(`Webhook handler for "${provider}" is not yet enabled`);
};

// Look up an order by the provider reference stored in paymentResult.id (PayPal order id / PayMongo source id).
const findOrderByProviderRef = (ref) =>
  prisma.order.findFirst({ where: { paymentResult: { path: ['id'], equals: ref } } });

module.exports = {
  SUPPORTED_METHODS,
  createPayment,
  capturePayment,
  markOrderPaid,
  refundPayment,
  handleWebhook,
};
