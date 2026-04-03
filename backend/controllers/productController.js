const Product = require('../models/Product');
const { Category } = require('../models/index');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { cache } = require('../config/redis');
const logger = require('../utils/logger');

// Helper: compute virtual fields lost when using .lean()
const addProductVirtuals = (p) => {
  const inStock = !p.trackInventory || p.stock > 0;

  let discountedPrice = p.price;
  if (p.discount?.value) {
    const now = new Date();
    const fromOk = !p.discount.validFrom || now >= new Date(p.discount.validFrom);
    const untilOk = !p.discount.validUntil || now <= new Date(p.discount.validUntil);
    if (fromOk && untilOk) {
      discountedPrice = p.discount.type === 'percentage'
        ? Math.round(p.price * (1 - p.discount.value / 100) * 100) / 100
        : Math.max(0, p.price - p.discount.value);
    }
  }

  return { ...p, inStock, discountedPrice };
};

// Build query filters from request
const buildProductFilter = (query) => {
  const filter = {};

  if (query.search) {
    filter.$text = { $search: query.search };
  }
  if (query.category) filter.category = query.category;
  if (query.seller) filter.seller = query.seller;
  if (query.brand) filter.brand = { $regex: query.brand, $options: 'i' };
  if (query.tags) filter.tags = { $in: query.tags.split(',') };
  if (query.status) filter.status = query.status;
  if (query.featured === 'true') filter.isFeatured = true;
  if (query.trending === 'true') filter.isTrending = true;
  if (query.newArrival === 'true') filter.isNewArrival = true;
  if (query.inStock === 'true') filter.stock = { $gt: 0 };

  // Price range
  if (query.minPrice || query.maxPrice) {
    filter.price = {};
    if (query.minPrice) filter.price.$gte = parseFloat(query.minPrice);
    if (query.maxPrice) filter.price.$lte = parseFloat(query.maxPrice);
  }

  // Rating
  if (query.rating) {
    filter['rating.average'] = { $gte: parseFloat(query.rating) };
  }

  return filter;
};

// Build sort object
const buildSort = (sortStr, hasSearch) => {
  const sortMap = {
    '-createdAt': { createdAt: -1 },
    createdAt: { createdAt: 1 },
    '-price': { price: -1 },
    price: { price: 1 },
    '-rating': { 'rating.average': -1 },
    '-sales': { sales: -1 },
    '-views': { views: -1 },
    name: { name: 1 },
    '-name': { name: -1 },
  };

  if (hasSearch && !sortStr) {
    return { score: { $meta: 'textScore' } };
  }

  return sortMap[sortStr] || { createdAt: -1 };
};

// @desc    Get all products (public)
// @route   GET /api/products
const getProducts = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const filter = buildProductFilter(req.query);

    // Public only sees active products (unless admin/seller)
    if (!req.user || req.user.role === 'user') {
      filter.status = 'active';
    }

    const sort = buildSort(req.query.sort, !!req.query.search);
    const projection = req.query.search
      ? { score: { $meta: 'textScore' } }
      : {};

    const [products, total] = await Promise.all([
      Product.find(filter, projection)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate('category', 'name slug')
        .populate('seller', 'name sellerProfile.storeName sellerProfile.storeLogo')
        .lean(),
      Product.countDocuments(filter),
    ]);

    return ApiResponse.paginated(res, products.map(addProductVirtuals), {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      hasNext: page < Math.ceil(total / limit),
      hasPrev: page > 1,
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Get single product
// @route   GET /api/products/:slug
const getProduct = async (req, res, next) => {
  try {
    const { slug } = req.params;

    const cacheKey = `product:${slug}`;
    const cached = await cache.get(cacheKey);
    if (cached) return ApiResponse.success(res, cached);

    const product = await Product.findOne({
      $or: [{ slug }, { _id: slug.match(/^[0-9a-fA-F]{24}$/) ? slug : null }],
    })
      .populate('category', 'name slug parent')
      .populate('seller', 'name sellerProfile createdAt')
      .lean();

    if (!product) return next(ApiError.notFound('Product not found'));

    // Increment views (async, non-blocking)
    Product.findByIdAndUpdate(product._id, { $inc: { views: 1 } }).exec();

    const productWithVirtuals = addProductVirtuals(product);
    await cache.set(cacheKey, productWithVirtuals, 300);
    return ApiResponse.success(res, productWithVirtuals);
  } catch (err) {
    next(err);
  }
};

// @desc    Create product
// @route   POST /api/products
// @access  Seller/Admin
// Reshape flat form fields into the nested structure the Product model expects
const normalizeProductBody = (body) => {
  const data = { ...body };

  // tags: comma-separated string → array
  if (typeof data.tags === 'string') {
    data.tags = data.tags.split(',').map((t) => t.trim()).filter(Boolean);
  }

  // shipping: flat weight/isFreeShipping → nested object
  if (data.weight !== undefined || data.isFreeShipping !== undefined) {
    data.shipping = { weight: data.weight, isFreeShipping: data.isFreeShipping };
    delete data.weight;
    delete data.isFreeShipping;
  }

  // seo: flat metaTitle/metaDescription → nested object
  if (data.metaTitle !== undefined || data.metaDescription !== undefined) {
    data.seo = { metaTitle: data.metaTitle, metaDescription: data.metaDescription };
    delete data.metaTitle;
    delete data.metaDescription;
  }

  return data;
};

const createProduct = async (req, res, next) => {
  try {
    const productData = { ...normalizeProductBody(req.body), seller: req.user._id };

    // Process uploaded images
    if (req.processedImages?.length) {
      productData.images = req.processedImages.map((img, i) => ({
        url: img.url,
        alt: req.body.name,
        isPrimary: i === 0,
      }));
    }

    // Auto-generate SKU if not provided
    if (!productData.sku) {
      productData.sku = `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    }

    const product = await Product.create(productData);
    await product.populate('category', 'name slug');

    // Invalidate product cache
    await cache.flush('cache:products:*');

    logger.info(`Product created: ${product.name} by ${req.user.email}`);
    return ApiResponse.created(res, product, 'Product created successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Update product
// @route   PUT /api/products/:id
// @access  Seller (own) / Admin
const updateProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return next(ApiError.notFound('Product not found'));

    // Ownership check
    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
    if (!isAdmin && product.seller.toString() !== req.user._id.toString()) {
      return next(ApiError.forbidden('You can only update your own products'));
    }

    const updateData = normalizeProductBody(req.body);

    // Process new images if uploaded
    if (req.processedImages?.length) {
      const newImages = req.processedImages.map((img, i) => ({
        url: img.url,
        alt: updateData.name || product.name,
        isPrimary: i === 0 && !product.images.length,
      }));

      if (updateData.replaceImages === 'true') {
        updateData.images = newImages;
      } else {
        updateData.images = [...product.images, ...newImages];
      }
    }

    const updated = await Product.findByIdAndUpdate(
      req.params.id,
      { ...updateData, updatedAt: Date.now() },
      { new: true, runValidators: true }
    )
      .populate('category', 'name slug')
      .populate('seller', 'name sellerProfile.storeName');

    // Invalidate cache
    await cache.del(`product:${product.slug}`);
    await cache.flush('cache:products:*');

    return ApiResponse.success(res, updated, 'Product updated successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Delete product
// @route   DELETE /api/products/:id
// @access  Seller (own) / Admin
const deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return next(ApiError.notFound('Product not found'));

    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
    if (!isAdmin && product.seller.toString() !== req.user._id.toString()) {
      return next(ApiError.forbidden('You can only delete your own products'));
    }

    // Soft delete — mark as archived
    await Product.findByIdAndUpdate(req.params.id, { status: 'archived' });

    await cache.del(`product:${product.slug}`);
    await cache.flush('cache:products:*');

    logger.info(`Product archived: ${product.name}`);
    return ApiResponse.success(res, null, 'Product deleted successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Get featured / trending products
// @route   GET /api/products/featured
const getFeaturedProducts = async (req, res, next) => {
  try {
    const cacheKey = 'products:featured';
    const cached = await cache.get(cacheKey);
    if (cached) return ApiResponse.success(res, cached);

    const [featured, trending, newArrivals] = await Promise.all([
      Product.find({ isFeatured: true, status: 'active' })
        .limit(8)
        .populate('category', 'name slug')
        .populate('seller', 'name sellerProfile.storeName')
        .lean(),
      Product.find({ isTrending: true, status: 'active' })
        .sort({ sales: -1 })
        .limit(12)
        .populate('category', 'name slug')
        .populate('seller', 'name sellerProfile.storeName')
        .lean(),
      Product.find({ isNewArrival: true, status: 'active' })
        .sort({ createdAt: -1 })
        .limit(8)
        .populate('category', 'name slug')
        .lean(),
    ]);

    const data = {
      featured: featured.map(addProductVirtuals),
      trending: trending.map(addProductVirtuals),
      newArrivals: newArrivals.map(addProductVirtuals),
    };
    await cache.set(cacheKey, data, 600);
    return ApiResponse.success(res, data);
  } catch (err) {
    next(err);
  }
};

// @desc    Get seller's own products
// @route   GET /api/products/my-products
// @access  Seller
const getMyProducts = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const filter = { seller: req.user._id };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.search) filter.$text = { $search: req.query.search };

    const [products, total] = await Promise.all([
      Product.find(filter)
        .sort(req.query.sort || '-createdAt')
        .skip(skip)
        .limit(limit)
        .populate('category', 'name')
        .lean(),
      Product.countDocuments(filter),
    ]);

    return ApiResponse.paginated(res, products, {
      page, limit, total,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Get related products
// @route   GET /api/products/:id/related
const getRelatedProducts = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id).lean();
    if (!product) return next(ApiError.notFound('Product not found'));

    const related = await Product.find({
      _id: { $ne: product._id },
      category: product.category,
      status: 'active',
    })
      .limit(6)
      .populate('category', 'name slug')
      .lean();

    return ApiResponse.success(res, related.map(addProductVirtuals));
  } catch (err) {
    next(err);
  }
};

// @desc    Toggle wishlist
// @route   POST /api/products/:id/wishlist
// @access  Private
const toggleWishlist = async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const product = await Product.findById(id);
    if (!product) return next(ApiError.notFound('Product not found'));

    const isWishlisted = user.wishlist.some((p) => p.toString() === id);
    const update = isWishlisted
      ? { $pull: { wishlist: id } }
      : { $addToSet: { wishlist: id } };

    await require('../models/User').findByIdAndUpdate(user._id, update);
    await Product.findByIdAndUpdate(id, {
      $inc: { wishlistCount: isWishlisted ? -1 : 1 },
    });

    return ApiResponse.success(res, { wishlisted: !isWishlisted });
  } catch (err) {
    next(err);
  }
};

// @desc    Get seller dashboard stats
// @route   GET /api/products/seller-stats
// @access  Seller
const getSellerStats = async (req, res, next) => {
  try {
    const sellerId = req.user._id;

    const [productStats, revenueStats, topProducts] = await Promise.all([
      Product.aggregate([
        { $match: { seller: sellerId } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalStock: { $sum: '$stock' },
          },
        },
      ]),
      Product.aggregate([
        { $match: { seller: sellerId } },
        {
          $group: {
            _id: null,
            totalSales: { $sum: '$sales' },
            totalRevenue: { $sum: '$revenue' },
            totalViews: { $sum: '$views' },
          },
        },
      ]),
      Product.find({ seller: sellerId, status: 'active' })
        .sort({ sales: -1 })
        .limit(5)
        .select('name price sales revenue images')
        .lean(),
    ]);

    return ApiResponse.success(res, { productStats, revenueStats, topProducts });
  } catch (err) {
    next(err);
  }
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
