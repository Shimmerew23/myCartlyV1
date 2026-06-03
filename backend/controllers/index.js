const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { Cart, Review, Category, AuditLog, Coupon, Feedback } = require('../models/index');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { sendEmail, emailTemplates } = require('../utils/email');
const { cache } = require('../config/redis');
const logger = require('../utils/logger');
const slugify = require('slugify');
const sharp = require('sharp');
const { uploadBuffer, deleteImage } = require('../config/cloudinary');
const { prisma } = require('../config/prisma');
const userService = require('../services/userService');
const productService = require('../services/productService');
const cartService = require('../services/cartService');

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

const getProductReviews = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 10);

    const filter = { product: productId, isApproved: true };
    if (req.query.rating) filter.rating = parseInt(req.query.rating);

    const sortMap = {
      '-createdAt': { createdAt: -1 },
      '-helpfulVotes': { helpfulVotes: -1 },
      '-rating': { rating: -1 },
      rating: { rating: 1 },
    };
    const sort = sortMap[req.query.sort] || { createdAt: -1 };

    const [reviews, total] = await Promise.all([
      Review.find(filter)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('user', 'name avatar')
        .lean(),
      Review.countDocuments(filter),
    ]);

    return ApiResponse.paginated(res, reviews, {
      page, limit, total, pages: Math.ceil(total / limit),
    });
  } catch (err) { next(err); }
};

const createReview = async (req, res, next) => {
  try {
    const { productId } = req.params;

    const product = await Product.findById(productId);
    if (!product) return next(ApiError.notFound('Product not found'));

    const existingReview = await Review.findOne({
      product: productId,
      user: req.user._id,
    });
    if (existingReview) return next(ApiError.conflict('Already reviewed this product'));

    // Check if verified purchase
    const purchasedOrder = await Order.findOne({
      user: req.user._id,
      'items.product': productId,
      status: 'delivered',
    });

    const review = await Review.create({
      ...req.body,
      product: productId,
      user: req.user._id,
      isVerifiedPurchase: !!purchasedOrder,
    });

    await review.populate('user', 'name avatar');
    return ApiResponse.created(res, review, 'Review submitted');
  } catch (err) { next(err); }
};

const updateReview = async (req, res, next) => {
  try {
    const review = await Review.findById(req.params.reviewId);
    if (!review) return next(ApiError.notFound('Review not found'));
    if (review.user.toString() !== req.user._id.toString()) {
      return next(ApiError.forbidden());
    }

    Object.assign(review, req.body);
    await review.save();
    return ApiResponse.success(res, review, 'Review updated');
  } catch (err) { next(err); }
};

const deleteReview = async (req, res, next) => {
  try {
    const review = await Review.findById(req.params.reviewId);
    if (!review) return next(ApiError.notFound('Review not found'));

    const isOwner = review.user.toString() === req.user._id.toString();
    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
    if (!isOwner && !isAdmin) return next(ApiError.forbidden());

    await review.deleteOne();
    return ApiResponse.success(res, null, 'Review deleted');
  } catch (err) { next(err); }
};

const voteHelpful = async (req, res, next) => {
  try {
    await Review.findByIdAndUpdate(req.params.reviewId, {
      $inc: { helpfulVotes: 1 },
    });
    return ApiResponse.success(res, null, 'Vote recorded');
  } catch (err) { next(err); }
};

// ============================================================
// ADMIN CONTROLLER
// ============================================================

const getDashboardStats = async (req, res, next) => {
  try {
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
      ordersByStatus,
      recentOrders,
      topSellingProducts,
      categoryStats,
    ] = await Promise.all([
      User.countDocuments({ role: { $in: ['user', 'seller'] } }),
      User.countDocuments({ createdAt: { $gte: thisMonth } }),
      User.countDocuments({ role: 'seller' }),
      User.countDocuments({ role: 'seller', 'sellerProfile.isApproved': false }),
      Product.countDocuments(),
      Product.countDocuments({ status: 'active' }),
      Order.countDocuments(),
      Order.countDocuments({ createdAt: { $gte: thisMonth } }),
      Order.aggregate([
        { $match: { paymentStatus: 'paid', createdAt: { $gte: thisMonth } } },
        { $group: { _id: null, total: { $sum: '$totalPrice' }, count: { $sum: 1 } } },
      ]),
      Order.aggregate([
        { $match: { paymentStatus: 'paid', createdAt: { $gte: lastMonth, $lt: thisMonth } } },
        { $group: { _id: null, total: { $sum: '$totalPrice' } } },
      ]),
      Order.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Order.find().sort('-createdAt').limit(5)
        .populate('user', 'name email').lean(),
      Product.find({ status: 'active' }).sort('-sales').limit(5)
        .select('name price sales revenue images').lean(),
      Category.aggregate([
        { $lookup: { from: 'products', localField: '_id', foreignField: 'category', as: 'products' } },
        { $project: { name: 1, productCount: { $size: '$products' } } },
        { $sort: { productCount: -1 } },
        { $limit: 8 },
      ]),
    ]);

    const thisMonthRevenue = revenueStats[0]?.total || 0;
    const lastMonthRevenue = revenueLastMonth[0]?.total || 0;
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
        byStatus: ordersByStatus,
      },
      revenue: {
        thisMonth: thisMonthRevenue,
        lastMonth: lastMonthRevenue,
        growth: Math.round(revenueGrowth * 10) / 10,
      },
      recentOrders,
      topSellingProducts,
      categoryStats,
    };

    await cache.set(cacheKey, data, 120); // 2 min cache
    return ApiResponse.success(res, data);
  } catch (err) { next(err); }
};

const getAllUsers = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.role) filter.role = req.query.role;
    if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === 'true';
    if (req.query.isBanned !== undefined) filter.isBanned = req.query.isBanned === 'true';
    if (req.query.search) {
      filter.$or = [
        { name: { $regex: req.query.search, $options: 'i' } },
        { email: { $regex: req.query.search, $options: 'i' } },
      ];
    }

    const sortMap = {
      '-createdAt': { createdAt: -1 },
      createdAt: { createdAt: 1 },
      name: { name: 1 },
      '-name': { name: -1 },
      role: { role: 1 },
    };
    const sort = sortMap[req.query.sort] || { createdAt: -1 };

    const [users, total] = await Promise.all([
      User.find(filter).sort(sort).skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
    ]);

    return ApiResponse.paginated(res, users, {
      page, limit, total, pages: Math.ceil(total / limit),
    });
  } catch (err) { next(err); }
};

const updateUser = async (req, res, next) => {
  try {
    const allowedFields = ['role', 'isActive', 'isBanned', 'banReason'];
    if (req.user.role !== 'superadmin') {
      allowedFields.splice(allowedFields.indexOf('role'), 1);
    }

    const updateData = {};
    allowedFields.forEach((f) => { if (req.body[f] !== undefined) updateData[f] = req.body[f]; });
    if (updateData.isBanned) updateData.bannedAt = Date.now();

    const user = await User.findByIdAndUpdate(req.params.userId, updateData, { new: true });
    if (!user) return next(ApiError.notFound('User not found'));

    logger.info(`Admin ${req.user.email} updated user ${user.email}`);
    return ApiResponse.success(res, user.toSafeObject(), 'User updated');
  } catch (err) { next(err); }
};

const deleteUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return next(ApiError.notFound('User not found'));
    if (user.role === 'superadmin') return next(ApiError.forbidden('Cannot delete superadmin'));

    await User.findByIdAndUpdate(req.params.userId, { isActive: false, isBanned: true });
    logger.info(`Admin ${req.user.email} deactivated user ${user.email}`);
    return ApiResponse.success(res, null, 'User deactivated');
  } catch (err) { next(err); }
};

const approveSeller = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user || user.role !== 'seller') return next(ApiError.notFound('Seller not found'));

    user.sellerProfile.isApproved = true;
    user.sellerProfile.approvedAt = Date.now();
    await user.save();

    try {
      const { subject, html } = emailTemplates.sellerApproval(user.name);
      await sendEmail({ to: user.email, subject, html });
    } catch (e) { logger.error(`Seller approval email failed: ${e.message}`); }

    logger.info(`Seller approved: ${user.email} by ${req.user.email}`);
    return ApiResponse.success(res, null, 'Seller approved successfully');
  } catch (err) { next(err); }
};

const getAllOrders = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.paymentStatus) filter.paymentStatus = req.query.paymentStatus;
    if (req.query.search) {
      filter.$or = [
        { orderNumber: { $regex: req.query.search, $options: 'i' } },
      ];
    }

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort(req.query.sort || '-createdAt')
        .skip(skip)
        .limit(limit)
        .populate('user', 'name email')
        .lean(),
      Order.countDocuments(filter),
    ]);

    return ApiResponse.paginated(res, orders, {
      page, limit, total, pages: Math.ceil(total / limit),
    });
  } catch (err) { next(err); }
};

const getAllProducts = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.seller) filter.seller = req.query.seller;
    if (req.query.search) filter.$text = { $search: req.query.search };

    const [products, total] = await Promise.all([
      Product.find(filter)
        .sort(req.query.sort || '-createdAt')
        .skip(skip)
        .limit(limit)
        .populate('category', 'name')
        .populate('seller', 'name email sellerProfile.storeName')
        .lean(),
      Product.countDocuments(filter),
    ]);

    return ApiResponse.paginated(res, products, {
      page, limit, total, pages: Math.ceil(total / limit),
    });
  } catch (err) { next(err); }
};

const getAuditLogs = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);

    const filter = {};
    if (req.query.user) filter.user = req.query.user;
    if (req.query.action) filter.action = req.query.action;
    if (req.query.resource) filter.resource = req.query.resource;

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort('-createdAt')
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('user', 'name email role')
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    return ApiResponse.paginated(res, logs, {
      page, limit, total, pages: Math.ceil(total / limit),
    });
  } catch (err) { next(err); }
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

const adminUpdateProduct = async (req, res, next) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!product) return next(ApiError.notFound('Product not found'));
    await cache.flush('cache:products:*');
    return ApiResponse.success(res, product, 'Product updated');
  } catch (err) { next(err); }
};

// ============================================================
// FEEDBACK CONTROLLER
// ============================================================

const submitFeedback = async (req, res, next) => {
  try {
    const { category, subject, message, rating, guestName, guestEmail } = req.body;
    const isGuest = !req.user;

    if (!category || !subject?.trim() || !message?.trim()) {
      return next(ApiError.badRequest('Category, subject, and message are required.'));
    }
    if (isGuest && message.trim().length > 300) {
      return next(ApiError.badRequest('Message must be 300 characters or fewer for guest submissions.'));
    }

    const feedback = await Feedback.create({
      ...(req.user ? { user: req.user._id } : {}),
      ...(isGuest && guestName ? { guestName } : {}),
      ...(isGuest && guestEmail ? { guestEmail } : {}),
      category,
      subject,
      message,
      ...(rating ? { rating } : {}),
    });
    return ApiResponse.created(res, feedback, 'Feedback submitted. Thank you!');
  } catch (err) { next(err); }
};

const getFeedbacks = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);

    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.category) filter.category = req.query.category;

    const [feedbacks, total] = await Promise.all([
      Feedback.find(filter)
        .sort('-createdAt')
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('user', 'name email role avatar')
        .lean(),
      Feedback.countDocuments(filter),
    ]);

    return ApiResponse.paginated(res, feedbacks, {
      page, limit, total, pages: Math.ceil(total / limit),
    });
  } catch (err) { next(err); }
};

const updateFeedbackStatus = async (req, res, next) => {
  try {
    const { status, adminNote } = req.body;
    const feedback = await Feedback.findByIdAndUpdate(
      req.params.id,
      { ...(status ? { status } : {}), ...(adminNote !== undefined ? { adminNote } : {}) },
      { new: true, runValidators: true }
    ).populate('user', 'name email');

    if (!feedback) return next(ApiError.notFound('Feedback not found'));
    return ApiResponse.success(res, feedback, 'Feedback updated');
  } catch (err) { next(err); }
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
