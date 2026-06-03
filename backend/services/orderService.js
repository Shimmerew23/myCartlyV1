const { prisma } = require('../config/prisma');

// Include shape for full order responses.
const ORDER_INCLUDE = {
  items: true,
  statusHistory: { orderBy: { timestamp: 'asc' } },
};

// 10% tax; free shipping over $100, else $9.99 — mirrors the Mongoose controller.
const computeTotals = (subtotal) => {
  const taxRate = 0.1;
  const shippingCost = subtotal > 100 ? 0 : 9.99;
  const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
  const totalPrice = Math.round((subtotal + shippingCost + taxAmount) * 100) / 100;
  return { shippingCost, taxAmount, totalPrice };
};

// Count-based, matching the legacy pre-save hook format.
const generateOrderNumber = async (client = prisma) => {
  const count = await client.order.count();
  return `CUR-${Date.now()}-${String(count + 1).padStart(6, '0')}`;
};

const serializeUserRef = (u) =>
  u ? { _id: u.id, id: u.id, name: u.name, email: u.email } : undefined;

const serializeStatusEvent = (e) => ({
  _id: e.id,
  status: e.status,
  timestamp: e.timestamp,
  note: e.note ?? undefined,
  updatedBy: e.updatedById ?? undefined,
  warehouseName: e.warehouseName ?? undefined,
});

// productMap: optional Map<productId, serialized product summary> to populate item.product.
const serializeOrderItem = (item, productMap) => ({
  _id: item.id,
  id: item.id,
  product: productMap && productMap.has(item.productId) ? productMap.get(item.productId) : item.productId,
  seller: item.sellerId,
  name: item.name,
  image: item.image ?? undefined,
  price: item.price,
  quantity: item.quantity,
  variant: { name: item.variantName ?? undefined, value: item.variantValue ?? undefined },
});

const serializeOrder = (order, { productMap } = {}) => {
  if (!order) return null;
  return {
    _id: order.id,
    id: order.id,
    orderNumber: order.orderNumber,
    user: order.user ? serializeUserRef(order.user) : order.userId,
    items: (order.items || []).map((i) => serializeOrderItem(i, productMap)),
    shippingAddress: order.shippingAddress,
    subtotal: order.subtotal,
    shippingCost: order.shippingCost,
    taxAmount: order.taxAmount,
    discountAmount: order.discountAmount,
    totalPrice: order.totalPrice,
    currency: order.currency,
    coupon: order.coupon ?? null,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    paymentResult: order.paymentResult ?? undefined,
    paidAt: order.paidAt ?? undefined,
    status: order.status,
    tracking: order.tracking ?? undefined,
    preferredCarrier: order.preferredCarrier ?? undefined,
    statusHistory: (order.statusHistory || []).map(serializeStatusEvent),
    cancelledAt: order.cancelledAt ?? undefined,
    cancellationReason: order.cancellationReason ?? undefined,
    returnReason: order.returnReason ?? undefined,
    deliveredAt: order.deliveredAt ?? undefined,
    customerNote: order.customerNote ?? undefined,
    internalNote: order.internalNote ?? undefined,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
};

// Builds a Map<productId, summary> for populating order item products (getOrder).
const getItemProductMap = async (productIds) => {
  const ids = [...new Set(productIds)].filter(Boolean);
  if (ids.length === 0) return new Map();
  const rows = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, slug: true, images: true },
  });
  return new Map(
    rows.map((r) => [
      r.id,
      {
        _id: r.id,
        id: r.id,
        name: r.name,
        slug: r.slug,
        images: (r.images || []).map((img) => ({ _id: img.id, url: img.url, alt: img.alt ?? undefined, isPrimary: img.isPrimary })),
      },
    ])
  );
};

module.exports = {
  ORDER_INCLUDE,
  computeTotals,
  generateOrderNumber,
  serializeUserRef,
  serializeStatusEvent,
  serializeOrderItem,
  serializeOrder,
  getItemProductMap,
};
