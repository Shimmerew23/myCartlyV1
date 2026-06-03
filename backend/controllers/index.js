const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { sendEmail, emailTemplates } = require('../utils/email');
const { cache } = require('../config/redis');
const logger = require('../utils/logger');
const slugify = require('slugify');
const sharp = require('sharp');
const { uploadBuffer, deleteImage } = require('../config/cloudinary');
const { Prisma } = require('@prisma/client');
const { prisma } = require('../config/prisma');
const userService = require('../services/userService');
const productService = require('../services/productService');
const cartService = require('../services/cartService');
const reviewService = require('../services/reviewService');
const orderService = require('../services/orderService');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================
// USER CONTROLLER
// ============================================================

const updateProfile = async (req, res, next) => {
  try {
    const allowedFields = ['name', 'phone', 'dateOfBirth', 'gender', 'preferences'];
    const updateData = {};
    allowedFields.forEach((f) => { if (req.body[f] !== undefined) updateData[f] = req.body[f]; });
    if (updateData.dateOfBirth) updateData.dateOfBirth = new Date(updateData.dateOfBirth);

    if (req.processedImage) {
      const existing = await prisma.user.findUnique({ where: { id: req.user._id }, select: { avatarPublicId: true } });
      await deleteImage(existing?.avatarPublicId);
      updateData.avatar = req.processedImage.url;
      updateData.avatarPublicId = req.processedImage.public_id;
    }

    const user = await prisma.user.update({
      where: { id: req.user._id },
      data: updateData,
      include: { addresses: true, sellerProfile: true },
    });

    return ApiResponse.success(res, userService.toSafeObject(user), 'Profile updated');
  } catch (err) { next(err); }
};

const addAddress = async (req, res, next) => {
  try {
    if (req.body.isDefault) {
      await prisma.address.updateMany({ where: { userId: req.user._id }, data: { isDefault: false } });
    }
    await prisma.address.create({ data: { ...userService.pickAddressFields(req.body), userId: req.user._id } });
    const addresses = await prisma.address.findMany({ where: { userId: req.user._id } });
    return ApiResponse.success(res, addresses.map(userService.serializeAddress), 'Address added');
  } catch (err) { next(err); }
};

const updateAddress = async (req, res, next) => {
  try {
    const addr = await prisma.address.findFirst({ where: { id: req.params.addressId, userId: req.user._id } });
    if (!addr) return next(ApiError.notFound('Address not found'));

    if (req.body.isDefault) {
      await prisma.address.updateMany({ where: { userId: req.user._id }, data: { isDefault: false } });
    }
    await prisma.address.update({ where: { id: addr.id }, data: userService.pickAddressFields(req.body) });

    const addresses = await prisma.address.findMany({ where: { userId: req.user._id } });
    return ApiResponse.success(res, addresses.map(userService.serializeAddress), 'Address updated');
  } catch (err) { next(err); }
};

const deleteAddress = async (req, res, next) => {
  try {
    await prisma.address.deleteMany({ where: { id: req.params.addressId, userId: req.user._id } });
    const addresses = await prisma.address.findMany({ where: { userId: req.user._id } });
    return ApiResponse.success(res, addresses.map(userService.serializeAddress), 'Address deleted');
  } catch (err) { next(err); }
};

const upgradeToSeller = async (req, res, next) => {
  try {
    const { storeName, storeBio } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user._id } });

    if (user.role === 'seller') {
      return next(ApiError.conflict('Already a seller'));
    }

    const storeSlug = slugify(storeName, { lower: true, strict: true });
    const slugExists = await prisma.sellerProfile.findUnique({ where: { storeSlug } });
    if (slugExists) return next(ApiError.conflict('Store name already taken'));

    const profileData = { storeName, storeBio, storeSlug, isApproved: false };
    if (req.processedImage) profileData.storeLogo = req.processedImage.url;

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        role: 'seller',
        sellerProfile: { upsert: { create: profileData, update: profileData } },
      },
      include: { addresses: true, sellerProfile: true },
    });

    logger.info(`User upgraded to seller: ${user.email}`);
    return ApiResponse.success(res, userService.toSafeObject(updated), 'Seller application submitted. Awaiting admin approval.');
  } catch (err) { next(err); }
};

const updateSellerProfile = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user._id }, include: { sellerProfile: true } });
    if (!user || !['seller', 'admin', 'superadmin'].includes(user.role)) {
      return next(ApiError.forbidden('Seller account required'));
    }

    const { storeName, storeBio, storeEmail, storePhone, returnPolicy, shippingPolicy } = req.body;
    let socialLinks;
    if (req.body.socialLinks) {
      try { socialLinks = typeof req.body.socialLinks === 'string' ? JSON.parse(req.body.socialLinks) : req.body.socialLinks; } catch { /* ignore */ }
    }

    const data = {};
    if (storeName !== undefined) data.storeName = storeName;
    if (storeBio !== undefined) data.storeBio = storeBio;
    if (storeEmail !== undefined) data.storeEmail = storeEmail;
    if (storePhone !== undefined) data.storePhone = storePhone;
    if (returnPolicy !== undefined) data.returnPolicy = returnPolicy;
    if (shippingPolicy !== undefined) data.shippingPolicy = shippingPolicy;
    if (socialLinks) data.socialLinks = socialLinks;

    if (req.files?.storeLogo?.[0]) {
      await deleteImage(user.sellerProfile?.storeLogoPublicId);
      const buffer = await sharp(req.files.storeLogo[0].buffer)
        .resize(400, 400, { fit: 'inside' })
        .toFormat('webp', { quality: 85 })
        .toBuffer();
      const { url, public_id } = await uploadBuffer(buffer, { folder: 'cartly/avatars', format: 'webp' });
      data.storeLogo = url;
      data.storeLogoPublicId = public_id;
    }
    if (req.files?.storeBanner?.[0]) {
      await deleteImage(user.sellerProfile?.storeBannerPublicId);
      const buffer = await sharp(req.files.storeBanner[0].buffer)
        .resize(1200, 400, { fit: 'inside' })
        .toFormat('webp', { quality: 85 })
        .toBuffer();
      const { url, public_id } = await uploadBuffer(buffer, { folder: 'cartly/banners', format: 'webp' });
      data.storeBanner = url;
      data.storeBannerPublicId = public_id;
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { sellerProfile: { upsert: { create: data, update: data } } },
      include: { addresses: true, sellerProfile: true },
    });

    return ApiResponse.success(res, userService.toSafeObject(updated), 'Store profile updated');
  } catch (err) { next(err); }
};

const getSellerStore = async (req, res, next) => {
  try {
    const profile = await prisma.sellerProfile.findUnique({
      where: { storeSlug: req.params.slug },
      include: { user: true },
    });
    if (!profile || !profile.user) return next(ApiError.notFound('Store not found'));

    const products = await prisma.product.findMany({
      where: { sellerId: profile.userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { images: true, category: true },
    });

    const seller = {
      _id: profile.user.id,
      id: profile.user.id,
      name: profile.user.name,
      createdAt: profile.user.createdAt,
      sellerProfile: userService.serializeSellerProfile(profile),
    };

    return ApiResponse.success(res, { seller, products: products.map(productService.serializeProduct) });
  } catch (err) { next(err); }
};

const getWishlist = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user._id }, select: { wishlist: true } });
    const products = await productService.getWishlistProducts(user.wishlist || []);
    return ApiResponse.success(res, products);
  } catch (err) { next(err); }
};

// ============================================================
// CART CONTROLLER
// ============================================================

const getCart = async (req, res, next) => {
  const { cart, productMap, payload } = await cartService.loadSerializedCart(req.user._id);

  // Filter out unavailable products (missing or not active) and persist removal.
  const invalidIds = (cart.items || [])
    .filter((i) => { const p = productMap.get(i.productId); return !p || p.status !== 'active'; })
    .map((i) => i.id);

  if (invalidIds.length) {
    await prisma.cartItem.deleteMany({ where: { id: { in: invalidIds } } });
    const reloaded = await cartService.loadSerializedCart(req.user._id);
    return ApiResponse.success(res, reloaded.payload);
  }

  return ApiResponse.success(res, payload);
};

const addToCart = async (req, res, next) => {
  const { productId, quantity = 1, variant } = req.body;

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return next(ApiError.notFound('Product not found'));
  if (product.status !== 'active') return next(ApiError.badRequest('Product unavailable'));
  if (product.trackInventory && product.stock < quantity) {
    return next(ApiError.badRequest(`Only ${product.stock} items in stock`));
  }

  const cart = await cartService.getOrCreateCart(req.user._id);
  const existing = (cart.items || []).find(
    (item) => item.productId === productId && (item.variantValue ?? undefined) === (variant?.value ?? undefined)
  );

  if (existing) {
    const newQty = existing.quantity + quantity;
    if (product.trackInventory && newQty > product.stock) {
      return next(ApiError.badRequest(`Only ${product.stock} items available`));
    }
    await prisma.cartItem.update({ where: { id: existing.id }, data: { quantity: newQty } });
  } else {
    const snapshot = productService.computeDiscountedPrice(product.price, product.discount) || product.price;
    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productId,
        quantity,
        variantName: variant?.name,
        variantValue: variant?.value,
        price: snapshot,
      },
    });
  }

  await prisma.cart.update({ where: { id: cart.id }, data: { lastModified: new Date() } });
  const { payload } = await cartService.loadSerializedCart(req.user._id);
  return ApiResponse.success(res, payload, 'Added to cart');
};

const updateCartItem = async (req, res, next) => {
  const { quantity } = req.body;
  const cart = await cartService.getOrCreateCart(req.user._id);
  const item = (cart.items || []).find((i) => i.id === req.params.itemId);
  if (!item) return next(ApiError.notFound('Cart item not found'));

  if (quantity <= 0) {
    await prisma.cartItem.delete({ where: { id: item.id } });
  } else {
    const product = await prisma.product.findUnique({ where: { id: item.productId } });
    if (product?.trackInventory && quantity > product.stock) {
      return next(ApiError.badRequest(`Only ${product.stock} items available`));
    }
    await prisma.cartItem.update({ where: { id: item.id }, data: { quantity } });
  }

  const { payload } = await cartService.loadSerializedCart(req.user._id);
  return ApiResponse.success(res, payload);
};

const removeFromCart = async (req, res, next) => {
  await prisma.cartItem.deleteMany({
    where: { id: req.params.itemId, cart: { userId: req.user._id } },
  });
  const { payload } = await cartService.loadSerializedCart(req.user._id);
  return ApiResponse.success(res, payload, 'Item removed');
};

const clearCart = async (req, res, next) => {
  const cart = await prisma.cart.findUnique({ where: { userId: req.user._id } });
  if (cart) {
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    await prisma.cart.update({
      where: { id: cart.id },
      data: { couponCode: null, couponType: null, couponValue: null, couponValidUntil: null },
    });
  }
  return ApiResponse.success(res, null, 'Cart cleared');
};

const applyCoupon = async (req, res, next) => {
  const { code } = req.body;
  const coupon = await prisma.coupon.findFirst({ where: { code: code.toUpperCase(), isActive: true } });

  if (!coupon) return next(ApiError.notFound('Invalid coupon code'));
  if (coupon.validUntil < new Date()) return next(ApiError.badRequest('Coupon has expired'));
  if (coupon.validFrom > new Date()) return next(ApiError.badRequest('Coupon not yet active'));
  if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
    return next(ApiError.badRequest('Coupon usage limit reached'));
  }

  const userUsage = await prisma.couponUsage.count({ where: { couponId: coupon.id, userId: req.user._id } });
  if (userUsage >= coupon.userUsageLimit) {
    return next(ApiError.badRequest('You have already used this coupon'));
  }

  const cart = await prisma.cart.findUnique({ where: { userId: req.user._id }, include: { items: true } });
  if (!cart) return next(ApiError.notFound('Cart not found'));

  const subtotal = cartService.computeSubtotal(cart.items || []);
  if (subtotal < coupon.minimumOrderAmount) {
    return next(ApiError.badRequest(`Minimum order amount is $${coupon.minimumOrderAmount}`));
  }

  await prisma.cart.update({
    where: { id: cart.id },
    data: {
      couponCode: coupon.code,
      couponType: coupon.discountType,
      couponValue: coupon.discountValue,
      couponValidUntil: coupon.validUntil,
    },
  });

  const couponPayload = {
    code: coupon.code,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    validUntil: coupon.validUntil,
  };
  return ApiResponse.success(res, { coupon: couponPayload, subtotal });
};

// ============================================================
// REVIEW CONTROLLER
// ============================================================

const REVIEW_SORT_MAP = {
  '-createdAt': { createdAt: 'desc' },
  '-helpfulVotes': { helpfulVotes: 'desc' },
  '-rating': { rating: 'desc' },
  rating: { rating: 'asc' },
};

const pickReviewFields = (b) => {
  const out = {};
  if (b.rating !== undefined) out.rating = b.rating;
  if (b.title !== undefined) out.title = b.title;
  if (b.body !== undefined) out.body = b.body;
  if (b.images !== undefined) out.images = b.images;
  return out;
};

const getProductReviews = async (req, res, next) => {
  const { productId } = req.params;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, parseInt(req.query.limit, 10) || 10);

  const where = { productId, isApproved: true };
  if (req.query.rating) where.rating = parseInt(req.query.rating, 10);

  const orderBy = REVIEW_SORT_MAP[req.query.sort] || { createdAt: 'desc' };

  const [reviews, total] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      include: { user: reviewService.REVIEW_USER_SELECT },
    }),
    prisma.review.count({ where }),
  ]);

  return ApiResponse.paginated(res, reviews.map(reviewService.serializeReview), {
    page, limit, total, pages: Math.ceil(total / limit),
  });
};

const createReview = async (req, res, next) => {
  const { productId } = req.params;
  if (!UUID_RE.test(productId)) return next(ApiError.notFound('Product not found'));

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return next(ApiError.notFound('Product not found'));

  const existing = await prisma.review.findUnique({ where: { productId_userId: { productId, userId: req.user._id } } });
  if (existing) return next(ApiError.conflict('Already reviewed this product'));

  const purchasedOrder = await prisma.order.findFirst({
    where: { userId: req.user._id, status: 'delivered', items: { some: { productId } } },
  });

  const review = await prisma.review.create({
    data: {
      ...pickReviewFields(req.body),
      productId,
      userId: req.user._id,
      isVerifiedPurchase: !!purchasedOrder,
    },
    include: { user: reviewService.REVIEW_USER_SELECT },
  });

  await reviewService.recomputeProductRating(productId);
  return ApiResponse.created(res, reviewService.serializeReview(review), 'Review submitted');
};

const updateReview = async (req, res, next) => {
  if (!UUID_RE.test(req.params.reviewId)) return next(ApiError.notFound('Review not found'));
  const review = await prisma.review.findUnique({ where: { id: req.params.reviewId } });
  if (!review) return next(ApiError.notFound('Review not found'));
  if (review.userId !== req.user._id) return next(ApiError.forbidden());

  const updated = await prisma.review.update({
    where: { id: review.id },
    data: pickReviewFields(req.body),
    include: { user: reviewService.REVIEW_USER_SELECT },
  });
  await reviewService.recomputeProductRating(review.productId);
  return ApiResponse.success(res, reviewService.serializeReview(updated), 'Review updated');
};

const deleteReview = async (req, res, next) => {
  if (!UUID_RE.test(req.params.reviewId)) return next(ApiError.notFound('Review not found'));
  const review = await prisma.review.findUnique({ where: { id: req.params.reviewId } });
  if (!review) return next(ApiError.notFound('Review not found'));

  const isOwner = review.userId === req.user._id;
  const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
  if (!isOwner && !isAdmin) return next(ApiError.forbidden());

  await prisma.review.delete({ where: { id: review.id } });
  await reviewService.recomputeProductRating(review.productId);
  return ApiResponse.success(res, null, 'Review deleted');
};

const voteHelpful = async (req, res, next) => {
  await prisma.review.updateMany({ where: { id: req.params.reviewId }, data: { helpfulVotes: { increment: 1 } } });
  return ApiResponse.success(res, null, 'Vote recorded');
};

// ============================================================
// ADMIN CONTROLLER
// ============================================================

const getDashboardStats = async (req, res, next) => {
  const cacheKey = 'admin:dashboard';
  const cached = await cache.get(cacheKey);
  if (cached) return ApiResponse.success(res, cached);

  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const [
    totalUsers, newUsersThisMonth,
    totalSellers, pendingSellerApprovals,
    totalProducts, activeProducts,
    totalOrders, ordersThisMonth,
    revenueStats, revenueLastMonth,
    ordersByStatusRaw,
    recentOrders,
    topSellingProducts,
    categoryStatsRaw,
  ] = await Promise.all([
    prisma.user.count({ where: { role: { in: ['user', 'seller'] } } }),
    prisma.user.count({ where: { createdAt: { gte: thisMonth } } }),
    prisma.user.count({ where: { role: 'seller' } }),
    prisma.user.count({ where: { role: 'seller', sellerProfile: { isApproved: false } } }),
    prisma.product.count(),
    prisma.product.count({ where: { status: 'active' } }),
    prisma.order.count(),
    prisma.order.count({ where: { createdAt: { gte: thisMonth } } }),
    prisma.order.aggregate({ _sum: { totalPrice: true }, _count: true, where: { paymentStatus: 'paid', createdAt: { gte: thisMonth } } }),
    prisma.order.aggregate({ _sum: { totalPrice: true }, where: { paymentStatus: 'paid', createdAt: { gte: lastMonth, lt: thisMonth } } }),
    prisma.order.groupBy({ by: ['status'], _count: { status: true } }),
    prisma.order.findMany({ orderBy: { createdAt: 'desc' }, take: 5, include: { ...orderService.ORDER_INCLUDE, user: true } }),
    prisma.product.findMany({ where: { status: 'active' }, orderBy: { sales: 'desc' }, take: 5, include: productService.PRODUCT_INCLUDE }),
    prisma.category.findMany({ take: 8, orderBy: { products: { _count: 'desc' } }, select: { name: true, _count: { select: { products: true } } } }),
  ]);

  const thisMonthRevenue = revenueStats._sum.totalPrice || 0;
  const lastMonthRevenue = revenueLastMonth._sum.totalPrice || 0;
  const revenueGrowth = lastMonthRevenue
    ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100
    : 0;

  const data = {
    users: { total: totalUsers, newThisMonth: newUsersThisMonth },
    sellers: { total: totalSellers, pendingApprovals: pendingSellerApprovals },
    products: { total: totalProducts, active: activeProducts },
    orders: {
      total: totalOrders,
      thisMonth: ordersThisMonth,
      byStatus: ordersByStatusRaw.map((g) => ({ _id: g.status, count: g._count.status })),
    },
    revenue: {
      thisMonth: thisMonthRevenue,
      lastMonth: lastMonthRevenue,
      growth: Math.round(revenueGrowth * 10) / 10,
    },
    recentOrders: recentOrders.map((o) => orderService.serializeOrder(o)),
    topSellingProducts: topSellingProducts.map(productService.serializeProduct),
    categoryStats: categoryStatsRaw.map((c) => ({ name: c.name, productCount: c._count.products })),
  };

  await cache.set(cacheKey, data, 120); // 2 min cache
  return ApiResponse.success(res, data);
};

const USER_SORT_MAP = {
  '-createdAt': { createdAt: 'desc' },
  createdAt: { createdAt: 'asc' },
  name: { name: 'asc' },
  '-name': { name: 'desc' },
  role: { role: 'asc' },
};

const getAllUsers = async (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 20);
  const skip = (page - 1) * limit;

  const where = {};
  if (req.query.role) where.role = req.query.role;
  if (req.query.isActive !== undefined) where.isActive = req.query.isActive === 'true';
  if (req.query.isBanned !== undefined) where.isBanned = req.query.isBanned === 'true';
  if (req.query.search) {
    where.OR = [
      { name: { contains: req.query.search, mode: 'insensitive' } },
      { email: { contains: req.query.search, mode: 'insensitive' } },
    ];
  }

  const orderBy = USER_SORT_MAP[req.query.sort] || { createdAt: 'desc' };

  const [users, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy, skip, take: limit }),
    prisma.user.count({ where }),
  ]);

  return ApiResponse.paginated(res, users.map((u) => userService.toSafeObject(u)), {
    page, limit, total, pages: Math.ceil(total / limit),
  });
};

const updateUser = async (req, res, next) => {
  if (!UUID_RE.test(req.params.userId)) return next(ApiError.notFound('User not found'));

  const allowedFields = ['role', 'isActive', 'isBanned', 'banReason'];
  if (req.user.role !== 'superadmin') {
    allowedFields.splice(allowedFields.indexOf('role'), 1);
  }

  const updateData = {};
  allowedFields.forEach((f) => { if (req.body[f] !== undefined) updateData[f] = req.body[f]; });
  if (updateData.isBanned) updateData.bannedAt = new Date();

  const existing = await prisma.user.findUnique({ where: { id: req.params.userId } });
  if (!existing) return next(ApiError.notFound('User not found'));

  const user = await prisma.user.update({ where: { id: req.params.userId }, data: updateData });
  logger.info(`Admin ${req.user.email} updated user ${user.email}`);
  return ApiResponse.success(res, userService.toSafeObject(user), 'User updated');
};

const deleteUser = async (req, res, next) => {
  if (!UUID_RE.test(req.params.userId)) return next(ApiError.notFound('User not found'));
  const user = await prisma.user.findUnique({ where: { id: req.params.userId } });
  if (!user) return next(ApiError.notFound('User not found'));
  if (user.role === 'superadmin') return next(ApiError.forbidden('Cannot delete superadmin'));

  await prisma.user.update({ where: { id: user.id }, data: { isActive: false, isBanned: true } });
  logger.info(`Admin ${req.user.email} deactivated user ${user.email}`);
  return ApiResponse.success(res, null, 'User deactivated');
};

const approveSeller = async (req, res, next) => {
  if (!UUID_RE.test(req.params.userId)) return next(ApiError.notFound('Seller not found'));
  const user = await prisma.user.findUnique({ where: { id: req.params.userId } });
  if (!user || user.role !== 'seller') return next(ApiError.notFound('Seller not found'));

  await prisma.sellerProfile.upsert({
    where: { userId: user.id },
    update: { isApproved: true, approvedAt: new Date() },
    create: { userId: user.id, isApproved: true, approvedAt: new Date() },
  });

  try {
    const { subject, html } = emailTemplates.sellerApproval(user.name);
    await sendEmail({ to: user.email, subject, html });
  } catch (e) { logger.error(`Seller approval email failed: ${e.message}`); }

  logger.info(`Seller approved: ${user.email} by ${req.user.email}`);
  return ApiResponse.success(res, null, 'Seller approved successfully');
};

const ORDER_SORT_MAP = {
  '-createdAt': { createdAt: 'desc' },
  createdAt: { createdAt: 'asc' },
  '-totalPrice': { totalPrice: 'desc' },
  totalPrice: { totalPrice: 'asc' },
};

const getAllOrders = async (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 20);
  const skip = (page - 1) * limit;

  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.paymentStatus) where.paymentStatus = req.query.paymentStatus;
  if (req.query.search) where.orderNumber = { contains: req.query.search, mode: 'insensitive' };

  const orderBy = ORDER_SORT_MAP[req.query.sort] || { createdAt: 'desc' };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({ where, orderBy, skip, take: limit, include: { ...orderService.ORDER_INCLUDE, user: true } }),
    prisma.order.count({ where }),
  ]);

  return ApiResponse.paginated(res, orders.map((o) => orderService.serializeOrder(o)), {
    page, limit, total, pages: Math.ceil(total / limit),
  });
};

const getAllProducts = async (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 20);
  const skip = (page - 1) * limit;

  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.seller) where.sellerId = req.query.seller;

  if (req.query.search) {
    const filters = [];
    if (req.query.status) filters.push(Prisma.sql`p."status"::text = ${req.query.status}`);
    if (req.query.seller) filters.push(Prisma.sql`p."sellerId" = ${req.query.seller}::uuid`);
    const { ids, total } = await productService.searchProductIds({ term: req.query.search, filters, skip, take: limit });
    const rows = await prisma.product.findMany({ where: { id: { in: ids } }, include: productService.PRODUCT_INCLUDE });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const products = ids.map((id) => byId.get(id)).filter(Boolean).map(productService.serializeProduct);
    return ApiResponse.paginated(res, products, { page, limit, total, pages: Math.ceil(total / limit) });
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit, include: productService.PRODUCT_INCLUDE }),
    prisma.product.count({ where }),
  ]);

  return ApiResponse.paginated(res, products.map(productService.serializeProduct), {
    page, limit, total, pages: Math.ceil(total / limit),
  });
};

const serializeAuditLog = (l) => ({
  _id: l.id,
  id: l.id,
  user: l.user ? { _id: l.user.id, id: l.user.id, name: l.user.name, email: l.user.email, role: l.user.role } : (l.userId ?? undefined),
  action: l.action,
  resource: l.resource ?? undefined,
  resourceId: l.resourceId ?? undefined,
  method: l.method ?? undefined,
  path: l.path ?? undefined,
  statusCode: l.statusCode ?? undefined,
  ip: l.ip ?? undefined,
  userAgent: l.userAgent ?? undefined,
  before: l.before ?? undefined,
  after: l.after ?? undefined,
  metadata: l.metadata ?? undefined,
  createdAt: l.createdAt,
});

const getAuditLogs = async (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 20);

  const where = {};
  if (req.query.user) where.userId = req.query.user;
  if (req.query.action) where.action = req.query.action;
  if (req.query.resource) where.resource = req.query.resource;

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return ApiResponse.paginated(res, logs.map(serializeAuditLog), {
    page, limit, total, pages: Math.ceil(total / limit),
  });
};

// Coupon management
const serializeCoupon = (c) => ({
  _id: c.id,
  id: c.id,
  code: c.code,
  description: c.description ?? undefined,
  discountType: c.discountType,
  discountValue: c.discountValue,
  minimumOrderAmount: c.minimumOrderAmount,
  maximumDiscountAmount: c.maximumDiscountAmount ?? undefined,
  usageLimit: c.usageLimit ?? undefined,
  usageCount: c.usageCount,
  userUsageLimit: c.userUsageLimit,
  usedBy: (c.usedBy || []).map((u) => ({ user: u.userId, usedAt: u.usedAt })),
  validFrom: c.validFrom,
  validUntil: c.validUntil,
  isActive: c.isActive,
  applicableCategories: c.applicableCategories || [],
  applicableProducts: c.applicableProducts || [],
  createdBy: c.createdById ?? undefined,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

const createCoupon = async (req, res, next) => {
  const b = req.body;
  const coupon = await prisma.coupon.create({
    data: {
      code: String(b.code).toUpperCase(),
      description: b.description,
      discountType: b.discountType,
      discountValue: b.discountValue,
      minimumOrderAmount: b.minimumOrderAmount,
      maximumDiscountAmount: b.maximumDiscountAmount,
      usageLimit: b.usageLimit,
      userUsageLimit: b.userUsageLimit,
      validFrom: new Date(b.validFrom),
      validUntil: new Date(b.validUntil),
      isActive: b.isActive,
      applicableCategories: b.applicableCategories || [],
      applicableProducts: b.applicableProducts || [],
      createdById: req.user._id,
    },
    include: { usedBy: true },
  });
  return ApiResponse.created(res, serializeCoupon(coupon), 'Coupon created');
};

const getCoupons = async (req, res, next) => {
  const coupons = await prisma.coupon.findMany({ orderBy: { createdAt: 'desc' }, include: { usedBy: true } });
  return ApiResponse.success(res, coupons.map(serializeCoupon));
};

const deleteCoupon = async (req, res, next) => {
  await prisma.coupon.deleteMany({ where: { id: req.params.id } });
  return ApiResponse.success(res, null, 'Coupon deleted');
};

// Category management
const createCategory = async (req, res, next) => {
  try {
    const slug = slugify(req.body.name, { lower: true, strict: true });
    const { name, description, image, icon, parent, sortOrder, seo } = req.body;
    const category = await prisma.category.create({
      data: {
        name, slug,
        description, image, icon,
        parentId: parent || null,
        sortOrder: sortOrder ?? 0,
        seo: seo ?? undefined,
      },
    });
    await cache.del('categories:all');
    await cache.flush('cache:categories:*');
    return ApiResponse.created(res, productService.serializeCategory(category));
  } catch (err) { next(err); }
};

const getCategories = async (req, res, next) => {
  try {
    const cacheKey = 'categories:all';
    const cached = await cache.get(cacheKey);
    if (cached) return ApiResponse.success(res, cached);

    const categories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const data = categories.map(productService.serializeCategory);
    await cache.set(cacheKey, data, 600);
    return ApiResponse.success(res, data);
  } catch (err) { next(err); }
};

const updateCategory = async (req, res, next) => {
  try {
    const { name, description, image, icon, parent, sortOrder, isActive, seo } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (image !== undefined) data.image = image;
    if (icon !== undefined) data.icon = icon;
    if (parent !== undefined) data.parentId = parent || null;
    if (sortOrder !== undefined) data.sortOrder = sortOrder;
    if (isActive !== undefined) data.isActive = isActive;
    if (seo !== undefined) data.seo = seo;

    const category = await prisma.category.update({ where: { id: req.params.id }, data }).catch(() => null);
    if (!category) return next(ApiError.notFound('Category not found'));
    await cache.del('categories:all');
    return ApiResponse.success(res, productService.serializeCategory(category), 'Category updated');
  } catch (err) { next(err); }
};

const deleteCategory = async (req, res, next) => {
  try {
    await prisma.category.update({ where: { id: req.params.id }, data: { isActive: false } }).catch(() => null);
    await cache.del('categories:all');
    return ApiResponse.success(res, null, 'Category deactivated');
  } catch (err) { next(err); }
};

const ADMIN_PRODUCT_FIELDS = [
  'name', 'description', 'shortDescription', 'price', 'compareAtPrice', 'costPrice',
  'currency', 'subcategory', 'tags', 'brand', 'sku', 'stock', 'lowStockThreshold',
  'trackInventory', 'hasVariants', 'status', 'isFeatured', 'isTrending', 'isNewArrival',
  'seo', 'shipping', 'discount', 'categoryId',
];

const adminUpdateProduct = async (req, res, next) => {
  if (!UUID_RE.test(req.params.id)) return next(ApiError.notFound('Product not found'));

  const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!existing) return next(ApiError.notFound('Product not found'));

  const body = productService.normalizeProductBody(req.body);
  const data = {};
  ADMIN_PRODUCT_FIELDS.forEach((f) => { if (body[f] !== undefined) data[f] = body[f]; });

  const product = await prisma.product.update({ where: { id: req.params.id }, data, include: productService.PRODUCT_INCLUDE });
  await cache.flush('cache:products:*');
  return ApiResponse.success(res, productService.serializeProduct(product), 'Product updated');
};

// ============================================================
// FEEDBACK CONTROLLER
// ============================================================

const FEEDBACK_USER_SELECT = { select: { id: true, name: true, email: true, role: true, avatar: true } };

const serializeFeedback = (f) => ({
  _id: f.id,
  id: f.id,
  user: f.user
    ? { _id: f.user.id, id: f.user.id, name: f.user.name, email: f.user.email, role: f.user.role, avatar: f.user.avatar ?? undefined }
    : (f.userId ?? undefined),
  guestName: f.guestName ?? undefined,
  guestEmail: f.guestEmail ?? undefined,
  category: f.category,
  subject: f.subject,
  message: f.message,
  rating: f.rating ?? undefined,
  status: f.status,
  adminNote: f.adminNote ?? undefined,
  createdAt: f.createdAt,
  updatedAt: f.updatedAt,
});

const submitFeedback = async (req, res, next) => {
  const { category, subject, message, rating, guestName, guestEmail } = req.body;
  const isGuest = !req.user;

  if (!category || !subject?.trim() || !message?.trim()) {
    return next(ApiError.badRequest('Category, subject, and message are required.'));
  }
  if (isGuest && message.trim().length > 300) {
    return next(ApiError.badRequest('Message must be 300 characters or fewer for guest submissions.'));
  }

  const feedback = await prisma.feedback.create({
    data: {
      userId: req.user ? req.user._id : undefined,
      guestName: isGuest && guestName ? guestName : undefined,
      guestEmail: isGuest && guestEmail ? guestEmail : undefined,
      category,
      subject,
      message,
      rating: rating || undefined,
    },
  });
  return ApiResponse.created(res, serializeFeedback(feedback), 'Feedback submitted. Thank you!');
};

const getFeedbacks = async (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 20);

  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.category) where.category = req.query.category;

  const [feedbacks, total] = await Promise.all([
    prisma.feedback.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { user: FEEDBACK_USER_SELECT },
    }),
    prisma.feedback.count({ where }),
  ]);

  return ApiResponse.paginated(res, feedbacks.map(serializeFeedback), {
    page, limit, total, pages: Math.ceil(total / limit),
  });
};

const updateFeedbackStatus = async (req, res, next) => {
  if (!UUID_RE.test(req.params.id)) return next(ApiError.notFound('Feedback not found'));
  const { status, adminNote } = req.body;

  const existing = await prisma.feedback.findUnique({ where: { id: req.params.id } });
  if (!existing) return next(ApiError.notFound('Feedback not found'));

  const feedback = await prisma.feedback.update({
    where: { id: req.params.id },
    data: { ...(status ? { status } : {}), ...(adminNote !== undefined ? { adminNote } : {}) },
    include: { user: FEEDBACK_USER_SELECT },
  });
  return ApiResponse.success(res, serializeFeedback(feedback), 'Feedback updated');
};

module.exports = {
  updateProfile, addAddress, updateAddress, deleteAddress,
  upgradeToSeller, updateSellerProfile, getSellerStore, getWishlist,
  getCart, addToCart, updateCartItem, removeFromCart, clearCart, applyCoupon,
  getProductReviews, createReview, updateReview, deleteReview, voteHelpful,
  getDashboardStats, getAllUsers, updateUser, deleteUser, approveSeller,
  getAllOrders, getAllProducts, getAuditLogs,
  createCoupon, getCoupons, deleteCoupon,
  createCategory, getCategories, updateCategory, deleteCategory,
  adminUpdateProduct,
  submitFeedback, getFeedbacks, updateFeedbackStatus,
};
