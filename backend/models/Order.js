const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  image: String,
  price: { type: Number, required: true },
  quantity: { type: Number, required: true, min: 1 },
  variant: {
    name: String,
    value: String,
  },
});

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    items: [orderItemSchema],

    shippingAddress: {
      name: { type: String, required: true },
      street: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      country: { type: String, required: true },
      zipCode: { type: String, required: true },
      phone: String,
    },

    // Pricing
    subtotal: { type: Number, required: true },
    shippingCost: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    totalPrice: { type: Number, required: true },
    currency: { type: String, default: 'USD' },

    // Coupon
    coupon: {
      code: String,
      discountType: String,
      discountValue: Number,
    },

    // Payment
    paymentMethod: {
      type: String,
      enum: ['stripe', 'paypal', 'cod', 'bank_transfer'],
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded', 'partially_refunded'],
      default: 'pending',
    },
    paymentResult: {
      id: String,
      status: String,
      updateTime: String,
      emailAddress: String,
      receiptUrl: String,
    },
    paidAt: Date,

    // Fulfillment
    status: {
      type: String,
      enum: [
        'pending',
        'confirmed',
        'processing',
        'shipped',
        'out_for_delivery',
        'delivered',
        'cancelled',
        'return_requested',
        'returned',
        'refunded',
      ],
      default: 'pending',
    },

    // Tracking
    tracking: {
      carrier: String,
      carrierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Carrier' },
      trackingNumber: String,
      trackingUrl: String,
      estimatedDelivery: Date,
      lastLocation: String,
      lastLocationUpdatedAt: Date,
    },

    // Buyer's preferred carrier (selected at checkout)
    preferredCarrier: String,

    // Status history
    statusHistory: [
      {
        status: String,
        timestamp: { type: Date, default: Date.now },
        note: String,
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
    ],

    // Cancellation
    cancelledAt: Date,
    cancellationReason: String,

    // Delivery
    deliveredAt: Date,

    // Notes
    customerNote: String,
    internalNote: String,

    // Return/Refund
    returnReason: String,
    refundAmount: Number,
    refundedAt: Date,

    // Invoice
    invoiceUrl: String,
  },
  { timestamps: true }
);

// Indexes
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1 });
orderSchema.index({ 'items.seller': 1 });
orderSchema.index({ paymentStatus: 1 });

// Pre-save: Generate order number
orderSchema.pre('save', async function (next) {
  if (this.isNew) {
    const count = await mongoose.model('Order').countDocuments();
    this.orderNumber = `CUR-${Date.now()}-${String(count + 1).padStart(6, '0')}`;
  }
  next();
});

const Order = mongoose.model('Order', orderSchema);
module.exports = Order;
