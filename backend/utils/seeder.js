require('dotenv').config();
const slugify = require('slugify');
const { prisma } = require('../config/prisma');
const userService = require('../services/userService');
const logger = require('./logger');

const CATEGORIES = [
  { name: 'Electronics', slug: 'electronics', icon: 'devices', sortOrder: 1 },
  { name: 'Fashion', slug: 'fashion', icon: 'checkroom', sortOrder: 2 },
  { name: 'Home & Garden', slug: 'home-garden', icon: 'home', sortOrder: 3 },
  { name: 'Sports', slug: 'sports', icon: 'sports_soccer', sortOrder: 4 },
  { name: 'Books', slug: 'books', icon: 'menu_book', sortOrder: 5 },
  { name: 'Art & Collectibles', slug: 'art-collectibles', icon: 'palette', sortOrder: 6 },
  { name: 'Beauty', slug: 'beauty', icon: 'spa', sortOrder: 7 },
  { name: 'Toys & Games', slug: 'toys-games', icon: 'toys', sortOrder: 8 },
];

// Delete order respects foreign keys (children before parents).
const wipe = async () => {
  await prisma.orderStatusEvent.deleteMany({});
  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.review.deleteMany({});
  await prisma.cartItem.deleteMany({});
  await prisma.cart.deleteMany({});
  await prisma.couponUsage.deleteMany({});
  await prisma.coupon.deleteMany({});
  await prisma.warehouse.deleteMany({});
  await prisma.carrier.deleteMany({});
  await prisma.feedback.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.productImage.deleteMany({});
  await prisma.productVariant.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.address.deleteMany({});
  await prisma.sellerProfile.deleteMany({});
  await prisma.user.deleteMany({});
};

const seedDB = async () => {
  try {
    await prisma.$connect();
    logger.info('Connected to PostgreSQL (Prisma) for seeding');

    await wipe();
    logger.info('Cleared existing data');

    // Categories
    await prisma.category.createMany({ data: CATEGORIES });
    const categories = await prisma.category.findMany();
    const catBySlug = new Map(categories.map((c) => [c.slug, c]));
    logger.info(`Created ${categories.length} categories`);

    // Passwords (hashed once each)
    const [adminPw, sellerPw, userPw] = await Promise.all([
      userService.hashPassword('Admin@123456'),
      userService.hashPassword('Seller@123456'),
      userService.hashPassword('User@123456'),
    ]);

    // Emails are stored lowercase (the API lowercases on register and login lookup).
    await prisma.user.create({
      data: { name: 'Super Admin', email: 'superadmin@cartly.com', password: adminPw, role: 'superadmin', isEmailVerified: true, isActive: true },
    });
    await prisma.user.create({
      data: { name: 'Admin User', email: 'admin@cartly.com', password: adminPw, role: 'admin', isEmailVerified: true, isActive: true },
    });

    const seller1 = await prisma.user.create({
      data: {
        name: 'Jane CartLy', email: 'seller@cartly.com', password: sellerPw, role: 'seller', isEmailVerified: true, isActive: true,
        sellerProfile: {
          create: {
            storeName: "Jane's Boutique", storeBio: 'Premium curated fashion and accessories', storeSlug: 'janes-boutique',
            isApproved: true, approvedAt: new Date(), totalSales: 150, totalRevenue: 12500,
          },
        },
      },
    });
    const seller2 = await prisma.user.create({
      data: {
        name: 'Marco Tech', email: 'seller2@cartly.com', password: sellerPw, role: 'seller', isEmailVerified: true, isActive: true,
        sellerProfile: {
          create: {
            storeName: "Marco's Tech Hub", storeBio: 'Latest gadgets and electronics', storeSlug: 'marcos-tech-hub',
            isApproved: true, approvedAt: new Date(),
          },
        },
      },
    });

    await prisma.user.create({
      data: { name: 'Regular User', email: 'user@cartly.com', password: userPw, role: 'user', isEmailVerified: true, isActive: true },
    });
    logger.info('Created users: superadmin, admin, 2 sellers, 1 user');

    const fashion = catBySlug.get('fashion');
    const electronics = catBySlug.get('electronics');
    const art = catBySlug.get('art-collectibles');
    const homeGarden = catBySlug.get('home-garden');

    const sampleProducts = [
      {
        name: 'Premium Leather Minimalist Wallet',
        description: 'Handcrafted from full-grain Italian leather. This slim wallet features 6 card slots, a bill compartment, and RFID blocking technology. Perfect for the modern professional who values quality and simplicity.',
        shortDescription: 'Slim RFID-blocking wallet, Italian full-grain leather',
        price: 89.99, compareAtPrice: 129.99, categoryId: fashion.id, sellerId: seller1.id, stock: 45,
        status: 'active', isFeatured: true, isTrending: true, isNewArrival: true, brand: 'CartLy Essentials',
        tags: ['leather', 'wallet', 'accessories', 'minimalist'],
        image: 'https://images.unsplash.com/photo-1627123424574-724758594e93?w=800&q=80', imageAlt: 'Leather Wallet',
        ratingAverage: 4.8, ratingCount: 124, sales: 89,
      },
      {
        name: 'Wireless Noise-Cancelling Headphones Pro',
        description: 'Experience studio-quality sound with our flagship wireless headphones. Features 40-hour battery life, active noise cancellation, and premium 40mm drivers. Comes with a travel case.',
        shortDescription: 'Studio-quality ANC headphones, 40hr battery',
        price: 299.0, compareAtPrice: 399.0, categoryId: electronics.id, sellerId: seller2.id, stock: 23,
        status: 'active', isFeatured: true, isTrending: true, brand: 'SoundElite',
        tags: ['headphones', 'wireless', 'audio', 'anc'],
        image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80', imageAlt: 'Headphones',
        ratingAverage: 4.9, ratingCount: 312, sales: 203,
      },
      {
        name: 'Hand-Thrown Ceramic Coffee Mug Set',
        description: 'Each mug in this set of 4 is individually hand-thrown by our master ceramicists. Food-safe glaze, dishwasher safe, and microwave safe. Each piece is unique and comes in a beautiful gift box.',
        shortDescription: 'Set of 4 artisan hand-thrown mugs, gift-ready',
        price: 64.0, categoryId: art.id, sellerId: seller1.id, stock: 18,
        status: 'active', isNewArrival: true, brand: 'Atelier Clay',
        tags: ['ceramic', 'mug', 'handmade', 'kitchen', 'gift'],
        image: 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=800&q=80', imageAlt: 'Ceramic Mugs',
        ratingAverage: 4.7, ratingCount: 67, sales: 45,
      },
      {
        name: 'Mechanical Keyboard TKL RGB',
        description: 'Tenkeyless mechanical keyboard with Cherry MX switches, per-key RGB lighting, aluminum top case, and PBT double-shot keycaps. Includes USB-C detachable cable.',
        shortDescription: 'TKL mechanical keyboard, Cherry MX, RGB',
        price: 149.99, categoryId: electronics.id, sellerId: seller2.id, stock: 31,
        status: 'active', isFeatured: true, brand: 'KeyMaster',
        tags: ['keyboard', 'mechanical', 'rgb', 'gaming', 'tkl'],
        image: 'https://images.unsplash.com/photo-1541140532154-b024d705b90a?w=800&q=80', imageAlt: 'Mechanical Keyboard',
        ratingAverage: 4.6, ratingCount: 189, sales: 134,
      },
      {
        name: 'Linen Blend Oversized Blazer',
        description: 'Elevated everyday dressing with this relaxed-fit blazer in a premium linen-cotton blend. Features a single button closure, flap pockets, and a slightly padded shoulder. Available in 4 neutral colorways.',
        shortDescription: 'Relaxed linen-cotton blazer, available in 4 colorways',
        price: 145.0, compareAtPrice: 195.0, categoryId: fashion.id, sellerId: seller1.id, stock: 27,
        status: 'active', isTrending: true, brand: "Jane's Boutique",
        tags: ['blazer', 'linen', 'fashion', 'women', 'office'],
        image: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=800&q=80', imageAlt: 'Linen Blazer',
        ratingAverage: 4.5, ratingCount: 43, sales: 28,
      },
      {
        name: 'Abstract Oil Painting — "Dusk Horizon"',
        description: 'Original oil on canvas, 24"x36". This piece captures the fleeting beauty of dusk over a coastal horizon. Ships rolled with professional museum-grade packaging. Certificate of authenticity included.',
        shortDescription: 'Original oil painting, 24x36", coastal landscape',
        price: 890.0, categoryId: art.id, sellerId: seller1.id, stock: 1,
        status: 'active', isFeatured: true,
        tags: ['art', 'painting', 'original', 'oil', 'coastal'],
        image: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=800&q=80', imageAlt: 'Oil Painting',
        ratingAverage: 5.0, ratingCount: 8, sales: 3,
      },
      {
        name: 'Portable Mechanical Watch — Silver',
        description: 'Swiss-inspired automatic movement with a 42-hour power reserve. Sapphire crystal glass, 316L stainless steel case and bracelet, 50m water resistance. A timeless piece for the discerning collector.',
        shortDescription: 'Automatic movement, sapphire crystal, 50m WR',
        price: 425.0, compareAtPrice: 550.0, categoryId: fashion.id, sellerId: seller2.id, stock: 9,
        status: 'active', isFeatured: true, isTrending: true, brand: 'Meridian',
        tags: ['watch', 'automatic', 'luxury', 'silver', 'accessories'],
        image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&q=80', imageAlt: 'Watch',
        ratingAverage: 4.9, ratingCount: 56, sales: 41,
      },
      {
        name: 'Bamboo Desk Organizer Set',
        description: 'Keep your workspace tidy with this premium bamboo organizer set. Includes a monitor stand with 2 USB ports, a pen holder, a cable management tray, and a phone stand. Sustainably sourced bamboo.',
        shortDescription: 'Sustainable bamboo desk set with USB monitor stand',
        price: 79.99, categoryId: homeGarden.id, sellerId: seller2.id, stock: 55,
        status: 'active', isNewArrival: true, brand: 'GreenDesk',
        tags: ['desk', 'organizer', 'bamboo', 'home-office', 'sustainable'],
        image: 'https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=800&q=80', imageAlt: 'Desk Organizer',
        ratingAverage: 4.4, ratingCount: 92, sales: 67,
      },
    ];

    for (const p of sampleProducts) {
      const { image, imageAlt, ...rest } = p;
      // eslint-disable-next-line no-await-in-loop
      await prisma.product.create({
        data: {
          ...rest,
          slug: slugify(p.name, { lower: true, strict: true }),
          images: { create: [{ url: image, alt: imageAlt, isPrimary: true }] },
        },
      });
    }
    logger.info(`Created ${sampleProducts.length} sample products`);

    logger.info('\n✅ Seed completed successfully!\n');
    logger.info('📋 Test Accounts:');
    logger.info('   Superadmin: superadmin@CartLy.com / Admin@123456');
    logger.info('   Admin:      admin@CartLy.com      / Admin@123456');
    logger.info('   Seller 1:   seller@CartLy.com     / Seller@123456');
    logger.info('   Seller 2:   seller2@CartLy.com    / Seller@123456');
    logger.info('   User:       user@CartLy.com       / User@123456\n');

    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    logger.error(`Seed failed: ${err.message}`);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  }
};

seedDB();
