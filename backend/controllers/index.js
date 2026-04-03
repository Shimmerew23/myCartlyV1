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

// ============================================================
// USER CONTROLLER
// ============================================================

const updateProfile = async (req, res, next) => {
  try {
    const allowedFields = ['name', 'phone', 'dateOfBirth', 'gender', 'preferences'];
    const updateData = {};
    allowedFields.forEach((f) => { if (req.body[f] !== undefined) updateData[f] = req.body[f]; });

    if (req.processedImage) {
      updateData.avatar = req.processedImage.url;
    }

    const user = await User.findByIdAndUpdate(req.user._id, updateData, {
      new: true,
      runValidators: true,
    });

    return ApiResponse.success(res, user.toSafeObject(), 'Profile updated');
  } catch (err) { next(err); }
};

const addAddress = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (req.body.isDefault) {
      user.addresses.forEach((addr) => { addr.isDefault = false; });
    }
    user.addresses.push(req.body);
    await user.save();
    return ApiResponse.success(res, user.addresses, 'Address added');
  } catch (err) { next(err); }
};

const updateAddress = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    const addr = user.addresses.id(req.params.addressId);
    if (!addr) return next(ApiError.notFound('Address not found'));
    if (req.body.isDefault) {
      user.addresses.forEach((a) => { a.isDefault = false; });
    }
    Object.assign(addr, req.body);
    await user.save();
    return ApiResponse.success(res, user.addresses, 'Address updated');
  } catch (err) { next(err); }
};

const deleteAddress = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    user.addresses = user.addresses.filter(
      (a) => a._id.toString() !== req.params.addressId
    );
    await user.save();
    return ApiResponse.success(res, user.addresses, 'Address deleted');
  } catch (err) { next(err); }
};

const upgradeToSeller = async (req, res, next) => {
  try {
    const { storeName, storeBio } = req.body;
    const user = await User.findById(req.user._id);

    if (user.role === 'seller') {
      return next(ApiError.conflict('Already a seller'));
    }

    const storeSlug = slugify(storeName, { lower: true, strict: true });
    const slugExists = await User.findOne({ 'sellerProfile.storeSlug': storeSlug });
    if (slugExists) return next(ApiError.conflict('Store name already taken'));

    user.role = 'seller';
    user.sellerProfile = {
      storeName,
      storeBio,
      storeSlug,
      isApproved: false, // Admin must approve
    };

    if (req.processedImage) {
      user.sellerProfile.storeLogo = req.processedImage.url;
    }

    await user.save();
    logger.info(`User upgraded to seller: ${user.email}`);
    return ApiResponse.success(res, user.toSafeObject(), 'Seller application submitted. Awaiting admin approval.');
  } catch (err) { next(err); }
};

const updateSellerProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || !['seller', 'admin', 'superadmin'].includes(user.role)) {
      return next(ApiError.forbidden('Seller account required'));
    }

    const { storeName, storeBio, storeEmail, storePhone, returnPolicy, shippingPolicy } = req.body;
    let socialLinks;
    if (req.body.socialLinks) {
      try { socialLinks = typeof req.body.socialLinks === 'string' ? JSON.parse(req.body.socialLinks) : req.body.socialLinks; } catch {}
    }

    const update = {};
    if (storeName !== undefined) update['sellerProfile.storeName'] = storeName;
    if (storeBio !== undefined) update['sellerProfile.storeBio'] = storeBio;
    if (storeEmail !== undefined) update['sellerProfile.storeEmail'] = storeEmail;
    if (storePhone !== undefined) update['sellerProfile.storePhone'] = storePhone;
    if (returnPolicy !== undefined) update['sellerProfile.returnPolicy'] = returnPolicy;
    if (shippingPolicy !== undefined) update['sellerProfile.shippingPolicy'] = shippingPolicy;
    if (socialLinks) update['sellerProfile.socialLinks'] = socialLinks;

    if (req.files?.storeLogo?.[0]) {
      const sharp = require('sharp');
      const path = require('path');
      const fs = require('fs');
      const logoFile = req.files.storeLogo[0];
      const dir = 'uploads/avatars';
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const filename = `logo-${Date.now()}.webp`;
      await sharp(logoFile.buffer).resize(400, 400, { fit: 'inside' }).toFormat('webp', { quality: 85 }).toFile(path.join(dir, filename));
      update['sellerProfile.storeLogo'] = `/${dir}/${filename}`;
    }
    if (req.files?.storeBanner?.[0]) {
      const sharp = require('sharp');
      const path = require('path');
      const fs = require('fs');
      const bannerFile = req.files.storeBanner[0];
      const dir = 'uploads/banners';
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const filename = `banner-${Date.now()}.webp`;
      await sharp(bannerFile.buffer).resize(1200, 400, { fit: 'inside' }).toFormat('webp', { quality: 85 }).toFile(path.join(dir, filename));
      update['sellerProfile.storeBanner'] = `/${dir}/${filename}`;
    }

    const updated = await User.findByIdAndUpdate(req.user._id, update, { new: true });
    return ApiResponse.success(res, updated.toSafeObject(), 'Store profile updated');
  } catch (err) { next(err); }
};

const getSellerStore = async (req, res, next) => {
  try {
    const seller = await User.findOne({ 'sellerProfile.storeSlug': req.params.slug })
      .select('name sellerProfile createdAt')
      .lean();
    if (!seller) return next(ApiError.notFound('Store not found'));

    const products = await Product.find({ seller: seller._id, status: 'active' })
      .sort('-createdAt')
      .limit(20)
      .lean();

    return ApiResponse.success(res, { seller, products });
  } catch (err) { next(err); }
};

const getWishlist = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
      .populate({
        path: 'wishlist',
        select: 'name price images slug status rating',
        populate: { path: 'category', select: 'name slug' },
      });
    return ApiResponse.success(res, user.wishlist);
  } catch (err) { next(err); }
};

// ============================================================
// CART CONTROLLER
// ============================================================

const getCart = async (req, res, next) => {
  try {
    let cart = await Cart.findOne({ user: req.user._id })
      .populate({
        path: 'items.product',
        select: 'name price images slug status stock discountedPrice rating seller',
        populate: [
          { path: 'category', select: 'name' },
          { path: 'seller', select: 'name sellerProfile.storeName sellerProfile.storeLogo' },
        ],
      });

    if (!cart) {
      cart = await Cart.create({ user: req.user._id, items: [] });
    }

    // Filter out unavailable products
    const validItems = cart.items.filter(
      (item) => item.product && item.product.status === 'active'
    );
    if (validItems.length !== cart.items.length) {
      cart.items = validItems;
      await cart.save();
    }

    return ApiResponse.success(res, {
      items: cart.items,
      subtotal: cart.subtotal,
      itemCount: cart.itemCount,
      coupon: cart.coupon?.code ? cart.coupon : null,
    });
  } catch (err) { next(err); }
};

const addToCart = async (req, res, next) => {
  try {
    const { productId, quantity = 1, variant } = req.body;

    const product = await Product.findById(productId);
    if (!product) return next(ApiError.notFound('Product not found'));
    if (product.status !== 'active') return next(ApiError.badRequest('Product unavailable'));
    if (product.trackInventory && product.stock < quantity) {
      return next(ApiError.badRequest(`Only ${product.stock} items in stock`));
    }

    let cart = await Cart.findOne({ user: req.user._id });
    if (!cart) cart = await Cart.create({ user: req.user._id, items: [] });

    const existingItemIndex = cart.items.findIndex(
      (item) =>
        item.product.toString() === productId &&
        item.variant?.value === variant?.value
    );

    if (existingItemIndex > -1) {
      const newQty = cart.items[existingItemIndex].quantity + quantity;
      if (product.trackInventory && newQty > product.stock) {
        return next(ApiError.badRequest(`Only ${product.stock} items available`));
      }
      cart.items[existingItemIndex].quantity = newQty;
    } else {
      cart.items.push({
        product: productId,
        quantity,
        variant,
        price: product.discountedPrice || product.price,
      });
    }

    cart.lastModified = Date.now();
    await cart.save();
    await cart.populate({
      path: 'items.product',
      select: 'name price images slug status stock',
      populate: { path: 'seller', select: 'name sellerProfile.storeName sellerProfile.storeLogo' },
    });

    return ApiResponse.success(res, {
      items: cart.items,
      subtotal: cart.subtotal,
      itemCount: cart.itemCount,
    }, 'Added to cart');
  } catch (err) { next(err); }
};

const updateCartItem = async (req, res, next) => {
  try {
    const { quantity } = req.body;
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) return next(ApiError.notFound('Cart not found'));

    const item = cart.items.id(req.params.itemId);
    if (!item) return next(ApiError.notFound('Cart item not found'));

    if (quantity <= 0) {
      cart.items = cart.items.filter((i) => i._id.toString() !== req.params.itemId);
    } else {
      const product = await Product.findById(item.product);
      if (product?.trackInventory && quantity > product.stock) {
        return next(ApiError.badRequest(`Only ${product.stock} items available`));
      }
      item.quantity = quantity;
    }

    await cart.save();
    await cart.populate({
      path: 'items.product',
      select: 'name price images slug status',
      populate: { path: 'seller', select: 'name sellerProfile.storeName sellerProfile.storeLogo' },
    });

    return ApiResponse.success(res, {
      items: cart.items,
      subtotal: cart.subtotal,
      itemCount: cart.itemCount,
    });
  } catch (err) { next(err); }
};

const removeFromCart = async (req, res, next) => {
  try {
    const cart = await Cart.findOneAndUpdate(
      { user: req.user._id },
      { $pull: { items: { _id: req.params.itemId } } },
      { new: true }
    ).populate({
      path: 'items.product',
      select: 'name price images slug',
      populate: { path: 'seller', select: 'name sellerProfile.storeName sellerProfile.storeLogo' },
    });

    return ApiResponse.success(res, {
      items: cart?.items || [],
      subtotal: cart?.subtotal || 0,
      itemCount: cart?.itemCount || 0,
    }, 'Item removed');
  } catch (err) { next(err); }
};

const clearCart = async (req, res, next) => {
  try {
    await Cart.findOneAndUpdate({ user: req.user._id }, { items: [], coupon: undefined });
    return ApiResponse.success(res, null, 'Cart cleared');
  } catch (err) { next(err); }
};

const applyCoupon = async (req, res, next) => {
  try {
    const { code } = req.body;
    const coupon = await Coupon.findOne({ code: code.toUpperCase(), isActive: true });

    if (!coupon) return next(ApiError.notFound('Invalid coupon code'));
    if (coupon.validUntil < new Date()) return next(ApiError.badRequest('Coupon has expired'));
    if (coupon.validFrom > new Date()) return next(ApiError.badRequest('Coupon not yet active'));
    if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
      return next(ApiError.badRequest('Coupon usage limit reached'));
    }

    const userUsage = coupon.usedBy.filter(
      (u) => u.user.toString() === req.user._id.toString()
    ).length;
    if (userUsage >= coupon.userUsageLimit) {
      return next(ApiError.badRequest('You have already used this coupon'));
    }

    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) return next(ApiError.notFound('Cart not found'));

    if (cart.subtotal < coupon.minimumOrderAmount) {
      return next(ApiError.badRequest(
        `Minimum order amount is $${coupon.minimumOrderAmount}`
      ));
    }

    cart.coupon = {
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      validUntil: coupon.validUntil,
    };
    await cart.save();

    return ApiResponse.success(res, { coupon: cart.coupon, subtotal: cart.subtotal });
  } catch (err) { next(err); }
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
const createCoupon = async (req, res, next) => {
  try {
    const coupon = await Coupon.create({ ...req.body, createdBy: req.user._id });
    return ApiResponse.created(res, coupon, 'Coupon created');
  } catch (err) { next(err); }
};

const getCoupons = async (req, res, next) => {
  try {
    const coupons = await Coupon.find().sort('-createdAt').lean();
    return ApiResponse.success(res, coupons);
  } catch (err) { next(err); }
};

const deleteCoupon = async (req, res, next) => {
  try {
    await Coupon.findByIdAndDelete(req.params.id);
    return ApiResponse.success(res, null, 'Coupon deleted');
  } catch (err) { next(err); }
};

// Category management
const createCategory = async (req, res, next) => {
  try {
    const slug = slugify(req.body.name, { lower: true, strict: true });
    const category = await Category.create({ ...req.body, slug });
    await cache.del('categories:all');
    await cache.flush('cache:categories:*');
    return ApiResponse.created(res, category);
  } catch (err) { next(err); }
};

const getCategories = async (req, res, next) => {
  try {
    const cacheKey = 'categories:all';
    const cached = await cache.get(cacheKey);
    if (cached) return ApiResponse.success(res, cached);

    const categories = await Category.find({ isActive: true })
      .sort('sortOrder name')
      .lean();
    await cache.set(cacheKey, categories, 600);
    return ApiResponse.success(res, categories);
  } catch (err) { next(err); }
};

const updateCategory = async (req, res, next) => {
  try {
    const category = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!category) return next(ApiError.notFound('Category not found'));
    await cache.del('categories:all');
    return ApiResponse.success(res, category, 'Category updated');
  } catch (err) { next(err); }
};

const deleteCategory = async (req, res, next) => {
  try {
    await Category.findByIdAndUpdate(req.params.id, { isActive: false });
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
