const productService = require('../../services/productService');
const { prisma } = require('../../config/prisma');

describe('productService.serializeProduct', () => {
  const row = {
    id: 'p1', name: 'Red Shoe', slug: 'red-shoe', description: 'desc', price: 100,
    compareAtPrice: 200, currency: 'USD', tags: ['red'], brand: 'Acme',
    stock: 5, lowStockThreshold: 5, trackInventory: true, hasVariants: false,
    ratingAverage: 4.5, ratingCount: 10, ratingDistribution: { '5': 8, '4': 2 },
    status: 'active', isFeatured: true, isTrending: false, isNewArrival: false,
    views: 3, sales: 1, revenue: 100, wishlistCount: 2,
    seo: { metaTitle: 'T' }, shipping: { weight: 100, isFreeShipping: true },
    discount: { type: 'percentage', value: 10 },
    categoryId: 'c1', sellerId: 's1',
    images: [{ id: 'i1', url: 'u', publicId: 'pid', alt: 'a', isPrimary: true }],
    variants: [{ id: 'v1', name: 'Size', value: 'XL', stock: 2, price: null, sku: null, images: [] }],
    category: { id: 'c1', name: 'Cat', slug: 'cat', parentId: null },
    seller: { id: 's1', name: 'Seller', sellerProfile: { storeName: 'Shop', storeLogo: 'logo' } },
    createdAt: new Date(), updatedAt: new Date(),
  };

  it('rebuilds nested rating, images, virtuals, and populated relations', () => {
    const p = productService.serializeProduct(row);
    expect(p._id).toBe('p1');
    expect(p.id).toBe('p1');
    expect(p.rating).toEqual({ average: 4.5, count: 10, distribution: { '5': 8, '4': 2 } });
    expect(p.images[0]).toMatchObject({ _id: 'i1', url: 'u', public_id: 'pid', isPrimary: true });
    expect(p.variants[0]).toMatchObject({ _id: 'v1', name: 'Size', value: 'XL' });
    expect(p.discountedPrice).toBe(90); // 10% off 100
    expect(p.discountPercentage).toBe(50); // (200-100)/200
    expect(p.inStock).toBe(true);
    expect(p.category).toMatchObject({ _id: 'c1', name: 'Cat', parent: null });
    expect(p.seller).toMatchObject({ _id: 's1', name: 'Seller' });
    expect(p.seller.sellerProfile.storeName).toBe('Shop');
    expect(p.costPrice).toBeUndefined();
  });

  it('falls back to ids when relations are not included', () => {
    const p = productService.serializeProduct({ ...row, category: undefined, seller: undefined });
    expect(p.category).toBe('c1');
    expect(p.seller).toBe('s1');
  });

  it('defaults rating distribution and respects no-discount', () => {
    const p = productService.serializeProduct({ ...row, ratingDistribution: null, discount: null });
    expect(p.rating.distribution).toEqual({ '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 });
    expect(p.discountedPrice).toBe(100);
  });
});

describe('productService helpers', () => {
  it('normalizeProductBody splits tags and nests shipping/seo', () => {
    const out = productService.normalizeProductBody({
      name: 'X', tags: 'a, b ,c', weight: 100, isFreeShipping: true,
      metaTitle: 'T', metaDescription: 'D',
    });
    expect(out.tags).toEqual(['a', 'b', 'c']);
    expect(out.shipping).toEqual({ weight: 100, isFreeShipping: true });
    expect(out.seo).toEqual({ metaTitle: 'T', metaDescription: 'D' });
    expect(out.weight).toBeUndefined();
    expect(out.metaTitle).toBeUndefined();
  });

  it('generateSku produces a unique-looking SKU', () => {
    const sku = productService.generateSku();
    expect(sku).toMatch(/^SKU-\d+-[A-Z0-9]+$/);
  });
});

describe('productService.generateUniqueSlug', () => {
  afterEach(async () => {
    await prisma.product.deleteMany({});
    await prisma.category.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it('appends a counter when the base slug collides', async () => {
    const seller = await prisma.user.create({ data: { name: 'S', email: `s${Date.now()}@t.com`, role: 'seller' } });
    const cat = await prisma.category.create({ data: { name: 'C', slug: `c-${Date.now()}` } });
    await prisma.product.create({ data: { name: 'Cool Thing', slug: 'cool-thing', description: 'd', price: 1, categoryId: cat.id, sellerId: seller.id } });
    const slug = await productService.generateUniqueSlug('Cool Thing');
    expect(slug).toBe('cool-thing-1');
  });
});

describe('productService.searchProductIds', () => {
  let seller, cat;
  beforeEach(async () => {
    seller = await prisma.user.create({ data: { name: 'S', email: `s${Date.now()}${Math.random()}@t.com`, role: 'seller' } });
    cat = await prisma.category.create({ data: { name: 'C', slug: `c-${Date.now()}${Math.random()}` } });
    await prisma.product.create({ data: { name: 'Blue Running Shoes', slug: `blue-${Date.now()}`, description: 'fast comfortable', price: 50, status: 'active', categoryId: cat.id, sellerId: seller.id } });
    await prisma.product.create({ data: { name: 'Red Hat', slug: `red-${Date.now()}`, description: 'warm wool', price: 20, status: 'active', categoryId: cat.id, sellerId: seller.id } });
  });
  afterEach(async () => {
    await prisma.product.deleteMany({});
    await prisma.category.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it('returns only products matching the search term', async () => {
    const { ids, total } = await productService.searchProductIds({ term: 'shoes', filters: [], skip: 0, take: 20 });
    expect(total).toBe(1);
    expect(ids).toHaveLength(1);
    const p = await prisma.product.findUnique({ where: { id: ids[0] } });
    expect(p.name).toBe('Blue Running Shoes');
  });

  it('applies extra filters alongside the search', async () => {
    const { Prisma } = require('@prisma/client');
    const { total } = await productService.searchProductIds({
      term: 'warm', filters: [Prisma.sql`p."price" < 10`], skip: 0, take: 20,
    });
    expect(total).toBe(0); // Red Hat is 20
  });
});
