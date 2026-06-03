jest.mock('../../config/paypal');
const paypal = require('../../config/paypal');
const paymentService = require('../../services/paymentService');

beforeEach(() => {
  jest.clearAllMocks();
  paypal.isConfigured.mockReturnValue(false);
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

  it('rejects GCash until 2C', async () => {
    await expect(paymentService.createPayment({ order: {}, method: 'gcash' })).rejects.toMatchObject({ statusCode: 400 });
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

  it('rejects an unknown provider', async () => {
    await expect(paymentService.handleWebhook('venmo', {})).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('paymentService.refundPayment', () => {
  it('is not enabled until 2D', async () => {
    await expect(paymentService.refundPayment()).rejects.toMatchObject({ statusCode: 400 });
  });
});
