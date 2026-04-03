const express = require('express');
const passport = require('passport');

const {
  authenticate, optionalAuth, requireAdmin, requireSuperAdmin,
  requireSeller, authLimiter, uploadLimiter, globalLimiter,
  upload, processImages, validate, schemas, auditLog, cacheMiddleware,
} = require('../middleware/index');

const authCtrl = require('../controllers/authController');
const productCtrl = require('../controllers/productController');
const orderCtrl = require('../controllers/orderController');
const carrierCtrl = require('../controllers/carrierController');
const {
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
} = require('../controllers/index');

// ============================================================
// AUTH ROUTES
// ============================================================
const authRouter = express.Router();

authRouter.post('/register', authLimiter, validate(schemas.register), authCtrl.register);
authRouter.post('/login', authLimiter, validate(schemas.login), authCtrl.login);
authRouter.post('/logout', authenticate, authCtrl.logout);
authRouter.post('/refresh', authCtrl.refreshToken);
authRouter.get('/me', authenticate, authCtrl.getMe);
authRouter.post('/forgot-password', authLimiter, authCtrl.forgotPassword);
authRouter.put('/reset-password/:token', authLimiter, authCtrl.resetPassword);
authRouter.get('/verify-email/:token', authCtrl.verifyEmail);
authRouter.put('/change-password', authenticate, authCtrl.changePassword);
authRouter.post('/resend-verification', authenticate, authCtrl.resendVerification);

// Google OAuth
authRouter.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);
authRouter.get('/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: `${process.env.FRONTEND_URL}/login?error=google` }),
  authCtrl.oauthCallback
);

// Facebook OAuth
authRouter.get('/facebook',
  passport.authenticate('facebook', { scope: ['email'] })
);
authRouter.get('/facebook/callback',
  passport.authenticate('facebook', { session: false, failureRedirect: `${process.env.FRONTEND_URL}/login?error=facebook` }),
  authCtrl.oauthCallback
);

// ============================================================
// PRODUCT ROUTES
// ============================================================
const productRouter = express.Router();

productRouter.get('/', optionalAuth, cacheMiddleware(300, 'products'), productCtrl.getProducts);
productRouter.get('/featured', cacheMiddleware(600, 'products'), productCtrl.getFeaturedProducts);
productRouter.get('/my-products', authenticate, requireSeller, productCtrl.getMyProducts);
productRouter.get('/seller-stats', authenticate, requireSeller, productCtrl.getSellerStats);
productRouter.get('/:slug', optionalAuth, productCtrl.getProduct);
productRouter.get('/:id/related', productCtrl.getRelatedProducts);
productRouter.post('/:id/wishlist', authenticate, productCtrl.toggleWishlist);

productRouter.post('/',
  authenticate, requireSeller, uploadLimiter,
  upload.array('images', 10),
  processImages({ width: 1200, height: 1200, quality: 85, outputDir: 'uploads/products' }),
  validate(schemas.product),
  auditLog('CREATE_PRODUCT', 'Product'),
  productCtrl.createProduct
);

productRouter.put('/:id',
  authenticate, requireSeller, uploadLimiter,
  upload.array('images', 10),
  processImages({ width: 1200, height: 1200, quality: 85, outputDir: 'uploads/products' }),
  auditLog('UPDATE_PRODUCT', 'Product'),
  productCtrl.updateProduct
);

productRouter.delete('/:id',
  authenticate, requireSeller,
  auditLog('DELETE_PRODUCT', 'Product'),
  productCtrl.deleteProduct
);

// ============================================================
// REVIEW ROUTES
// ============================================================
const reviewRouter = express.Router({ mergeParams: true });

reviewRouter.get('/', getProductReviews);
reviewRouter.post('/', authenticate, createReview);
reviewRouter.put('/:reviewId', authenticate, updateReview);
reviewRouter.delete('/:reviewId', authenticate, deleteReview);
reviewRouter.post('/:reviewId/helpful', authenticate, voteHelpful);

// ============================================================
// ORDER ROUTES
// ============================================================
const orderRouter = express.Router();

// Stripe webhook (raw body needed — defined in server.js before json parser)
orderRouter.post('/webhook', express.raw({ type: 'application/json' }), orderCtrl.stripeWebhook);

orderRouter.post('/', authenticate, orderCtrl.createOrder);
orderRouter.get('/my-orders', authenticate, orderCtrl.getMyOrders);
orderRouter.get('/seller-orders', authenticate, requireSeller, orderCtrl.getSellerOrders);
orderRouter.get('/:id', authenticate, orderCtrl.getOrder);
orderRouter.put('/:id/status', authenticate, requireSeller, orderCtrl.updateOrderStatus);
orderRouter.post('/:id/return', authenticate, orderCtrl.requestReturn);

// ============================================================
// USER ROUTES
// ============================================================
const userRouter = express.Router();

userRouter.get('/wishlist', authenticate, getWishlist);
userRouter.get('/store/:slug', getSellerStore);

userRouter.put('/profile',
  authenticate, uploadLimiter,
  upload.single('avatar'),
  processImages({ width: 400, height: 400, quality: 90, outputDir: 'uploads/avatars' }),
  updateProfile
);

userRouter.post('/upgrade-seller',
  authenticate, uploadLimiter,
  upload.single('storeLogo'),
  processImages({ width: 400, height: 400, outputDir: 'uploads/avatars' }),
  upgradeToSeller
);

userRouter.put('/seller-profile',
  authenticate, uploadLimiter,
  upload.fields([{ name: 'storeLogo', maxCount: 1 }, { name: 'storeBanner', maxCount: 1 }]),
  updateSellerProfile
);

userRouter.post('/addresses', authenticate, validate(schemas.address), addAddress);
userRouter.put('/addresses/:addressId', authenticate, updateAddress);
userRouter.delete('/addresses/:addressId', authenticate, deleteAddress);

// ============================================================
// CART ROUTES
// ============================================================
const cartRouter = express.Router();

cartRouter.get('/', authenticate, getCart);
cartRouter.post('/add', authenticate, addToCart);
cartRouter.put('/items/:itemId', authenticate, updateCartItem);
cartRouter.delete('/items/:itemId', authenticate, removeFromCart);
cartRouter.delete('/', authenticate, clearCart);
cartRouter.post('/coupon', authenticate, applyCoupon);

// ============================================================
// CARRIER ROUTES (public — active carriers for checkout)
// ============================================================
const carrierRouter = express.Router();
carrierRouter.get('/', carrierCtrl.getActiveCarriers);

// ============================================================
// FEEDBACK ROUTES
// ============================================================
const feedbackRouter = express.Router();

feedbackRouter.post('/', optionalAuth, submitFeedback);

// ============================================================
// CATEGORY ROUTES
// ============================================================
const categoryRouter = express.Router();

categoryRouter.get('/', cacheMiddleware(600, 'categories'), getCategories);
categoryRouter.post('/', authenticate, requireAdmin, createCategory);
categoryRouter.put('/:id', authenticate, requireAdmin, updateCategory);
categoryRouter.delete('/:id', authenticate, requireAdmin, deleteCategory);

// ============================================================
// ADMIN ROUTES
// ============================================================
const adminRouter = express.Router();

// All admin routes require authentication + admin role
adminRouter.use(authenticate, requireAdmin);

adminRouter.get('/dashboard', cacheMiddleware(120, 'admin'), getDashboardStats);

// Users management
adminRouter.get('/users', getAllUsers);
adminRouter.put('/users/:userId', auditLog('UPDATE_USER', 'User'), updateUser);
adminRouter.delete('/users/:userId', auditLog('DELETE_USER', 'User'), deleteUser);
adminRouter.post('/users/:userId/approve-seller', auditLog('APPROVE_SELLER', 'User'), approveSeller);

// Products management
adminRouter.get('/products', getAllProducts);
adminRouter.put('/products/:id', auditLog('ADMIN_UPDATE_PRODUCT', 'Product'), adminUpdateProduct);

// Orders management
adminRouter.get('/orders', getAllOrders);

// Coupons
adminRouter.get('/coupons', getCoupons);
adminRouter.post('/coupons', createCoupon);
adminRouter.delete('/coupons/:id', deleteCoupon);

// Carriers management
adminRouter.get('/carriers', carrierCtrl.getAllCarriers);
adminRouter.post('/carriers', carrierCtrl.createCarrier);
adminRouter.put('/carriers/:id', carrierCtrl.updateCarrier);
adminRouter.delete('/carriers/:id', carrierCtrl.deleteCarrier);

// Audit logs (superadmin only)
adminRouter.get('/audit-logs', requireSuperAdmin, getAuditLogs);

// Feedback
adminRouter.get('/feedback', getFeedbacks);
adminRouter.put('/feedback/:id', updateFeedbackStatus);

module.exports = {
  authRouter,
  productRouter,
  reviewRouter,
  orderRouter,
  userRouter,
  cartRouter,
  categoryRouter,
  carrierRouter,
  adminRouter,
  feedbackRouter,
};
