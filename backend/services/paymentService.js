const ApiError = require('../utils/ApiError');

// ============================================================
// Provider-agnostic payment seam
// ------------------------------------------------------------
// 2A implements the COD path only. PayPal (Plan 2B) and GCash/PayMongo
// (Plan 2C) fill in createPayment/capturePayment/handleWebhook; refunds
// land in Plan 2D. Keeping the dispatch here keeps orderController thin.
// ============================================================

const SUPPORTED_METHODS = ['paypal', 'gcash', 'cod'];

// Initiate payment for a freshly created order.
// Returns a normalized result the controller can return to the client:
//   { provider, status, redirectUrl, approveUrl, providerRef }
const createPayment = async ({ order, method }) => {
  switch (method) {
    case 'cod':
      // No external charge — order stays `pending` until delivery/confirmation.
      return { provider: 'cod', status: 'pending', redirectUrl: null, approveUrl: null, providerRef: null };
    case 'paypal':
      throw ApiError.badRequest('PayPal payments are not yet enabled');
    case 'gcash':
      throw ApiError.badRequest('GCash payments are not yet enabled');
    default:
      throw ApiError.badRequest(`Unsupported payment method: ${method}`);
  }
};

// Capture/confirm an authorized payment (PayPal capture, etc.) — 2B/2C.
const capturePayment = async () => {
  throw ApiError.badRequest('Payment capture is not yet enabled');
};

// Refund a paid order in full or part — Plan 2D.
const refundPayment = async () => {
  throw ApiError.badRequest('Refunds are not yet enabled');
};

// Provider webhook entry point — 2B (PayPal) / 2C (PayMongo).
const handleWebhook = async (provider) => {
  throw ApiError.badRequest(`Webhook handler for "${provider}" is not yet enabled`);
};

module.exports = {
  SUPPORTED_METHODS,
  createPayment,
  capturePayment,
  refundPayment,
  handleWebhook,
};
