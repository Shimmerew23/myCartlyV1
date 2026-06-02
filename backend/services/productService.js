const slugify = require('slugify');
const { Prisma } = require('@prisma/client');
const { prisma } = require('../config/prisma');

const EMPTY_DISTRIBUTION = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };

// ============================================================
// Virtuals (replace Mongoose product virtuals)
// ============================================================

const computeDiscountedPrice = (price, discount) => {
  if (!discount || !discount.value) return price;
  const now = new Date();
  if (discount.validFrom && now < new Date(discount.validFrom)) return price;
  if (discount.validUntil && now > new Date(discount.validUntil)) return price;
  if (discount.type === 'percentage') {
    return Math.round(price * (1 - discount.value / 100) * 100) / 100;
  }
  return Math.max(0, price - discount.value);
};

const computeDiscountPercentage = (price, compareAtPrice) => {
  if (!compareAtPrice || compareAtPrice <= price) return 0;
  return Math.round(((compareAtPrice - price) / compareAtPrice) * 100);
};

const computeInStock = (trackInventory, stock) => (!trackInventory ? true : stock > 0);

// ============================================================
// Serializers (rebuild Mongo-shaped JSON from relational rows)
// ============================================================

const serializeCategory = (c) => {
  if (!c) return undefined;
  return {
    _id: c.id,
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description ?? undefined,
    image: c.image ?? undefined,
    icon: c.icon ?? undefined,
    parent: c.parentId ?? null,
    isActive: c.isActive,
    sortOrder: c.sortOrder,
    productCount: c.productCount,
    seo: c.seo ?? undefined,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
};

const serializeSellerSummary = (s) => {
  if (!s) return undefined;
  return {
    _id: s.id,
    id: s.id,
    name: s.name,
    sellerProfile: s.sellerProfile
      ? { storeName: s.sellerProfile.storeName ?? undefined, storeLogo: s.sellerProfile.storeLogo ?? undefined }
      : undefined,
  };
};

const serializeImage = (i) => ({
  _id: i.id,
  id: i.id,
  url: i.url,
  public_id: i.publicId ?? undefined,
  alt: i.alt ?? undefined,
  isPrimary: i.isPrimary,
});

const serializeVariant = (v) => ({
  _id: v.id,
  id: v.id,
  name: v.name,
  value: v.value,
  stock: v.stock,
  price: v.price ?? undefined,
  sku: v.sku ?? undefined,
  images: v.images || [],
});

const serializeProduct = (p) => {
  if (!p) return null;
  return {
    _id: p.id,
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    shortDescription: p.shortDescription ?? undefined,
    price: p.price,
    compareAtPrice: p.compareAtPrice ?? undefined,
    currency: p.currency,
    video: p.video ?? undefined,
    images: (p.images || []).map(serializeImage),
    category: p.category ? serializeCategory(p.category) : p.categoryId,
    subcategory: p.subcategory ?? undefined,
    tags: p.tags || [],
    brand: p.brand ?? undefined,
    seller: p.seller ? serializeSellerSummary(p.seller) : p.sellerId,
    sku: p.sku ?? undefined,
    stock: p.stock,
    lowStockThreshold: p.lowStockThreshold,
    trackInventory: p.trackInventory,
    hasVariants: p.hasVariants,
    variants: (p.variants || []).map(serializeVariant),
    rating: {
      average: p.ratingAverage,
      count: p.ratingCount,
      distribution: p.ratingDistribution || { ...EMPTY_DISTRIBUTION },
    },
    status: p.status,
    isFeatured: p.isFeatured,
    isTrending: p.isTrending,
    isNewArrival: p.isNewArrival,
    seo: p.seo ?? undefined,
    shipping: p.shipping ?? undefined,
    discount: p.discount ?? undefined,
    views: p.views,
    sales: p.sales,
    revenue: p.revenue,
    wishlistCount: p.wishlistCount,
    discountedPrice: computeDiscountedPrice(p.price, p.discount),
    discountPercentage: computeDiscountPercentage(p.price, p.compareAtPrice),
    inStock: computeInStock(p.trackInventory, p.stock),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
};

// Standard includes for full product responses.
const PRODUCT_INCLUDE = {
  images: true,
  variants: true,
  category: true,
  seller: { include: { sellerProfile: true } },
};

// ============================================================
// Helpers: slug, SKU, body normalization
// ============================================================

const normalizeProductBody = (body) => {
  const data = { ...body };
  if (typeof data.tags === 'string') {
    data.tags = data.tags.split(',').map((t) => t.trim()).filter(Boolean);
  }
  if (data.weight !== undefined || data.isFreeShipping !== undefined) {
    data.shipping = { weight: data.weight, isFreeShipping: data.isFreeShipping };
    delete data.weight;
    delete data.isFreeShipping;
  }
  if (data.metaTitle !== undefined || data.metaDescription !== undefined) {
    data.seo = { metaTitle: data.metaTitle, metaDescription: data.metaDescription };
    delete data.metaTitle;
    delete data.metaDescription;
  }
  return data;
};

const generateSku = () =>
  `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

const generateUniqueSlug = async (name) => {
  const base = slugify(name, { lower: true, strict: true });
  let slug = base;
  let count = 0;
  // eslint-disable-next-line no-await-in-loop
  while (await prisma.product.findUnique({ where: { slug } })) {
    count += 1;
    slug = `${base}-${count}`;
  }
  return slug;
};

// ============================================================
// Full-text search
// ============================================================

// term: user search string; filters: array of Prisma.sql WHERE fragments referencing alias p.
// orderBy: optional Prisma.sql ORDER BY fragment; defaults to rank desc.
const searchProductIds = async ({ term, filters = [], orderBy, skip = 0, take = 20 }) => {
  const tsquery = Prisma.sql`websearch_to_tsquery('english', ${term})`;
  const conds = [Prisma.sql`p."searchVector" @@ ${tsquery}`, ...filters];
  const where = Prisma.join(conds, ' AND ');
  const order = orderBy || Prisma.sql`ts_rank(p."searchVector", ${tsquery}) DESC`;

  const rows = await prisma.$queryRaw`
    SELECT p.id FROM "Product" p
    WHERE ${where}
    ORDER BY ${order}
    OFFSET ${skip} LIMIT ${take}
  `;
  const countRows = await prisma.$queryRaw`
    SELECT count(*)::int AS count FROM "Product" p WHERE ${where}
  `;
  return { ids: rows.map((r) => r.id), total: countRows[0].count };
};

// Returns serialized product summaries for an array of product ids, preserving order.
const getWishlistProducts = async (ids) => {
  if (!ids || ids.length === 0) return [];
  const rows = await prisma.product.findMany({
    where: { id: { in: ids } },
    include: { images: true, category: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean).map(serializeProduct);
};

module.exports = {
  prisma,
  computeDiscountedPrice,
  computeDiscountPercentage,
  computeInStock,
  serializeCategory,
  serializeSellerSummary,
  serializeImage,
  serializeVariant,
  serializeProduct,
  PRODUCT_INCLUDE,
  normalizeProductBody,
  generateSku,
  generateUniqueSlug,
  searchProductIds,
  getWishlistProducts,
};
