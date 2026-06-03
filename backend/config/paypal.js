// Thin PayPal Orders v2 REST client (Standard Checkout). Uses global fetch (Node 18+).
// Env: PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_API_BASE, PAYPAL_WEBHOOK_ID.

const apiBase = () => process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com';
const isConfigured = () => Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET);

let cachedToken = null; // { value, expiresAt }

const getAccessToken = async () => {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5000) return cachedToken.value;
  const creds = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString('base64');
  const res = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in || 3000) * 1000 };
  return cachedToken.value;
};

const authedFetch = async (path, options = {}) => {
  const token = await getAccessToken();
  const res = await fetch(`${apiBase()}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(`PayPal API ${res.status}: ${data?.message || text}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
};

const createOrder = async ({ amount, currency = 'USD', referenceId, returnUrl, cancelUrl }) => {
  const body = {
    intent: 'CAPTURE',
    purchase_units: [{ reference_id: referenceId, amount: { currency_code: currency, value: Number(amount).toFixed(2) } }],
    application_context: { return_url: returnUrl, cancel_url: cancelUrl, shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' },
  };
  const data = await authedFetch('/v2/checkout/orders', { method: 'POST', body: JSON.stringify(body) });
  const approve = (data.links || []).find((l) => l.rel === 'approve' || l.rel === 'payer-action');
  return { id: data.id, status: data.status, approveUrl: approve?.href || null };
};

const captureOrder = async (paypalOrderId) => {
  const data = await authedFetch(`/v2/checkout/orders/${paypalOrderId}/capture`, { method: 'POST' });
  const capture = data?.purchase_units?.[0]?.payments?.captures?.[0];
  return { id: data.id, status: data.status, captureId: capture?.id || null, raw: data };
};

const refundCapture = async (captureId, amount, currency = 'USD') => {
  const body = amount != null ? JSON.stringify({ amount: { value: Number(amount).toFixed(2), currency_code: currency } }) : undefined;
  const data = await authedFetch(`/v2/payments/captures/${captureId}/refund`, { method: 'POST', body });
  return { id: data.id, status: data.status, raw: data };
};

const verifyWebhookSignature = async ({ headers, body }) => {
  if (!process.env.PAYPAL_WEBHOOK_ID) return false;
  const payload = {
    auth_algo: headers['paypal-auth-algo'],
    cert_url: headers['paypal-cert-url'],
    transmission_id: headers['paypal-transmission-id'],
    transmission_sig: headers['paypal-transmission-sig'],
    transmission_time: headers['paypal-transmission-time'],
    webhook_id: process.env.PAYPAL_WEBHOOK_ID,
    webhook_event: typeof body === 'string' ? JSON.parse(body) : body,
  };
  const data = await authedFetch('/v1/notifications/verify-webhook-signature', { method: 'POST', body: JSON.stringify(payload) });
  return data.verification_status === 'SUCCESS';
};

module.exports = {
  isConfigured,
  getAccessToken,
  createOrder,
  captureOrder,
  refundCapture,
  verifyWebhookSignature,
  _resetTokenCache: () => { cachedToken = null; },
};
