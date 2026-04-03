const Carrier = require('../models/Carrier');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');

// @desc    Get active carriers (public — for checkout carrier selection)
// @route   GET /api/carriers
// @access  Public
const getActiveCarriers = async (req, res, next) => {
  try {
    const carriers = await Carrier.find({ isActive: true })
      .sort('sortOrder name')
      .lean();
    return ApiResponse.success(res, carriers);
  } catch (err) { next(err); }
};

// @desc    Get all carriers (admin)
// @route   GET /api/admin/carriers
// @access  Admin
const getAllCarriers = async (req, res, next) => {
  try {
    const carriers = await Carrier.find()
      .sort('sortOrder name')
      .lean();
    return ApiResponse.success(res, carriers);
  } catch (err) { next(err); }
};

// @desc    Create carrier
// @route   POST /api/admin/carriers
// @access  Admin
const createCarrier = async (req, res, next) => {
  try {
    const { name, code, trackingUrlTemplate, logoUrl, sortOrder } = req.body;
    if (!name || !code) return next(ApiError.badRequest('Name and code are required'));

    const existing = await Carrier.findOne({ code: code.toLowerCase() });
    if (existing) return next(ApiError.conflict('Carrier code already exists'));

    const carrier = await Carrier.create({ name, code, trackingUrlTemplate, logoUrl, sortOrder });
    return ApiResponse.created(res, carrier, 'Carrier created');
  } catch (err) { next(err); }
};

// @desc    Update carrier (enable/disable/edit)
// @route   PUT /api/admin/carriers/:id
// @access  Admin
const updateCarrier = async (req, res, next) => {
  try {
    const { name, trackingUrlTemplate, logoUrl, isActive, sortOrder } = req.body;
    const carrier = await Carrier.findByIdAndUpdate(
      req.params.id,
      { name, trackingUrlTemplate, logoUrl, isActive, sortOrder },
      { new: true, runValidators: true }
    );
    if (!carrier) return next(ApiError.notFound('Carrier not found'));
    return ApiResponse.success(res, carrier, 'Carrier updated');
  } catch (err) { next(err); }
};

// @desc    Delete carrier
// @route   DELETE /api/admin/carriers/:id
// @access  Admin
const deleteCarrier = async (req, res, next) => {
  try {
    const carrier = await Carrier.findByIdAndDelete(req.params.id);
    if (!carrier) return next(ApiError.notFound('Carrier not found'));
    return ApiResponse.success(res, null, 'Carrier deleted');
  } catch (err) { next(err); }
};

module.exports = { getActiveCarriers, getAllCarriers, createCarrier, updateCarrier, deleteCarrier };
