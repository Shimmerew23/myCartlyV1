const { Prisma } = require('@prisma/client');
const { prisma } = require('../config/prisma');
const productService = require('../services/productService');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { cache } = require('../config/redis');
const logger = require('../utils/logger');
const { deleteImage } = require('../config/cloudinary');

const { serializeProduct, PRODUCT_INCLUDE } = productService;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Build a Prisma `where` for listing (non-search path).
const buildProductWhere = (query) => {
  const where = {};
  if (query.category) where.categoryId = query.category;
  if (query.seller) where.sellerId = query.seller;
  if (query.brand) where.brand = { contains: query.brand, mode: 'insensitive' };
  if (query.tags) where.tags = { hasSome: query.tags.split(',') };
  if (query.status) where.status = query.status;
  if (query.featured === 'true') where.isFeatured = true;
  if (query.trending === 'true') where.isTrending = true;
  if (query.newArrival === 'true') where.isNewArrival = true;
  if (query.inStock === 'true') where.stock = { gt: 0 };
  if (query.minPrice || query.maxPrice) {
    where.price = {};
    if (query.minPrice) where.price.gte = parseFloat(query.minPrice);
    if (query.maxPrice) where.price.lte = parseFloat(query.maxPrice);
  }
  if (query.rating) where.ratingAverage = { gte: parseFloat(query.rating) };
  return where;
};

// Build SQL filter fragments mirroring buildProductWhere for the FTS path.
const buildSqlFilters = (query) => {
  const f = [];
  if (query.category) f.push(Prisma.sql`p."categoryId" = ${query.category}`);
  if (query.seller) f.push(Prisma.sql`p."sellerId" = ${query.seller}`);
  if (query.brand) f.push(Prisma.sql`p."brand" ILIKE ${`%${query.brand}%`}`);
  if (query.status) f.push(Prisma.sql`p."status" = ${query.status}::"ProductStatus"`);
  if (query.featured === 'true') f.push(Prisma.sql`p."isFeatured" = true`);
  if (query.trending === 'true') f.push(Prisma.sql`p."isTrending" = true`);
  if (query.newArrival === 'true') f.push(Prisma.sql`p."isNewArrival" = true`);
  if (query.inStock === 'true') f.push(Prisma.sql`p."stock" > 0`);
  if (query.minPrice) f.push(Prisma.sql`p."price" >= ${parseFloat(query.minPrice)}`);
  if (query.maxPrice) f.push(Prisma.sql`p."price" <= ${parseFloat(query.maxPrice)}`);
  if (query.rating) f.push(Prisma.sql`p."ratingAverage" >= ${parseFloat(query.rating)}`);
  if (query.tags) f.push(Prisma.sql`p."tags" && ${query.tags.split(',')}`);
  return f;
};

const SORT_MAP = {
  '-createdAt': { createdAt: 'desc' },
  createdAt: { createdAt: 'asc' },
  '-price': { price: 'desc' },
  price: { price: 'asc' },
  '-rating': { ratingAverage: 'desc' },
  '-sales': { sales: 'desc' },
  '-views': { views: 'desc' },
  name: { name: 'asc' },
  '-name': { name: 'desc' },
};

// Re-order Prisma rows to match the id order returned by the FTS query.
const orderByIds = (rows, ids) => {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
};

// Coerce multipart string fields into numbers/booleans.
const coerceProductScalars = (data) => {
  ['price', 'compareAtPrice', 'stock', 'lowStockThreshold'].forEach((k) => {
    if (data[k] !== undefined) data[k] = Number(data[k]);
  });
  ['isFeatured', 'isTrending', 'isNewArrival', 'trackInventory', 'hasVariants'].forEach((k) => {
    if (data[k] !== undefined) data[k] = data[k] === true || data[k] === 'true';
  });
  return data;
};

// @desc Get all products (public)
// @route GET /api/products
const getProducts = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const publicOnly = !req.user || req.user.role === 'user';

    let products;
    let total;

    if (req.query.search) {
      const filters = buildSqlFilters(req.query);
      if (publicOnly) filters.push(Prisma.sql`p."status" = 'active'::"ProductStatus"`);
      const result = await productService.searchProductIds({ term: req.query.search, filters, skip, take: limit });
      total = result.total;
      const rows = await prisma.product.findMany({ where: { id: { in: result.ids } }, include: PRODUCT_INCLUDE });
      products = orderByIds(rows, result.ids);
    } else {
      const where = buildProductWhere(req.query);
      if (publicOnly) where.status = 'active';
      const orderBy = SORT_MAP[req.query.sort] || { createdAt: 'desc' };
      [products, total] = await Promise.all([
        prisma.product.findMany({ where, orderBy, skip, take: limit, include: PRODUCT_INCLUDE }),
        prisma.product.count({ where }),
      ]);
    }

    const pages = Math.ceil(total / limit);
    return ApiResponse.paginated(res, products.map(serializeProduct), {
      page, limit, total, pages, hasNext: page < pages, hasPrev: page > 1,
    });
  } catch (err) { next(err); }
};

// @desc Get single product
// @route GET /api/products/:slug
const getProduct = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const cacheKey = `product:${slug}`;
    const cached = await cache.get(cacheKey);
    if (cached) return ApiResponse.success(res, cached);

    const or = [{ slug }];
    if (UUID_RE.test(slug)) or.push({ id: slug });
    const product = await prisma.product.findFirst({ where: { OR: or }, include: PRODUCT_INCLUDE });
    if (!product) return next(ApiError.notFound('Product not found'));

    // Increment views (non-blocking)
    prisma.product.update({ where: { id: product.id }, data: { views: { increment: 1 } } }).catch(() => {});

    const data = serializeProduct(product);
    await cache.set(cacheKey, data, 300);
    return ApiResponse.success(res, data);
  } catch (err) { next(err); }
};

// @desc Create product
// @route POST /api/products  (Seller/Admin)
const createProduct = async (req, res, next) => {
  try {
    const body = coerceProductScalars(productService.normalizeProductBody(req.body));
    const categoryId = body.category;

    const data = {
      name: body.name,
      slug: await productService.generateUniqueSlug(body.name),
      description: body.description,
      shortDescription: body.shortDescription,
      price: body.price,
      compareAtPrice: body.compareAtPrice,
      currency: body.currency || 'USD',
      subcategory: body.subcategory,
      tags: body.tags || [],
      brand: body.brand,
      sku: body.sku || productService.generateSku(),
      stock: body.stock ?? 0,
      status: body.status || 'draft',
      isFeatured: body.isFeatured ?? false,
      isTrending: body.isTrending ?? false,
      isNewArrival: body.isNewArrival ?? false,
      seo: body.seo ?? undefined,
      shipping: body.shipping ?? undefined,
      categoryId,
      sellerId: req.user._id,
    };

    if (req.processedImages?.length) {
      data.images = {
        create: req.processedImages.map((img, i) => ({
          url: img.url, publicId: img.public_id, alt: req.body.name, isPrimary: i === 0,
        })),
      };
    }

    const product = await prisma.product.create({ data, include: PRODUCT_INCLUDE });
    await cache.flush('cache:products:*');
    logger.info(`Product created: ${product.name} by ${req.user.email}`);
    return ApiResponse.created(res, serializeProduct(product), 'Product created successfully');
  } catch (err) { next(err); }
};

// @desc Update product
// @route PUT /api/products/:id  (Seller own / Admin)
const updateProduct = async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id }, include: { images: true } });
    if (!product) return next(ApiError.notFound('Product not found'));

    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
    if (!isAdmin && product.sellerId !== req.user._id) {
      return next(ApiError.forbidden('You can only update your own products'));
    }

    const body = coerceProductScalars(productService.normalizeProductBody(req.body));

    const data = {};
    ['name', 'description', 'shortDescription', 'price', 'compareAtPrice', 'currency',
      'subcategory', 'brand', 'sku', 'stock', 'status', 'isFeatured', 'isTrending',
      'isNewArrival'].forEach((k) => { if (body[k] !== undefined) data[k] = body[k]; });
    if (body.tags !== undefined) data.tags = body.tags;
    if (body.seo !== undefined) data.seo = body.seo;
    if (body.shipping !== undefined) data.shipping = body.shipping;
    if (body.category !== undefined) data.categoryId = body.category;

    if (req.processedImages?.length) {
      const newImages = req.processedImages.map((img, i) => ({
        url: img.url, publicId: img.public_id, alt: body.name || product.name,
        isPrimary: i === 0 && product.images.length === 0,
      }));
      if (req.body.replaceImages === 'true') {
        await Promise.all(product.images.map((img) => deleteImage(img.publicId)));
        await prisma.productImage.deleteMany({ where: { productId: product.id } });
      }
      data.images = { create: newImages };
    }

    const updated = await prisma.product.update({ where: { id: product.id }, data, include: PRODUCT_INCLUDE });
    await cache.del(`product:${product.slug}`);
    await cache.flush('cache:products:*');
    return ApiResponse.success(res, serializeProduct(updated), 'Product updated successfully');
  } catch (err) { next(err); }
};

// @desc Delete product (soft → archived)
// @route DELETE /api/products/:id  (Seller own / Admin)
const deleteProduct = async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product) return next(ApiError.notFound('Product not found'));

    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
    if (!isAdmin && product.sellerId !== req.user._id) {
      return next(ApiError.forbidden('You can only delete your own products'));
    }

    await prisma.product.update({ where: { id: product.id }, data: { status: 'archived' } });
    await cache.del(`product:${product.slug}`);
    await cache.flush('cache:products:*');
    logger.info(`Product archived: ${product.name}`);
    return ApiResponse.success(res, null, 'Product deleted successfully');
  } catch (err) { next(err); }
};

// @desc Get featured / trending / new products
// @route GET /api/products/featured
const getFeaturedProducts = async (req, res, next) => {
  try {
    const cacheKey = 'products:featured';
    const cached = await cache.get(cacheKey);
    if (cached) return ApiResponse.success(res, cached);

    const [featured, trending, newArrivals] = await Promise.all([
      prisma.product.findMany({ where: { isFeatured: true, status: 'active' }, take: 8, include: PRODUCT_INCLUDE }),
      prisma.product.findMany({ where: { isTrending: true, status: 'active' }, orderBy: { sales: 'desc' }, take: 12, include: PRODUCT_INCLUDE }),
      prisma.product.findMany({ where: { isNewArrival: true, status: 'active' }, orderBy: { createdAt: 'desc' }, take: 8, include: PRODUCT_INCLUDE }),
    ]);

    const data = {
      featured: featured.map(serializeProduct),
      trending: trending.map(serializeProduct),
      newArrivals: newArrivals.map(serializeProduct),
    };
    await cache.set(cacheKey, data, 600);
    return ApiResponse.success(res, data);
  } catch (err) { next(err); }
};

// @desc Get seller's own products
// @route GET /api/products/my-products  (Seller)
const getMyProducts = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    if (req.query.search) {
      const filters = [Prisma.sql`p."sellerId" = ${req.user._id}`];
      if (req.query.status) filters.push(Prisma.sql`p."status" = ${req.query.status}::"ProductStatus"`);
      const result = await productService.searchProductIds({ term: req.query.search, filters, skip, take: limit });
      const rows = await prisma.product.findMany({ where: { id: { in: result.ids } }, include: { category: true } });
      const products = orderByIds(rows, result.ids);
      return ApiResponse.paginated(res, products.map(serializeProduct), {
        page, limit, total: result.total, pages: Math.ceil(result.total / limit),
      });
    }

    const where = { sellerId: req.user._id };
    if (req.query.status) where.status = req.query.status;

    const [products, total] = await Promise.all([
      prisma.product.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit, include: { category: true } }),
      prisma.product.count({ where }),
    ]);

    return ApiResponse.paginated(res, products.map(serializeProduct), {
      page, limit, total, pages: Math.ceil(total / limit),
    });
  } catch (err) { next(err); }
};

// @desc Get related products
// @route GET /api/products/:id/related
const getRelatedProducts = async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product) return next(ApiError.notFound('Product not found'));

    const related = await prisma.product.findMany({
      where: { id: { not: product.id }, categoryId: product.categoryId, status: 'active' },
      take: 6,
      include: { category: true },
    });

    return ApiResponse.success(res, related.map(serializeProduct));
  } catch (err) { next(err); }
};

// @desc Toggle wishlist
// @route POST /api/products/:id/wishlist  (Private)
const toggleWishlist = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) return next(ApiError.notFound('Product not found'));

    const user = await prisma.user.findUnique({ where: { id: req.user._id }, select: { wishlist: true } });
    const isWishlisted = (user.wishlist || []).includes(id);
    const nextWishlist = isWishlisted
      ? user.wishlist.filter((x) => x !== id)
      : [...(user.wishlist || []), id];

    await prisma.user.update({ where: { id: req.user._id }, data: { wishlist: nextWishlist } });
    await prisma.product.update({ where: { id }, data: { wishlistCount: { increment: isWishlisted ? -1 : 1 } } });

    return ApiResponse.success(res, { wishlisted: !isWishlisted });
  } catch (err) { next(err); }
};

// @desc Get seller dashboard stats
// @route GET /api/products/seller-stats  (Seller)
const getSellerStats = async (req, res, next) => {
  try {
    const sellerId = req.user._id;

    const [byStatus, totals, topProducts] = await Promise.all([
      prisma.product.groupBy({
        by: ['status'],
        where: { sellerId },
        _count: { _all: true },
        _sum: { stock: true },
      }),
      prisma.product.aggregate({
        where: { sellerId },
        _sum: { sales: true, revenue: true, views: true },
      }),
      prisma.product.findMany({
        where: { sellerId, status: 'active' },
        orderBy: { sales: 'desc' },
        take: 5,
        include: { images: true },
      }),
    ]);

    const productStats = byStatus.map((g) => ({ _id: g.status, count: g._count._all, totalStock: g._sum.stock || 0 }));
    const revenueStats = [{
      _id: null,
      totalSales: totals._sum.sales || 0,
      totalRevenue: totals._sum.revenue || 0,
      totalViews: totals._sum.views || 0,
    }];

    return ApiResponse.success(res, {
      productStats,
      revenueStats,
      topProducts: topProducts.map(serializeProduct),
    });
  } catch (err) { next(err); }
};

module.exports = {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  getFeaturedProducts,
  getMyProducts,
  getRelatedProducts,
  toggleWishlist,
  getSellerStats,
};
