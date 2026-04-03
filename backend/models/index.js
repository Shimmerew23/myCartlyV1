const mongoose = require('mongoose');

// ========================
// CART MODEL
// ========================
const cartItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  quantity: { type: Number, required: true, min: 1, default: 1 },
  variant: { name: String, value: String },
  price: { type: Number, required: true }, // Snapshot price
  addedAt: { type: Date, default: Date.now },
});

const cartSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    items: [cartItemSchema],
    coupon: {
      code: String,
      discountType: String,
      discountValue: Number,
      validUntil: Date,
    },
    lastModified: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

cartSchema.virtual('subtotal').get(function () {
  return this.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
});

cartSchema.virtual('itemCount').get(function () {
  return this.items.reduce((sum, item) => sum + item.quantity, 0);
});

cartSchema.index({ user: 1 });

// ========================
// REVIEW MODEL
// ========================
const reviewSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, maxlength: 100 },
    body: { type: String, maxlength: 1000 },
    images: [String],
    isVerifiedPurchase: { type: Boolean, default: false },
    helpfulVotes: { type: Number, default: 0 },
    reportCount: { type: Number, default: 0 },
    isApproved: { type: Boolean, default: true },
    sellerReply: {
      body: String,
      repliedAt: Date,
    },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  },
  { timestamps: true }
);

reviewSchema.index({ product: 1, user: 1 }, { unique: true });
reviewSchema.index({ product: 1, rating: -1 });
reviewSchema.index({ user: 1 });

// Post-save: Update product rating
reviewSchema.post('save', async function () {
  await updateProductRating(this.product);
});

reviewSchema.post('deleteOne', { document: true }, async function () {
  await updateProductRating(this.product);
});

async function updateProductRating(productId) {
  const Product = mongoose.model('Product');
  const stats = await mongoose.model('Review').aggregate([
    { $match: { product: productId, isApproved: true } },
    {
      $group: {
        _id: '$product',
        avg: { $avg: '$rating' },
        count: { $sum: 1 },
        dist1: { $sum: { $cond: [{ $eq: ['$rating', 1] }, 1, 0] } },
        dist2: { $sum: { $cond: [{ $eq: ['$rating', 2] }, 1, 0] } },
        dist3: { $sum: { $cond: [{ $eq: ['$rating', 3] }, 1, 0] } },
        dist4: { $sum: { $cond: [{ $eq: ['$rating', 4] }, 1, 0] } },
        dist5: { $sum: { $cond: [{ $eq: ['$rating', 5] }, 1, 0] } },
      },
    },
  ]);

  if (stats.length > 0) {
    await Product.findByIdAndUpdate(productId, {
      'rating.average': Math.round(stats[0].avg * 10) / 10,
      'rating.count': stats[0].count,
      'rating.distribution.1': stats[0].dist1,
      'rating.distribution.2': stats[0].dist2,
      'rating.distribution.3': stats[0].dist3,
      'rating.distribution.4': stats[0].dist4,
      'rating.distribution.5': stats[0].dist5,
    });
  } else {
    await Product.findByIdAndUpdate(productId, {
      'rating.average': 0,
      'rating.count': 0,
    });
  }
}

// ========================
// CATEGORY MODEL
// ========================
const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, unique: true, lowercase: true },
    description: String,
    image: String,
    icon: String,
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    productCount: { type: Number, default: 0 },
    seo: { metaTitle: String, metaDescription: String },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

categorySchema.index({ slug: 1 });
categorySchema.index({ parent: 1 });

// ========================
// AUDIT LOG MODEL
// ========================
const auditLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true },
    resource: String,
    resourceId: mongoose.Schema.Types.ObjectId,
    method: String,
    path: String,
    statusCode: Number,
    ip: String,
    userAgent: String,
    before: mongoose.Schema.Types.Mixed,
    after: mongoose.Schema.Types.Mixed,
    metadata: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

auditLogSchema.index({ user: 1, createdAt: -1 });
auditLogSchema.index({ action: 1 });
auditLogSchema.index({ resource: 1, resourceId: 1 });
auditLogSchema.index({ createdAt: -1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }); // 90 days TTL

// ========================
// COUPON MODEL
// ========================
const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true },
    description: String,
    discountType: { type: String, enum: ['percentage', 'fixed'], required: true },
    discountValue: { type: Number, required: true },
    minimumOrderAmount: { type: Number, default: 0 },
    maximumDiscountAmount: Number,
    usageLimit: Number,
    usageCount: { type: Number, default: 0 },
    userUsageLimit: { type: Number, default: 1 },
    usedBy: [{ user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, usedAt: Date }],
    validFrom: { type: Date, required: true },
    validUntil: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    applicableCategories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
    applicableProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

couponSchema.index({ code: 1 });
couponSchema.index({ validFrom: 1, validUntil: 1 });

// ========================
// FEEDBACK MODEL
// ========================
const feedbackSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    guestName: { type: String, maxlength: 80, trim: true },
    guestEmail: { type: String, maxlength: 120, trim: true, lowercase: true },
    category: {
      type: String,
      enum: ['bug', 'feature', 'general', 'complaint', 'praise'],
      required: true,
    },
    subject: { type: String, required: true, maxlength: 150, trim: true },
    message: { type: String, required: true, maxlength: 2000, trim: true },
    rating: { type: Number, min: 1, max: 5 },
    status: { type: String, enum: ['new', 'read', 'resolved'], default: 'new' },
    adminNote: { type: String, maxlength: 500 },
  },
  { timestamps: true }
);

feedbackSchema.index({ status: 1, createdAt: -1 });
feedbackSchema.index({ user: 1 });

const Cart = mongoose.model('Cart', cartSchema);
const Review = mongoose.model('Review', reviewSchema);
const Category = mongoose.model('Category', categorySchema);
const AuditLog = mongoose.model('AuditLog', auditLogSchema);
const Coupon = mongoose.model('Coupon', couponSchema);
const Feedback = mongoose.model('Feedback', feedbackSchema);

module.exports = { Cart, Review, Category, AuditLog, Coupon, Feedback };
