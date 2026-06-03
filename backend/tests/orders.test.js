jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
  emailTemplates: {
    verification: () => ({ subject: 's', html: 'h' }),
    orderConfirmation: () => ({ subject: 's', html: 'h' }),
  },
}));

const request = require('supertest');
const { buildApp } = require('./helpers/buildApp');
const { prisma } = require('../config/prisma');
const { generateTokenPair } = require('../utils/jwt');

const app = buildApp();
const uniq = () => `${Date.now()}${Math.random()}`;

const ADDRESS = { name: 'Buyer', street: '1 St', city: 'Town', state: 'ST', country: 'US', zipCode: '00001' };

async function setup(productOver = {}) {
  const buyer = await prisma.user.create({ data: { name: 'Buyer', email: `b${uniq()}@t.com`, role: 'user' } });
  const seller = await prisma.user.create({ data: { name: 'Seller', email: `s${uniq()}@t.com`, role: 'seller', sellerProfile: { create: { storeName: 'Shop', isApproved: true } } } });
  const cat = await prisma.category.create({ data: { name: 'C', slug: `c-${uniq()}` } });
  const product = await prisma.product.create({
    data: {
      name: 'Tee', slug: `tee-${uniq()}`, description: 'd', price: 20, status: 'active',
      stock: 5, trackInventory: true, categoryId: cat.id, sellerId: seller.id,
      images: { create: [{ url: 'primary.jpg', isPrimary: true }] },
      ...productOver,
    },
  });
  return {
    buyer, seller, cat, product,
    buyerToken: generateTokenPair(buyer.id, 'user').accessToken,
    sellerToken: generateTokenPair(seller.id, 'seller').accessToken,
  };
}

async function addToCart(token, productId, quantity) {
  return request(app).post('/api/cart/add').set('Authorization', `Bearer ${token}`).send({ productId, quantity });
}

async function placeOrder(token, body = {}) {
  return request(app).post('/api/orders').set('Authorization', `Bearer ${token}`)
    .send({ shippingAddress: ADDRESS, paymentMethod: 'cod', ...body });
}

afterEach(async () => {
  await prisma.orderStatusEvent.deleteMany({});
  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.cartItem.deleteMany({});
  await prisma.cart.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.user.deleteMany({});
});

describe('POST /api/orders (createOrder)', () => {
  it('creates an order, decrements stock, and clears the processed cart items', async () => {
    const { buyer, product, buyerToken } = await setup();
    await addToCart(buyerToken, product.id, 2);

    const res = await placeOrder(buyerToken);
    expect(res.status).toBe(201);
    expect(res.body.data.clientSecret).toBeNull();
    const order = res.body.data.order;
    expect(order._id).toBeDefined();
    expect(order.orderNumber).toMatch(/^CUR-\d+-\d{6}$/);
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({ name: 'Tee', price: 20, quantity: 2, image: 'primary.jpg', seller: expect.any(String) });
    expect(order.items[0].seller).toBe(product.sellerId);
    expect(order.subtotal).toBe(40);
    expect(order.shippingCost).toBe(9.99);
    expect(order.taxAmount).toBe(4);
    expect(order.totalPrice).toBe(53.99);
    expect(order.statusHistory[0]).toMatchObject({ status: 'pending', note: 'Order placed' });

    const dbProduct = await prisma.product.findUnique({ where: { id: product.id } });
    expect(dbProduct.stock).toBe(3);
    const cart = await prisma.cart.findUnique({ where: { userId: buyer.id }, include: { items: true } });
    expect(cart.items).toHaveLength(0);
  });

  it('400s when the cart is empty', async () => {
    const { buyerToken } = await setup();
    const res = await placeOrder(buyerToken);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/empty/i);
  });

  it('400s and writes nothing when stock is insufficient (atomic)', async () => {
    const { product, buyerToken } = await setup();
    await addToCart(buyerToken, product.id, 2);
    await prisma.product.update({ where: { id: product.id }, data: { stock: 1 } });

    const res = await placeOrder(buyerToken);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/insufficient stock/i);
    expect(await prisma.order.count()).toBe(0);
    const dbProduct = await prisma.product.findUnique({ where: { id: product.id } });
    expect(dbProduct.stock).toBe(1); // unchanged
  });

  it('only clears selected items when selectedItemIds is provided', async () => {
    const { buyer, product, buyerToken } = await setup();
    const other = await prisma.product.create({ data: { name: 'Hat', slug: `hat-${uniq()}`, description: 'd', price: 10, status: 'active', stock: 5, categoryId: product.categoryId, sellerId: product.sellerId } });
    const add1 = await addToCart(buyerToken, product.id, 1);
    await addToCart(buyerToken, other.id, 1);
    const itemId = add1.body.data.items[0]._id;

    const res = await placeOrder(buyerToken, { selectedItemIds: [itemId] });
    expect(res.status).toBe(201);
    expect(res.body.data.order.items).toHaveLength(1);
    const cart = await prisma.cart.findUnique({ where: { userId: buyer.id }, include: { items: true } });
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].productId).toBe(other.id);
  });
});

describe('order reads', () => {
  it('GET /api/orders/my-orders returns the buyer orders paginated', async () => {
    const { product, buyerToken } = await setup();
    await addToCart(buyerToken, product.id, 1);
    await placeOrder(buyerToken);

    const res = await request(app).get('/api/orders/my-orders').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination.total).toBe(1);
  });

  it('GET /api/orders/:id returns the order to its owner with a populated product', async () => {
    const { product, buyerToken } = await setup();
    await addToCart(buyerToken, product.id, 1);
    const created = await placeOrder(buyerToken);
    const id = created.body.data.order._id;

    const res = await request(app).get(`/api/orders/${id}`).set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items[0].product).toMatchObject({ _id: product.id, name: 'Tee', slug: product.slug });
  });

  it('GET /api/orders/:id forbids a different non-admin user', async () => {
    const { product, buyerToken } = await setup();
    await addToCart(buyerToken, product.id, 1);
    const created = await placeOrder(buyerToken);
    const id = created.body.data.order._id;
    const stranger = await prisma.user.create({ data: { name: 'X', email: `x${uniq()}@t.com`, role: 'user' } });
    const strangerToken = generateTokenPair(stranger.id, 'user').accessToken;

    const res = await request(app).get(`/api/orders/${id}`).set('Authorization', `Bearer ${strangerToken}`);
    expect(res.status).toBe(403);
  });

  it('GET /api/orders/:id 404s an unknown id', async () => {
    const { buyerToken } = await setup();
    const res = await request(app).get('/api/orders/not-a-real-id').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(404);
  });

  it('GET /api/orders/seller-orders returns orders containing the seller items', async () => {
    const { product, buyerToken, sellerToken } = await setup();
    await addToCart(buyerToken, product.id, 1);
    await placeOrder(buyerToken);

    const res = await request(app).get('/api/orders/seller-orders').set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].user).toMatchObject({ name: 'Buyer' });
  });
});

describe('PUT /api/orders/:id/status', () => {
  async function makeOrder() {
    const s = await setup();
    await addToCart(s.buyerToken, s.product.id, 2);
    const created = await placeOrder(s.buyerToken);
    return { ...s, orderId: created.body.data.order._id };
  }

  it('advances a valid transition (pending -> confirmed) and appends history', async () => {
    const { orderId, sellerToken } = await makeOrder();
    const res = await request(app).put(`/api/orders/${orderId}/status`).set('Authorization', `Bearer ${sellerToken}`).send({ status: 'confirmed', note: 'ok' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('confirmed');
    expect(res.body.data.statusHistory.map((e) => e.status)).toEqual(['pending', 'confirmed']);
  });

  it('rejects an invalid transition', async () => {
    const { orderId, sellerToken } = await makeOrder();
    const res = await request(app).put(`/api/orders/${orderId}/status`).set('Authorization', `Bearer ${sellerToken}`).send({ status: 'delivered' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid status transition/i);
  });

  it('restores stock when an order is cancelled', async () => {
    const { orderId, product, sellerToken } = await makeOrder();
    const before = await prisma.product.findUnique({ where: { id: product.id } });
    expect(before.stock).toBe(3); // 5 - 2

    const res = await request(app).put(`/api/orders/${orderId}/status`).set('Authorization', `Bearer ${sellerToken}`).send({ status: 'cancelled', note: 'changed mind' });
    expect(res.status).toBe(200);
    expect(res.body.data.cancellationReason).toBe('changed mind');
    const after = await prisma.product.findUnique({ where: { id: product.id } });
    expect(after.stock).toBe(5);
  });
});

describe('POST /api/orders/:id/return', () => {
  it('accepts a return on a delivered order within the window', async () => {
    const s = await setup();
    await addToCart(s.buyerToken, s.product.id, 1);
    const created = await placeOrder(s.buyerToken);
    const id = created.body.data.order._id;
    await prisma.order.update({ where: { id }, data: { status: 'delivered', deliveredAt: new Date() } });

    const res = await request(app).post(`/api/orders/${id}/return`).set('Authorization', `Bearer ${s.buyerToken}`).send({ reason: 'damaged' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('return_requested');
    expect(res.body.data.returnReason).toBe('damaged');
  });

  it('rejects a return on a non-delivered order', async () => {
    const s = await setup();
    await addToCart(s.buyerToken, s.product.id, 1);
    const created = await placeOrder(s.buyerToken);
    const id = created.body.data.order._id;

    const res = await request(app).post(`/api/orders/${id}/return`).set('Authorization', `Bearer ${s.buyerToken}`).send({ reason: 'x' });
    expect(res.status).toBe(400);
  });
});
