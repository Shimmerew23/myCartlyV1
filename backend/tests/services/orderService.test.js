const orderService = require('../../services/orderService');

describe('orderService.computeTotals', () => {
  it('charges $9.99 shipping + 10% tax under $100', () => {
    expect(orderService.computeTotals(40)).toEqual({ shippingCost: 9.99, taxAmount: 4, totalPrice: 53.99 });
  });
  it('gives free shipping over $100', () => {
    expect(orderService.computeTotals(200)).toEqual({ shippingCost: 0, taxAmount: 20, totalPrice: 220 });
  });
});

describe('orderService.serializeOrder', () => {
  const baseOrder = {
    id: 'o1',
    orderNumber: 'CUR-1-000001',
    userId: 'u1',
    items: [
      { id: 'oi1', productId: 'p1', sellerId: 's1', name: 'Tee', image: 'img', price: 20, quantity: 2, variantName: 'Size', variantValue: 'M' },
    ],
    shippingAddress: { name: 'A', street: 'St', city: 'C', state: 'S', country: 'US', zipCode: '1' },
    subtotal: 40, shippingCost: 9.99, taxAmount: 4, discountAmount: 0, totalPrice: 53.99, currency: 'USD',
    coupon: null,
    paymentMethod: 'cod', paymentStatus: 'pending', paymentResult: null, paidAt: null,
    status: 'pending', tracking: null, preferredCarrier: null,
    statusHistory: [{ id: 'e1', status: 'pending', timestamp: new Date('2026-01-01'), note: 'Order placed', updatedById: null, warehouseName: null }],
    cancelledAt: null, cancellationReason: null, returnReason: null, deliveredAt: null,
    customerNote: null, internalNote: null,
    createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
  };

  it('rebuilds the Mongo-shaped order with nested item variant + statusHistory', () => {
    const s = orderService.serializeOrder(baseOrder);
    expect(s._id).toBe('o1');
    expect(s.orderNumber).toBe('CUR-1-000001');
    expect(s.user).toBe('u1'); // unpopulated => userId string
    expect(s.items[0]).toMatchObject({ _id: 'oi1', product: 'p1', seller: 's1', name: 'Tee', price: 20, quantity: 2 });
    expect(s.items[0].variant).toEqual({ name: 'Size', value: 'M' });
    expect(s.coupon).toBeNull();
    expect(s.statusHistory[0]).toMatchObject({ status: 'pending', note: 'Order placed' });
    expect(s.totalPrice).toBe(53.99);
  });

  it('serializes a populated user as a ref and populates item.product from the map', () => {
    const order = { ...baseOrder, user: { id: 'u1', name: 'Joe', email: 'joe@t.com' } };
    const productMap = new Map([['p1', { _id: 'p1', name: 'Tee', slug: 'tee' }]]);
    const s = orderService.serializeOrder(order, { productMap });
    expect(s.user).toEqual({ _id: 'u1', id: 'u1', name: 'Joe', email: 'joe@t.com' });
    expect(s.items[0].product).toEqual({ _id: 'p1', name: 'Tee', slug: 'tee' });
  });
});
