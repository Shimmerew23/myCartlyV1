const paymentService = require('../../services/paymentService');

describe('paymentService.createPayment', () => {
  it('returns a pending COD result with no redirect', async () => {
    const res = await paymentService.createPayment({ order: { id: 'o1', totalPrice: 50, currency: 'USD' }, method: 'cod' });
    expect(res).toEqual({ provider: 'cod', status: 'pending', redirectUrl: null, approveUrl: null, providerRef: null });
  });

  it('rejects PayPal until 2B enables it', async () => {
    await expect(paymentService.createPayment({ order: {}, method: 'paypal' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects GCash until 2C enables it', async () => {
    await expect(paymentService.createPayment({ order: {}, method: 'gcash' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects an unsupported method', async () => {
    await expect(paymentService.createPayment({ order: {}, method: 'bitcoin' })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('paymentService unimplemented seams', () => {
  it('capturePayment / refundPayment / handleWebhook throw until later sub-plans', async () => {
    await expect(paymentService.capturePayment()).rejects.toMatchObject({ statusCode: 400 });
    await expect(paymentService.refundPayment()).rejects.toMatchObject({ statusCode: 400 });
    await expect(paymentService.handleWebhook('paypal')).rejects.toMatchObject({ statusCode: 400 });
  });
});
