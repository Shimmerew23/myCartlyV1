const { prisma } = require('../config/prisma');
const {
  computeDiscountedPrice,
  serializeImage,
  serializeSellerSummary,
} = require('./productService');

const EMPTY_DISTRIBUTION = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };

// Products needed to populate cart line items (mirrors the Mongoose populate select).
const CART_PRODUCT_INCLUDE = {
  images: true,
  category: true,
  seller: { include: { sellerProfile: true } },
};

// Mongo-shaped product summary as embedded in cart items.
const serializeProductSummary = (p) => {
  if (!p) return null;
  return {
    _id: p.id,
    id: p.id,
    name: p.name,
    price: p.price,
    slug: p.slug,
    status: p.status,
    stock: p.stock,
    images: (p.images || []).map(serializeImage),
    discountedPrice: computeDiscountedPrice(p.price, p.discount),
    rating: {
      average: p.ratingAverage,
      count: p.ratingCount,
      distribution: p.ratingDistribution || { ...EMPTY_DISTRIBUTION },
    },
    seller: p.seller ? serializeSellerSummary(p.seller) : p.sellerId,
    category: p.category ? { _id: p.category.id, id: p.category.id, name: p.category.name } : undefined,
  };
};

const serializeCartItem = (item, product) => ({
  _id: item.id,
  id: item.id,
  product: product ? serializeProductSummary(product) : item.productId,
  quantity: item.quantity,
  variant: { name: item.variantName ?? undefined, value: item.variantValue ?? undefined },
  price: item.price,
  addedAt: item.addedAt,
});

const computeSubtotal = (items) => items.reduce((sum, i) => sum + i.price * i.quantity, 0);
const computeItemCount = (items) => items.reduce((sum, i) => sum + i.quantity, 0);

const serializeCoupon = (cart) =>
  cart && cart.couponCode
    ? {
        code: cart.couponCode,
        discountType: cart.couponType,
        discountValue: cart.couponValue,
        validUntil: cart.couponValidUntil,
      }
    : null;

// cart: Prisma cart with `items`; productMap: Map<productId, productRow>.
const serializeCart = (cart, productMap = new Map()) => {
  const items = (cart.items || []).map((i) => serializeCartItem(i, productMap.get(i.productId)));
  return {
    items,
    subtotal: computeSubtotal(items),
    itemCount: computeItemCount(items),
    coupon: serializeCoupon(cart),
  };
};

// ============================================================
// DB helpers
// ============================================================

const getOrCreateCart = async (userId) => {
  const existing = await prisma.cart.findUnique({ where: { userId }, include: { items: { orderBy: { addedAt: 'asc' } } } });
  if (existing) return existing;
  return prisma.cart.create({ data: { userId }, include: { items: true } });
};

const getProductMap = async (productIds) => {
  const ids = [...new Set(productIds)].filter(Boolean);
  if (ids.length === 0) return new Map();
  const rows = await prisma.product.findMany({ where: { id: { in: ids } }, include: CART_PRODUCT_INCLUDE });
  return new Map(rows.map((r) => [r.id, r]));
};

// Loads the cart, fetches its products, and returns the serialized payload.
const loadSerializedCart = async (userId) => {
  const cart = await getOrCreateCart(userId);
  const productMap = await getProductMap((cart.items || []).map((i) => i.productId));
  return { cart, productMap, payload: serializeCart(cart, productMap) };
};

module.exports = {
  CART_PRODUCT_INCLUDE,
  serializeProductSummary,
  serializeCartItem,
  computeSubtotal,
  computeItemCount,
  serializeCoupon,
  serializeCart,
  getOrCreateCart,
  getProductMap,
  loadSerializedCart,
};
