const crypto = require('crypto');
const { prisma } = require('../config/prisma');
const userService = require('../services/userService');
const orderService = require('../services/orderService');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { sendEmail } = require('../utils/email');
const logger = require('../utils/logger');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MANAGER_SELECT = { select: { id: true, name: true, email: true, isActive: true, lastLoginAt: true } };

const serializeManager = (m) =>
  m ? { _id: m.id, id: m.id, name: m.name, email: m.email, isActive: m.isActive, lastLoginAt: m.lastLoginAt ?? undefined } : undefined;

const serializeWarehouse = (w) => {
  if (!w) return null;
  const addr = w.address || {};
  return {
    _id: w.id,
    id: w.id,
    name: w.name,
    code: w.code,
    address: addr,
    manager: w.manager ? serializeManager(w.manager) : w.managerId,
    isActive: w.isActive,
    notes: w.notes ?? undefined,
    locationLabel: `${w.name} — ${addr.city}, ${addr.state}`,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  };
};

// ============================================================
// ADMIN — Warehouse account management
// ============================================================

const createWarehouse = async (req, res, next) => {
  const { name, code, street, city, state, country, zipCode, managerName, managerEmail, notes } = req.body;

  if (!name || !code || !street || !city || !state || !zipCode || !managerName || !managerEmail) {
    return next(ApiError.badRequest('All required fields must be provided'));
  }

  const existingWarehouse = await prisma.warehouse.findUnique({ where: { code: code.toUpperCase() } });
  if (existingWarehouse) return next(ApiError.conflict('A warehouse with this code already exists'));

  const existingUser = await prisma.user.findUnique({ where: { email: managerEmail.toLowerCase() } });
  if (existingUser) return next(ApiError.conflict('A user with this email already exists'));

  const tempPassword = `${crypto.randomBytes(10).toString('hex')}Wh!`;
  const hashed = await userService.hashPassword(tempPassword);

  const warehouseUser = await prisma.user.create({
    data: { name: managerName, email: managerEmail.toLowerCase(), password: hashed, role: 'warehouse', isEmailVerified: true },
  });

  const warehouse = await prisma.warehouse.create({
    data: {
      name,
      code: code.toUpperCase(),
      address: { street, city, state, country: country || 'US', zipCode },
      managerId: warehouseUser.id,
      notes,
    },
    include: { manager: MANAGER_SELECT },
  });

  try {
    await sendEmail({
      to: managerEmail,
      subject: 'Your CartLy Warehouse Account',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Welcome to CartLy Warehouse Portal</h2>
          <p>Hi <strong>${managerName}</strong>,</p>
          <p>Your warehouse account has been created for <strong>${name}</strong> (Code: ${code.toUpperCase()}).</p>
          <p>Use the credentials below to log in:</p>
          <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 0;"><strong>Email:</strong> ${managerEmail}</p>
            <p style="margin: 8px 0 0;"><strong>Temporary Password:</strong> ${tempPassword}</p>
          </div>
          <p>Please change your password after your first login.</p>
          <p style="color: #888; font-size: 12px;">This email was sent by CartLy Admin.</p>
        </div>
      `,
    });
  } catch (e) {
    logger.error(`Warehouse credentials email failed: ${e.message}`);
  }

  logger.info(`Warehouse created: ${name} (${code}) by admin ${req.user.email}`);
  return ApiResponse.created(res, serializeWarehouse(warehouse), 'Warehouse account created successfully');
};

const getWarehouses = async (req, res, next) => {
  const warehouses = await prisma.warehouse.findMany({ orderBy: { createdAt: 'desc' }, include: { manager: MANAGER_SELECT } });
  return ApiResponse.success(res, warehouses.map(serializeWarehouse));
};

const updateWarehouse = async (req, res, next) => {
  if (!UUID_RE.test(req.params.id)) return next(ApiError.notFound('Warehouse not found'));
  const { name, street, city, state, country, zipCode, isActive, notes } = req.body;

  const warehouse = await prisma.warehouse.findUnique({ where: { id: req.params.id } });
  if (!warehouse) return next(ApiError.notFound('Warehouse not found'));

  const data = {};
  if (name !== undefined) data.name = name;
  if (notes !== undefined) data.notes = notes;
  if (isActive !== undefined) {
    data.isActive = isActive;
    if (warehouse.managerId) await prisma.user.update({ where: { id: warehouse.managerId }, data: { isActive } });
  }
  if (street || city || state || country || zipCode) {
    const addr = warehouse.address || {};
    data.address = {
      street: street || addr.street,
      city: city || addr.city,
      state: state || addr.state,
      country: country || addr.country,
      zipCode: zipCode || addr.zipCode,
    };
  }

  const updated = await prisma.warehouse.update({ where: { id: req.params.id }, data, include: { manager: MANAGER_SELECT } });
  return ApiResponse.success(res, serializeWarehouse(updated), 'Warehouse updated');
};

const deleteWarehouse = async (req, res, next) => {
  if (!UUID_RE.test(req.params.id)) return next(ApiError.notFound('Warehouse not found'));
  const warehouse = await prisma.warehouse.findUnique({ where: { id: req.params.id } });
  if (!warehouse) return next(ApiError.notFound('Warehouse not found'));

  // Delete the warehouse first to satisfy the manager FK, then the user account.
  await prisma.warehouse.delete({ where: { id: warehouse.id } });
  if (warehouse.managerId) {
    await prisma.user.delete({ where: { id: warehouse.managerId } }).catch(() => null);
  }

  return ApiResponse.success(res, null, 'Warehouse deleted');
};

// ============================================================
// WAREHOUSE — Parcel scanning & check-in
// ============================================================

const scanOrder = async (req, res, next) => {
  const { q } = req.query;
  if (!q || q.trim().length < 3) return next(ApiError.badRequest('Provide an order number or ID to scan'));

  const query = q.trim();
  let order = null;

  if (query.startsWith('CUR-') || query.includes('-')) {
    order = await prisma.order.findFirst({
      where: { orderNumber: query.toUpperCase() },
      include: { ...orderService.ORDER_INCLUDE, user: true },
    });
  }
  if (!order && UUID_RE.test(query)) {
    order = await prisma.order.findUnique({
      where: { id: query },
      include: { ...orderService.ORDER_INCLUDE, user: true },
    });
  }

  if (!order) return next(ApiError.notFound(`No order found for: "${query}"`));

  const productMap = await orderService.getItemProductMap(order.items.map((i) => i.productId));
  return ApiResponse.success(res, orderService.serializeOrder(order, { productMap }));
};

const VALID_TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['out_for_delivery', 'delivered'],
  out_for_delivery: ['delivered'],
  delivered: ['return_requested'],
  return_requested: ['returned', 'delivered'],
  returned: ['refunded'],
};

const ACTION_TO_STATUS = {
  mark_processing: 'processing',
  mark_shipped: 'shipped',
  mark_out_for_delivery: 'out_for_delivery',
  mark_delivered: 'delivered',
};

const checkInParcel = async (req, res, next) => {
  if (!UUID_RE.test(req.params.id)) return next(ApiError.notFound('Order not found'));
  const { action, location, note, trackingNumber, carrierId } = req.body;
  if (!action) return next(ApiError.badRequest('action is required'));

  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) return next(ApiError.notFound('Order not found'));

  // Resolve a warehouse label for the log entry.
  let warehouseName = null;
  if (req.user.role === 'warehouse') {
    const wh = await prisma.warehouse.findFirst({ where: { managerId: req.user._id } });
    warehouseName = wh ? `${wh.name} — ${wh.address.city}, ${wh.address.state}` : req.user.name;
  }

  const data = {};
  let eventNote;

  if (action === 'location_update') {
    if (!location) return next(ApiError.badRequest('location is required for location_update'));
    data.tracking = { ...(order.tracking || {}), lastLocation: location, lastLocationUpdatedAt: new Date() };
    eventNote = `Location update: ${location}${note ? ` — ${note}` : ''}`;
  } else if (ACTION_TO_STATUS[action]) {
    const newStatus = ACTION_TO_STATUS[action];
    if (!VALID_TRANSITIONS[order.status]?.includes(newStatus)) {
      return next(ApiError.badRequest(`Cannot transition order from "${order.status}" to "${newStatus}"`));
    }
    data.status = newStatus;
    eventNote = [location && `Location: ${location}`, note].filter(Boolean).join(' — ') || undefined;

    if (newStatus === 'shipped' && trackingNumber) {
      let resolvedCarrierName = null;
      let resolvedTrackingUrl = null;
      if (carrierId) {
        const carrier = await prisma.carrier.findUnique({ where: { id: carrierId } }).catch(() => null);
        if (carrier) {
          resolvedCarrierName = carrier.name;
          if (carrier.trackingUrlTemplate) {
            resolvedTrackingUrl = carrier.trackingUrlTemplate.replace('{trackingNumber}', trackingNumber);
          }
        }
      }
      data.tracking = {
        ...(order.tracking || {}),
        carrier: resolvedCarrierName,
        carrierId: carrierId || undefined,
        trackingNumber,
        trackingUrl: resolvedTrackingUrl,
        lastLocation: location || order.tracking?.lastLocation,
        lastLocationUpdatedAt: location ? new Date() : order.tracking?.lastLocationUpdatedAt,
      };
    } else if (location) {
      data.tracking = { ...(order.tracking || {}), lastLocation: location, lastLocationUpdatedAt: new Date() };
    }

    if (newStatus === 'delivered') data.deliveredAt = new Date();
  } else {
    return next(ApiError.badRequest(`Unknown action: "${action}"`));
  }

  const eventStatus = data.status || order.status;
  const updated = await prisma.$transaction(async (tx) => {
    await tx.orderStatusEvent.create({
      data: { orderId: order.id, status: eventStatus, note: eventNote, updatedById: req.user._id, warehouseName },
    });
    return tx.order.update({ where: { id: order.id }, data, include: orderService.ORDER_INCLUDE });
  });

  logger.info(`Warehouse check-in: order ${order.orderNumber} — action=${action} by ${req.user.email}`);
  return ApiResponse.success(res, orderService.serializeOrder(updated), 'Parcel updated successfully');
};

module.exports = {
  createWarehouse,
  getWarehouses,
  updateWarehouse,
  deleteWarehouse,
  scanOrder,
  checkInParcel,
  serializeWarehouse,
};
