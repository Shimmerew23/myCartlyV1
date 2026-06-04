require('dotenv').config();
const { prisma } = require('../config/prisma');
const logger = require('./logger');
const { seedDatabase } = require('./seeder');

// Base seed (users + products), then one PAID, refundable order for the admin-refund E2E.
const seedE2E = async () => {
  await seedDatabase();

  const buyer = await prisma.user.findUnique({ where: { email: 'user@cartly.com' } });
  const product = await prisma.product.findFirst({
    where: { status: 'active' },
    orderBy: { createdAt: 'asc' },
  });
  if (!buyer || !product) throw new Error('seedE2E: expected buyer + product from base seed');

  await prisma.order.create({
    data: {
      orderNumber: 'E2E-REFUND-0001',
      userId: buyer.id,
      shippingAddress: { name: 'Regular User', street: '1 Test St', city: 'Testville', state: 'CA', country: 'US', zipCode: '90001' },
      subtotal: product.price,
      shippingCost: 0,
      taxAmount: 0,
      discountAmount: 0,
      totalPrice: product.price,
      currency: 'USD',
      paymentMethod: 'cod',
      paymentStatus: 'paid',
      paidAt: new Date(),
      status: 'delivered',
      deliveredAt: new Date(),
      paymentResult: { refundedAmount: 0 },
      items: {
        create: [{ productId: product.id, sellerId: product.sellerId, name: product.name, price: product.price, quantity: 1 }],
      },
      statusHistory: { create: [{ status: 'delivered' }] },
    },
  });
  logger.info('E2E seed: created paid refundable order E2E-REFUND-0001');
};

if (require.main === module) {
  seedE2E()
    .then(() => prisma.$disconnect())
    .then(() => process.exit(0))
    .catch(async (err) => {
      logger.error(`E2E seed failed: ${err.message}`);
      await prisma.$disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { seedE2E };
