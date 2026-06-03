const { prisma } = require('../config/prisma');
const paypal = require('../config/paypal');
const ApiError = require('../utils/ApiError');

// ============================================================
// Provider-agnostic payment seam
// ------------------------------------------------------------
// COD (2A), PayPal (2B). GCash/PayMongo (2C) and refunds (2D) to follow.
// Keeps orderController thin; dispatches by payment method/provider.
// ============================================================

const SUPPORTED_METHODS = ['paypal', 'gcash', 'cod'];

const paypalReturnUrls = (orderId) => ({
  returnUrl: `${process.env.FRONTEND_URL}/checkout/paypal/return?orderId=${orderId}`,
  cancelUrl: `${process.env.FRONTEND_URL}/checkout/paypal/cancel?orderId=${orderId}`,
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

    case 'gcash':
      throw ApiError.badRequest('GCash payments are not yet enabled');

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

// Refund a paid order — Plan 2D.
const refundPayment = async () => {
  throw ApiError.badRequest('Refunds are not yet enabled');
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
  throw ApiError.badRequest(`Webhook handler for "${provider}" is not yet enabled`);
};

module.exports = {
  SUPPORTED_METHODS,
  createPayment,
  capturePayment,
  markOrderPaid,
  refundPayment,
  handleWebhook,
};
