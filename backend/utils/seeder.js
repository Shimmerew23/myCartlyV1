require('dotenv').config();
const slugify = require('slugify'); // add at top with other requires
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { Category } = require('../models/index');
const Product = require('../models/Product');
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

const seedDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    logger.info('Connected to MongoDB for seeding');

    // Clear existing data
    await Promise.all([
      User.deleteMany({}),
      Category.deleteMany({}),
      Product.deleteMany({}),
    ]);
    logger.info('Cleared existing data');

    // Create categories
    const categories = await Category.insertMany(CATEGORIES);
    logger.info(`Created ${categories.length} categories`);

    // Create superadmin
    const superadmin = await User.create({
      name: 'Super Admin',
      email: 'superadmin@CartLy.com',
      password: 'Admin@123456',
      role: 'superadmin',
      isEmailVerified: true,
      isActive: true,
    });

    // Create admin
    const admin = await User.create({
      name: 'Admin User',
      email: 'admin@CartLy.com',
      password: 'Admin@123456',
      role: 'admin',
      isEmailVerified: true,
      isActive: true,
    });

    // Create sellers
    const seller1 = await User.create({
      name: 'Jane CartLy',
      email: 'seller@CartLy.com',
      password: 'Seller@123456',
      role: 'seller',
      isEmailVerified: true,
      isActive: true,
      sellerProfile: {
        storeName: 'Jane\'s Boutique',
        storeBio: 'Premium curated fashion and accessories',
        storeSlug: 'janes-boutique',
        isApproved: true,
        approvedAt: new Date(),
        totalSales: 150,
        totalRevenue: 12500,
      },
    });

    const seller2 = await User.create({
      name: 'Marco Tech',
      email: 'seller2@CartLy.com',
      password: 'Seller@123456',
      role: 'seller',
      isEmailVerified: true,
      isActive: true,
      sellerProfile: {
        storeName: 'Marco\'s Tech Hub',
        storeBio: 'Latest gadgets and electronics',
        storeSlug: 'marcos-tech-hub',
        isApproved: true,
        approvedAt: new Date(),
      },
    });

    // Create regular user
    await User.create({
      name: 'Regular User',
      email: 'user@CartLy.com',
      password: 'User@123456',
      role: 'user',
      isEmailVerified: true,
      isActive: true,
    });

    logger.info('Created users: superadmin, admin, 2 sellers, 1 user');

    // Create sample products
    const fashionCat = categories.find((c) => c.slug === 'fashion');
    const electronicsCat = categories.find((c) => c.slug === 'electronics');
    const artCat = categories.find((c) => c.slug === 'art-collectibles');

    const sampleProducts = [
      {
        name: 'Premium Leather Minimalist Wallet',
        slug: slugify('Premium Leather Minimalist Wallet', { lower: true, strict: true }),
        description: 'Handcrafted from full-grain Italian leather. This slim wallet features 6 card slots, a bill compartment, and RFID blocking technology. Perfect for the modern professional who values quality and simplicity.',
        shortDescription: 'Slim RFID-blocking wallet, Italian full-grain leather',
        price: 89.99,
        compareAtPrice: 129.99,
        category: fashionCat._id,
        seller: seller1._id,
        stock: 45,
        status: 'active',
        isFeatured: true,
        isTrending: true,
        isNewArrival: true,
        brand: 'CartLy Essentials',
        tags: ['leather', 'wallet', 'accessories', 'minimalist'],
        images: [{ url: 'https://images.unsplash.com/photo-1627123424574-724758594e93?w=800&q=80', alt: 'Leather Wallet', isPrimary: true }],
        rating: { average: 4.8, count: 124 },
        sales: 89,
      },
      {
        name: 'Wireless Noise-Cancelling Headphones Pro',
        slug: slugify('Wireless Noise-Cancelling Headphones Pro', { lower: true, strict: true }),
        description: 'Experience studio-quality sound with our flagship wireless headphones. Features 40-hour battery life, active noise cancellation, and premium 40mm drivers. Comes with a travel case.',
        shortDescription: 'Studio-quality ANC headphones, 40hr battery',
        price: 299.00,
        compareAtPrice: 399.00,
        category: electronicsCat._id,
        seller: seller2._id,
        stock: 23,
        status: 'active',
        isFeatured: true,
        isTrending: true,
        brand: 'SoundElite',
        tags: ['headphones', 'wireless', 'audio', 'anc'],
        images: [{ url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80', alt: 'Headphones', isPrimary: true }],
        rating: { average: 4.9, count: 312 },
        sales: 203,
      },
      {
        name: 'Hand-Thrown Ceramic Coffee Mug Set',
        slug: slugify('Hand-Thrown Ceramic Coffee Mug Set', { lower: true, strict: true }),
        description: 'Each mug in this set of 4 is individually hand-thrown by our master ceramicists. Food-safe glaze, dishwasher safe, and microwave safe. Each piece is unique and comes in a beautiful gift box.',
        shortDescription: 'Set of 4 artisan hand-thrown mugs, gift-ready',
        price: 64.00,
        category: artCat._id,
        seller: seller1._id,
        stock: 18,
        status: 'active',
        isNewArrival: true,
        brand: 'Atelier Clay',
        tags: ['ceramic', 'mug', 'handmade', 'kitchen', 'gift'],
        images: [{ url: 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=800&q=80', alt: 'Ceramic Mugs', isPrimary: true }],
        rating: { average: 4.7, count: 67 },
        sales: 45,
      },
      {
        name: 'Mechanical Keyboard TKL RGB',
        slug: slugify('Mechanical Keyboard TKL RGB', { lower: true, strict: true }),
        description: 'Tenkeyless mechanical keyboard with Cherry MX switches, per-key RGB lighting, aluminum top case, and PBT double-shot keycaps. Includes USB-C detachable cable.',
        shortDescription: 'TKL mechanical keyboard, Cherry MX, RGB',
        price: 149.99,
        category: electronicsCat._id,
        seller: seller2._id,
        stock: 31,
        status: 'active',
        isFeatured: true,
        brand: 'KeyMaster',
        tags: ['keyboard', 'mechanical', 'rgb', 'gaming', 'tkl'],
        images: [{ url: 'https://images.unsplash.com/photo-1541140532154-b024d705b90a?w=800&q=80', alt: 'Mechanical Keyboard', isPrimary: true }],
        rating: { average: 4.6, count: 189 },
        sales: 134,
      },
      {
        name: 'Linen Blend Oversized Blazer',
        slug: slugify('Linen Blend Oversized Blazer', { lower: true, strict: true }),
        description: 'Elevated everyday dressing with this relaxed-fit blazer in a premium linen-cotton blend. Features a single button closure, flap pockets, and a slightly padded shoulder. Available in 4 neutral colorways.',
        shortDescription: 'Relaxed linen-cotton blazer, available in 4 colorways',
        price: 145.00,
        compareAtPrice: 195.00,
        category: fashionCat._id,
        seller: seller1._id,
        stock: 27,
        status: 'active',
        isTrending: true,
        brand: 'Jane\'s Boutique',
        tags: ['blazer', 'linen', 'fashion', 'women', 'office'],
        images: [{ url: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=800&q=80', alt: 'Linen Blazer', isPrimary: true }],
        rating: { average: 4.5, count: 43 },
        sales: 28,
      },
      {
        name: 'Abstract Oil Painting — "Dusk Horizon"',
        slug: slugify('Abstract Oil Painting — Dusk Horizon', { lower: true, strict: true }),
        description: 'Original oil on canvas, 24"x36". This piece captures the fleeting beauty of dusk over a coastal horizon. Ships rolled with professional museum-grade packaging. Certificate of authenticity included.',
        shortDescription: 'Original oil painting, 24x36", coastal landscape',
        price: 890.00,
        category: artCat._id,
        seller: seller1._id,
        stock: 1,
        status: 'active',
        isFeatured: true,
        tags: ['art', 'painting', 'original', 'oil', 'coastal'],
        images: [{ url: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=800&q=80', alt: 'Oil Painting', isPrimary: true }],
        rating: { average: 5.0, count: 8 },
        sales: 3,
      },
      {
        name: 'Portable Mechanical Watch — Silver',
        slug: slugify('Portable Mechanical Watch — Silver', { lower: true, strict: true }),
        description: 'Swiss-inspired automatic movement with a 42-hour power reserve. Sapphire crystal glass, 316L stainless steel case and bracelet, 50m water resistance. A timeless piece for the discerning collector.',
        shortDescription: 'Automatic movement, sapphire crystal, 50m WR',
        price: 425.00,
        compareAtPrice: 550.00,
        category: fashionCat._id,
        seller: seller2._id,
        stock: 9,
        status: 'active',
        isFeatured: true,
        isTrending: true,
        brand: 'Meridian',
        tags: ['watch', 'automatic', 'luxury', 'silver', 'accessories'],
        images: [{ url: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&q=80', alt: 'Watch', isPrimary: true }],
        rating: { average: 4.9, count: 56 },
        sales: 41,
      },
      {
        name: 'Bamboo Desk Organizer Set',
        slug: slugify('Bamboo Desk Organizer Set', { lower: true, strict: true }),
        description: 'Keep your workspace tidy with this premium bamboo organizer set. Includes a monitor stand with 2 USB ports, a pen holder, a cable management tray, and a phone stand. Sustainably sourced bamboo.',
        shortDescription: 'Sustainable bamboo desk set with USB monitor stand',
        price: 79.99,
        category: categories.find((c) => c.slug === 'home-garden')._id,
        seller: seller2._id,
        stock: 55,
        status: 'active',
        isNewArrival: true,
        brand: 'GreenDesk',
        tags: ['desk', 'organizer', 'bamboo', 'home-office', 'sustainable'],
        images: [{ url: 'https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=800&q=80', alt: 'Desk Organizer', isPrimary: true }],
        rating: { average: 4.4, count: 92 },
        sales: 67,
      },
    ];

    await Product.insertMany(sampleProducts);
    logger.info(`Created ${sampleProducts.length} sample products`);

    logger.info('\n✅ Seed completed successfully!\n');
    logger.info('📋 Test Accounts:');
    logger.info('   Superadmin: superadmin@CartLy.com / Admin@123456');
    logger.info('   Admin:      admin@CartLy.com      / Admin@123456');
    logger.info('   Seller 1:   seller@CartLy.com     / Seller@123456');
    logger.info('   Seller 2:   seller2@CartLy.com    / Seller@123456');
    logger.info('   User:       user@CartLy.com       / User@123456\n');

    process.exit(0);
  } catch (err) {
    logger.error(`Seed failed: ${err.message}`);
    process.exit(1);
  }
};

seedDB();
