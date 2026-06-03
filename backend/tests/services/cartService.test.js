const cartService = require('../../services/cartService');

// Pure-function unit tests — no DB. Verifies the cart payload matches the
// frozen Mongoose-shaped contract: { items, subtotal, itemCount, coupon }.

const makeProductRow = (over = {}) => ({
  id: 'p1',
  name: 'Tee',
  price: 20,
  slug: 'tee',
  status: 'active',
  stock: 7,
  trackInventory: true,
  discount: null,
  ratingAverage: 4.5,
  ratingCount: 3,
  ratingDistribution: { '1': 0, '2': 0, '3': 0, '4': 1, '5': 2 },
  images: [{ id: 'i1', url: 'u', publicId: 'pid', alt: null, isPrimary: true }],
  category: { id: 'c1', name: 'Apparel' },
  seller: { id: 's1', name: 'Shop', sellerProfile: { storeName: 'My Shop', storeLogo: 'logo' } },
  ...over,
});

describe('cartService.serializeProductSummary', () => {
  it('produces a Mongo-shaped summary with virtuals and populated refs', () => {
    const s = cartService.serializeProductSummary(makeProductRow());
    expect(s._id).toBe('p1');
    expect(s.id).toBe('p1');
    expect(s.name).toBe('Tee');
    expect(s.price).toBe(20);
    expect(s.discountedPrice).toBe(20);
    expect(s.rating).toEqual({ average: 4.5, count: 3, distribution: { '1': 0, '2': 0, '3': 0, '4': 1, '5': 2 } });
    expect(s.images[0]).toMatchObject({ _id: 'i1', url: 'u', isPrimary: true });
    expect(s.seller).toMatchObject({ _id: 's1', name: 'Shop', sellerProfile: { storeName: 'My Shop', storeLogo: 'logo' } });
    expect(s.category).toMatchObject({ _id: 'c1', name: 'Apparel' });
  });

  it('applies an active percentage discount to discountedPrice', () => {
    const s = cartService.serializeProductSummary(makeProductRow({ discount: { type: 'percentage', value: 25 } }));
    expect(s.discountedPrice).toBe(15);
  });
});

describe('cartService.serializeCartItem', () => {
  it('rebuilds the nested variant and embeds the product summary', () => {
    const item = { id: 'ci1', productId: 'p1', quantity: 2, variantName: 'Size', variantValue: 'M', price: 18, addedAt: new Date('2026-01-01') };
    const out = cartService.serializeCartItem(item, makeProductRow());
    expect(out._id).toBe('ci1');
    expect(out.quantity).toBe(2);
    expect(out.price).toBe(18);
    expect(out.variant).toEqual({ name: 'Size', value: 'M' });
    expect(out.product._id).toBe('p1');
  });

  it('falls back to the raw productId when the product is missing', () => {
    const item = { id: 'ci2', productId: 'gone', quantity: 1, price: 5, addedAt: new Date() };
    const out = cartService.serializeCartItem(item, null);
    expect(out.product).toBe('gone');
  });
});

describe('cartService subtotal / itemCount', () => {
  const items = [
    { price: 10, quantity: 2 },
    { price: 5, quantity: 3 },
  ];
  it('computeSubtotal sums price * quantity', () => {
    expect(cartService.computeSubtotal(items)).toBe(35);
  });
  it('computeItemCount sums quantities', () => {
    expect(cartService.computeItemCount(items)).toBe(5);
  });
});

describe('cartService.serializeCart', () => {
  const cart = {
    id: 'cart1',
    items: [
      { id: 'ci1', productId: 'p1', quantity: 2, variantName: null, variantValue: null, price: 20, addedAt: new Date('2026-01-01') },
    ],
    couponCode: 'SAVE10',
    couponType: 'percentage',
    couponValue: 10,
    couponValidUntil: new Date('2026-12-31'),
  };
  const productMap = new Map([['p1', makeProductRow()]]);

  it('returns { items, subtotal, itemCount, coupon } with the coupon rebuilt', () => {
    const out = cartService.serializeCart(cart, productMap);
    expect(out.subtotal).toBe(40);
    expect(out.itemCount).toBe(2);
    expect(out.items).toHaveLength(1);
    expect(out.items[0].product._id).toBe('p1');
    expect(out.coupon).toEqual({ code: 'SAVE10', discountType: 'percentage', discountValue: 10, validUntil: cart.couponValidUntil });
  });

  it('returns coupon null when the cart has no coupon code', () => {
    const out = cartService.serializeCart({ id: 'c', items: [], couponCode: null }, new Map());
    expect(out.coupon).toBeNull();
    expect(out.subtotal).toBe(0);
    expect(out.itemCount).toBe(0);
  });
});
