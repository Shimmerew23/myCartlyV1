const mongoose = require('mongoose');

const carrierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, lowercase: true, trim: true },
    trackingUrlTemplate: {
      type: String,
      trim: true,
      // Use {trackingNumber} as placeholder, e.g.:
      // "https://www.fedex.com/apps/fedextrack/?tracknumbers={trackingNumber}"
    },
    logoUrl: { type: String },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

carrierSchema.index({ code: 1 });
carrierSchema.index({ isActive: 1, sortOrder: 1 });

const Carrier = mongoose.model('Carrier', carrierSchema);
module.exports = Carrier;
