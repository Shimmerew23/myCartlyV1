const mongoose = require('mongoose');
const slugify = require('slugify');

const variantSchema = new mongoose.Schema({
  name: { type: String, required: true }, // e.g., "Size", "Color"
  value: { type: String, required: true }, // e.g., "XL", "Red"
  stock: { type: Number, default: 0 },
  price: Number, // Override base price if needed
  sku: String,
  images: [String],
});

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      maxlength: [200, 'Product name cannot exceed 200 characters'],
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
    },
    description: {
      type: String,
      required: [true, 'Product description is required'],
      maxlength: [5000, 'Description cannot exceed 5000 characters'],
    },
    shortDescription: {
      type: String,
      maxlength: [300],
    },
    price: {
      type: Number,
      required: [true, 'Product price is required'],
      min: [0, 'Price cannot be negative'],
    },
    compareAtPrice: {
      type: Number,
      min: 0,
    },
    costPrice: {
      type: Number,
      min: 0,
      select: false, // Hidden from public
    },
    currency: { type: String, default: 'USD' },

    // Media
    images: [
      {
        url: { type: String, required: true },
        public_id: String,
        alt: String,
        isPrimary: { type: Boolean, default: false },
      },
    ],
    video: String,

    // Category & Tags
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'Category is required'],
    },
    subcategory: String,
    tags: [{ type: String, lowercase: true, trim: true }],
    brand: String,

    // Seller
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Inventory
    sku: { type: String, unique: true, sparse: true },
    stock: { type: Number, default: 0, min: 0 },
    lowStockThreshold: { type: Number, default: 5 },
    trackInventory: { type: Boolean, default: true },

    // Variants (sizes, colors, etc.)
    hasVariants: { type: Boolean, default: false },
    variants: [variantSchema],

    // Ratings
    rating: {
      average: { type: Number, default: 0, min: 0, max: 5 },
      count: { type: Number, default: 0 },
      distribution: {
        1: { type: Number, default: 0 },
        2: { type: Number, default: 0 },
        3: { type: Number, default: 0 },
        4: { type: Number, default: 0 },
        5: { type: Number, default: 0 },
      },
    },

    // Status
    status: {
      type: String,
      enum: ['draft', 'active', 'inactive', 'suspended', 'archived'],
      default: 'draft',
    },
    isFeatured: { type: Boolean, default: false },
    isTrending: { type: Boolean, default: false },
    isNewArrival: { type: Boolean, default: false },

    // SEO
    seo: {
      metaTitle: String,
      metaDescription: String,
      metaKeywords: [String],
    },

    // Shipping
    shipping: {
      weight: Number, // in grams
      dimensions: {
        length: Number,
        width: Number,
        height: Number,
      },
      isFreeShipping: { type: Boolean, default: false },
      shippingClass: String,
    },

    // Discounts & Promotions
    discount: {
      type: { type: String, enum: ['percentage', 'fixed'] },
      value: Number,
      validFrom: Date,
      validUntil: Date,
    },

    // Analytics
    views: { type: Number, default: 0 },
    sales: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    wishlistCount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
productSchema.index({ name: 'text', description: 'text', tags: 'text', brand: 'text' });
productSchema.index({ category: 1 });
productSchema.index({ seller: 1 });
productSchema.index({ status: 1 });
productSchema.index({ price: 1 });
productSchema.index({ 'rating.average': -1 });
productSchema.index({ isFeatured: 1, isTrending: 1 });
productSchema.index({ createdAt: -1 });
productSchema.index({ sales: -1 });
productSchema.index({ tags: 1 });

// Virtual: discountedPrice
productSchema.virtual('discountedPrice').get(function () {
  if (!this.discount?.value) return this.price;
  const now = new Date();
  if (this.discount.validFrom && now < this.discount.validFrom) return this.price;
  if (this.discount.validUntil && now > this.discount.validUntil) return this.price;

  if (this.discount.type === 'percentage') {
    return Math.round((this.price * (1 - this.discount.value / 100)) * 100) / 100;
  }
  return Math.max(0, this.price - this.discount.value);
});

// Virtual: discountPercentage
productSchema.virtual('discountPercentage').get(function () {
  if (!this.compareAtPrice || this.compareAtPrice <= this.price) return 0;
  return Math.round(((this.compareAtPrice - this.price) / this.compareAtPrice) * 100);
});

// Virtual: inStock
productSchema.virtual('inStock').get(function () {
  if (!this.trackInventory) return true;
  return this.stock > 0;
});

// Pre-save: Generate slug
productSchema.pre('save', async function (next) {
  if (this.isModified('name') || this.isNew) {
    let baseSlug = slugify(this.name, { lower: true, strict: true });
    let slug = baseSlug;
    let count = 0;
    while (await mongoose.model('Product').findOne({ slug, _id: { $ne: this._id } })) {
      count++;
      slug = `${baseSlug}-${count}`;
    }
    this.slug = slug;
  }
  next();
});

const Product = mongoose.model('Product', productSchema);
module.exports = Product;
