const { prisma } = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const serializeCarrier = (c) => ({
  _id: c.id,
  id: c.id,
  name: c.name,
  code: c.code,
  trackingUrlTemplate: c.trackingUrlTemplate ?? undefined,
  logoUrl: c.logoUrl ?? undefined,
  isActive: c.isActive,
  sortOrder: c.sortOrder,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

const ORDER_BY = [{ sortOrder: 'asc' }, { name: 'asc' }];

// @desc    Get active carriers (public — for checkout carrier selection)
// @route   GET /api/carriers
// @access  Public
const getActiveCarriers = async (req, res, next) => {
  const carriers = await prisma.carrier.findMany({ where: { isActive: true }, orderBy: ORDER_BY });
  return ApiResponse.success(res, carriers.map(serializeCarrier));
};

// @desc    Get all carriers (admin)
// @route   GET /api/admin/carriers
// @access  Admin
const getAllCarriers = async (req, res, next) => {
  const carriers = await prisma.carrier.findMany({ orderBy: ORDER_BY });
  return ApiResponse.success(res, carriers.map(serializeCarrier));
};

// @desc    Create carrier
// @route   POST /api/admin/carriers
// @access  Admin
const createCarrier = async (req, res, next) => {
  const { name, code, trackingUrlTemplate, logoUrl, sortOrder } = req.body;
  if (!name || !code) return next(ApiError.badRequest('Name and code are required'));

  const existing = await prisma.carrier.findUnique({ where: { code: code.toLowerCase() } });
  if (existing) return next(ApiError.conflict('Carrier code already exists'));

  const carrier = await prisma.carrier.create({
    data: { name, code: code.toLowerCase(), trackingUrlTemplate, logoUrl, sortOrder },
  });
  return ApiResponse.created(res, serializeCarrier(carrier), 'Carrier created');
};

// @desc    Update carrier (enable/disable/edit)
// @route   PUT /api/admin/carriers/:id
// @access  Admin
const updateCarrier = async (req, res, next) => {
  if (!UUID_RE.test(req.params.id)) return next(ApiError.notFound('Carrier not found'));
  const { name, trackingUrlTemplate, logoUrl, isActive, sortOrder } = req.body;

  const existing = await prisma.carrier.findUnique({ where: { id: req.params.id } });
  if (!existing) return next(ApiError.notFound('Carrier not found'));

  const data = {};
  if (name !== undefined) data.name = name;
  if (trackingUrlTemplate !== undefined) data.trackingUrlTemplate = trackingUrlTemplate;
  if (logoUrl !== undefined) data.logoUrl = logoUrl;
  if (isActive !== undefined) data.isActive = isActive;
  if (sortOrder !== undefined) data.sortOrder = sortOrder;

  const carrier = await prisma.carrier.update({ where: { id: req.params.id }, data });
  return ApiResponse.success(res, serializeCarrier(carrier), 'Carrier updated');
};

// @desc    Delete carrier
// @route   DELETE /api/admin/carriers/:id
// @access  Admin
const deleteCarrier = async (req, res, next) => {
  if (!UUID_RE.test(req.params.id)) return next(ApiError.notFound('Carrier not found'));
  const existing = await prisma.carrier.findUnique({ where: { id: req.params.id } });
  if (!existing) return next(ApiError.notFound('Carrier not found'));

  await prisma.carrier.delete({ where: { id: req.params.id } });
  return ApiResponse.success(res, null, 'Carrier deleted');
};

module.exports = { getActiveCarriers, getAllCarriers, createCarrier, updateCarrier, deleteCarrier, serializeCarrier };
