// Thin PayMongo REST client (Sources + Payments) for GCash. Uses global fetch (Node 18+).
// Env: PAYMONGO_SECRET_KEY (sk_test_… / sk_live_…), PAYMONGO_WEBHOOK_SECRET.
// PayMongo amounts are in the smallest currency unit (centavos); currency is PHP.

const crypto = require('crypto');

const API_BASE = 'https://api.paymongo.com/v1';

const isConfigured = () => Boolean(process.env.PAYMONGO_SECRET_KEY);

// PayMongo uses HTTP Basic auth: secret key as the username, empty password.
const authHeader = () => `Basic ${Buffer.from(`${process.env.PAYMONGO_SECRET_KEY}:`).toString('base64')}`;

const pmFetch = async (path, { method = 'GET', body } = {}) => {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const detail = json?.errors?.[0]?.detail || text;
    const err = new Error(`PayMongo API ${res.status}: ${detail}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json.data;
};

// Centavos: PayMongo wants the smallest unit as an integer. round() avoids float drift.
const toCentavos = (amount) => Math.round(Number(amount) * 100);

// Create a GCash source the buyer is redirected to in order to authorise payment.
const createSource = async ({ amount, currency = 'PHP', successUrl, failedUrl }) => {
  const data = await pmFetch('/sources', {
    method: 'POST',
    body: {
      data: {
        attributes: {
          amount: toCentavos(amount),
          currency,
          type: 'gcash',
          redirect: { success: successUrl, failed: failedUrl },
        },
      },
    },
  });
  return { id: data.id, checkoutUrl: data.attributes?.redirect?.checkout_url || null, status: data.attributes?.status };
};

// Once a source is chargeable, create the actual payment from it.
const createPaymentFromSource = async ({ amount, currency = 'PHP', sourceId, description }) => {
  const data = await pmFetch('/payments', {
    method: 'POST',
    body: {
      data: {
        attributes: {
          amount: toCentavos(amount),
          currency,
          description: description || undefined,
          source: { id: sourceId, type: 'source' },
        },
      },
    },
  });
  return { id: data.id, status: data.attributes?.status };
};

// Refund a payment (full or partial) — Plan 2D.
const refundPayment = async (paymentId, amount, reason = 'requested_by_customer') => {
  const attributes = { payment_id: paymentId, reason };
  if (amount != null) attributes.amount = toCentavos(amount);
  const data = await pmFetch('/refunds', { method: 'POST', body: { data: { attributes } } });
  return { id: data.id, status: data.attributes?.status, raw: data };
};

// Verify a webhook signature. PayMongo sends `Paymongo-Signature: t=<ts>,te=<sig>,li=<sig>`
// where the signature is HMAC-SHA256 of `${t}.${rawBody}` keyed by the webhook secret.
// `te` is used in test mode, `li` in live mode — accept either.
const verifyWebhookSignature = ({ headers, rawBody }) => {
  const secret = process.env.PAYMONGO_WEBHOOK_SECRET;
  if (!secret) return false;
  const header = headers['paymongo-signature'] || headers['Paymongo-Signature'];
  if (!header) return false;

  const parts = Object.fromEntries(
    String(header)
      .split(',')
      .map((kv) => kv.split('=').map((s) => s.trim()))
  );
  const { t, te, li } = parts;
  if (!t || (!te && !li)) return false;

  const payload = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');

  const matches = (sig) => {
    if (!sig) return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  return matches(te) || matches(li);
};

module.exports = {
  isConfigured,
  createSource,
  createPaymentFromSource,
  refundPayment,
  verifyWebhookSignature,
};
