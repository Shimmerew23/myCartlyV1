jest.mock('../../config/paypal');
jest.mock('../../config/paymongo');
const paypal = require('../../config/paypal');
const paymongo = require('../../config/paymongo');
const paymentService = require('../../services/paymentService');

beforeEach(() => {
  jest.clearAllMocks();
  paypal.isConfigured.mockReturnValue(false);
  paymongo.isConfigured.mockReturnValue(false);
});

describe('paymentService.createPayment', () => {
  it('returns a pending COD result with no redirect', async () => {
    const res = await paymentService.createPayment({ order: { id: 'o1', totalPrice: 50, currency: 'USD' }, method: 'cod' });
    expect(res).toEqual({ provider: 'cod', status: 'pending', redirectUrl: null, approveUrl: null, providerRef: null });
  });

  it('rejects PayPal when not configured', async () => {
    paypal.isConfigured.mockReturnValue(false);
    await expect(paymentService.createPayment({ order: { id: 'o1', totalPrice: 10, currency: 'USD' }, method: 'paypal' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('creates a PayPal order and returns the approve URL when configured', async () => {
    paypal.isConfigured.mockReturnValue(true);
    paypal.createOrder.mockResolvedValue({ id: 'PP-123', status: 'CREATED', approveUrl: 'https://paypal/approve/PP-123' });
    const res = await paymentService.createPayment({ order: { id: 'o1', totalPrice: 53.99, currency: 'USD' }, method: 'paypal' });
    expect(res).toMatchObject({ provider: 'paypal', status: 'created', approveUrl: 'https://paypal/approve/PP-123', providerRef: 'PP-123' });
    expect(paypal.createOrder).toHaveBeenCalledWith(expect.objectContaining({ amount: 53.99, currency: 'USD', referenceId: 'o1' }));
  });

  it('rejects GCash when PayMongo is not configured', async () => {
    paymongo.isConfigured.mockReturnValue(false);
    await expect(paymentService.createPayment({ order: { id: 'o1', totalPrice: 10 }, method: 'gcash' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('creates a GCash source and returns the checkout URL when configured', async () => {
    paymongo.isConfigured.mockReturnValue(true);
    paymongo.createSource.mockResolvedValue({ id: 'src_1', checkoutUrl: 'https://paymongo/checkout/src_1', status: 'pending' });
    const res = await paymentService.createPayment({ order: { id: 'o1', totalPrice: 53.99, currency: 'USD' }, method: 'gcash' });
    expect(res).toMatchObject({ provider: 'gcash', status: 'pending', approveUrl: 'https://paymongo/checkout/src_1', providerRef: 'src_1' });
    // PayMongo settles in PHP regardless of the catalog currency.
    expect(paymongo.createSource).toHaveBeenCalledWith(expect.objectContaining({ amount: 53.99, currency: 'PHP' }));
  });

  it('rejects an unsupported method', async () => {
    await expect(paymentService.createPayment({ order: {}, method: 'bitcoin' })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('paymentService.capturePayment guards', () => {
  it('rejects a non-PayPal order', async () => {
    await expect(paymentService.capturePayment({ order: { paymentMethod: 'cod' } })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('is idempotent for an already-paid order', async () => {
    const res = await paymentService.capturePayment({ order: { paymentMethod: 'paypal', paymentStatus: 'paid', paymentResult: { captureId: 'C1' } } });
    expect(res).toMatchObject({ status: 'paid', alreadyPaid: true, captureId: 'C1' });
    expect(paypal.captureOrder).not.toHaveBeenCalled();
  });

  it('rejects when there is no PayPal order reference', async () => {
    await expect(paymentService.capturePayment({ order: { paymentMethod: 'paypal', paymentStatus: 'pending', paymentResult: {} } }))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('paymentService.handleWebhook', () => {
  it('rejects a PayPal webhook with an invalid signature', async () => {
    paypal.verifyWebhookSignature.mockResolvedValue(false);
    await expect(paymentService.handleWebhook('paypal', { headers: {}, rawBody: '{}' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects a PayMongo webhook with an invalid signature', async () => {
    paymongo.verifyWebhookSignature.mockReturnValue(false);
    await expect(paymentService.handleWebhook('paymongo', { headers: {}, rawBody: '{}' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects an unknown provider', async () => {
    await expect(paymentService.handleWebhook('venmo', {})).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('paymentService.refundPayment guards', () => {
  const paidPaypal = (over = {}) => ({
    id: 'o1', totalPrice: 50, currency: 'USD', paymentMethod: 'paypal', paymentStatus: 'paid',
    paymentResult: { id: 'PP-1', provider: 'paypal', captureId: 'CAP-1' }, ...over,
  });

  it('rejects a refund on an order that is not paid', async () => {
    await expect(paymentService.refundPayment({ order: paidPaypal({ paymentStatus: 'pending' }) }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(paypal.refundCapture).not.toHaveBeenCalled();
  });

  it('rejects an amount greater than the remaining balance', async () => {
    await expect(paymentService.refundPayment({ order: paidPaypal(), amount: 60 }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(paypal.refundCapture).not.toHaveBeenCalled();
  });

  it('rejects a non-positive amount', async () => {
    await expect(paymentService.refundPayment({ order: paidPaypal(), amount: 0 }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects an online refund with no capture reference', async () => {
    paypal.isConfigured.mockReturnValue(true);
    await expect(paymentService.refundPayment({ order: paidPaypal({ paymentResult: { id: 'PP-1', provider: 'paypal' } }) }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects when the provider is not configured', async () => {
    paypal.isConfigured.mockReturnValue(false);
    await expect(paymentService.refundPayment({ order: paidPaypal() }))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});
