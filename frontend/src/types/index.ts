// ============================================================
// CORE TYPES
// ============================================================

export type UserRole = 'user' | 'seller' | 'admin' | 'superadmin';
export type OrderStatus =
  | 'pending' | 'confirmed' | 'processing' | 'shipped'
  | 'out_for_delivery' | 'delivered' | 'cancelled'
  | 'return_requested' | 'returned' | 'refunded';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'partially_refunded';
export type ProductStatus = 'draft' | 'active' | 'inactive' | 'suspended' | 'archived';

// ============================================================
// USER TYPES
// ============================================================

export interface Address {
  _id: string;
  label: string;
  street: string;
  city: string;
  state: string;
  country: string;
  zipCode: string;
  isDefault: boolean;
}

export interface SellerProfile {
  storeName: string;
  storeBio?: string;
  storeLogo?: string;
  storeBanner?: string;
  storeSlug: string;
  totalSales: number;
  totalRevenue: number;
  rating: number;
  reviewCount: number;
  isApproved: boolean;
  approvedAt?: string;
}

export interface UserPreferences {
  currency: string;
  language: string;
  theme: 'light' | 'dark' | 'system';
  notifications: {
    email: boolean;
    push: boolean;
    orderUpdates: boolean;
    promotions: boolean;
  };
}

export interface User {
  _id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string;
  phone?: string;
  dateOfBirth?: string;
  gender?: string;
  addresses: Address[];
  sellerProfile?: SellerProfile;
  isEmailVerified: boolean;
  isActive: boolean;
  isBanned: boolean;
  banReason?: string;
  lastLoginAt?: string;
  preferences: UserPreferences;
  wishlist: Product[];
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// PRODUCT TYPES
// ============================================================

export interface ProductImage {
  url: string;
  alt?: string;
  isPrimary: boolean;
}

export interface ProductVariant {
  _id: string;
  name: string;
  value: string;
  stock: number;
  price?: number;
  sku?: string;
  images?: string[];
}

export interface ProductRating {
  average: number;
  count: number;
  distribution: Record<string, number>;
}

export interface ProductDiscount {
  type: 'percentage' | 'fixed';
  value: number;
  validFrom?: string;
  validUntil?: string;
}

export interface Product {
  _id: string;
  name: string;
  slug: string;
  description: string;
  shortDescription?: string;
  price: number;
  compareAtPrice?: number;
  discountedPrice?: number;
  discountPercentage?: number;
  currency: string;
  images: ProductImage[];
  category: Category;
  tags: string[];
  brand?: string;
  seller: User;
  sku?: string;
  stock: number;
  trackInventory: boolean;
  inStock: boolean;
  hasVariants: boolean;
  variants: ProductVariant[];
  rating: ProductRating;
  status: ProductStatus;
  isFeatured: boolean;
  isTrending: boolean;
  isNewArrival: boolean;
  views: number;
  sales: number;
  wishlistCount: number;
  discount?: ProductDiscount;
  shipping?: {
    weight?: number;
    isFreeShipping: boolean;
  };
  seo?: {
    metaTitle?: string;
    metaDescription?: string;
  };
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// ORDER TYPES
// ============================================================

export interface OrderItem {
  _id: string;
  product: Product | string;
  seller: User | string;
  name: string;
  image?: string;
  price: number;
  quantity: number;
  variant?: { name: string; value: string };
}

export interface Order {
  _id: string;
  orderNumber: string;
  user: User | string;
  items: OrderItem[];
  shippingAddress: {
    name: string;
    street: string;
    city: string;
    state: string;
    country: string;
    zipCode: string;
    phone?: string;
  };
  subtotal: number;
  shippingCost: number;
  taxAmount: number;
  discountAmount: number;
  totalPrice: number;
  currency: string;
  paymentMethod: string;
  paymentStatus: PaymentStatus;
  paymentResult?: {
    id: string;
    status: string;
    receiptUrl?: string;
  };
  paidAt?: string;
  status: OrderStatus;
  tracking?: {
    carrier?: string;
    carrierId?: string;
    trackingNumber?: string;
    trackingUrl?: string;
    estimatedDelivery?: string;
    lastLocation?: string;
    lastLocationUpdatedAt?: string;
  };
  preferredCarrier?: string;
  statusHistory: Array<{
    status: string;
    timestamp: string;
    note?: string;
  }>;
  deliveredAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  customerNote?: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// CART TYPES
// ============================================================

export interface CartItem {
  _id: string;
  product: Product;
  quantity: number;
  price: number;
  variant?: { name: string; value: string };
  addedAt: string;
}

export interface Cart {
  items: CartItem[];
  subtotal: number;
  itemCount: number;
  coupon?: {
    code: string;
    discountType: string;
    discountValue: number;
    validUntil: string;
  };
}

// ============================================================
// REVIEW TYPES
// ============================================================

export interface Review {
  _id: string;
  product: string;
  user: { _id: string; name: string; avatar?: string };
  rating: number;
  title?: string;
  body?: string;
  images?: string[];
  isVerifiedPurchase: boolean;
  helpfulVotes: number;
  sellerReply?: { body: string; repliedAt: string };
  createdAt: string;
}

// ============================================================
// CATEGORY TYPES
// ============================================================

export interface Category {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  image?: string;
  icon?: string;
  parent?: string;
  isActive: boolean;
  sortOrder: number;
  productCount?: number;
}

// ============================================================
// API RESPONSE TYPES
// ============================================================

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
  timestamp: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  message: string;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// ============================================================
// FORM TYPES
// ============================================================

export interface LoginForm {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface RegisterForm {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export interface ProductForm {
  name: string;
  description: string;
  shortDescription?: string;
  price: number;
  compareAtPrice?: number;
  category: string;
  tags?: string[];
  stock: number;
  brand?: string;
  sku?: string;
  status: ProductStatus;
  isFeatured?: boolean;
  images?: File[];
}

// ============================================================
// FILTER TYPES
// ============================================================

export interface ProductFilters {
  search?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  rating?: number;
  inStock?: boolean;
  sort?: string;
  page?: number;
  limit?: number;
  featured?: boolean;
  trending?: boolean;
  seller?: string;
  tags?: string;
}

// ============================================================
// CARRIER TYPES
// ============================================================

export interface Carrier {
  _id: string;
  name: string;
  code: string;
  trackingUrlTemplate?: string;
  logoUrl?: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// ADMIN TYPES
// ============================================================

export interface DashboardStats {
  users: { total: number; newThisMonth: number };
  sellers: { total: number; pendingApprovals: number };
  products: { total: number; active: number };
  orders: { total: number; thisMonth: number; byStatus: Array<{ _id: string; count: number }> };
  revenue: { thisMonth: number; lastMonth: number; growth: number };
  recentOrders: Order[];
  topSellingProducts: Product[];
  categoryStats: Array<{ name: string; productCount: number }>;
}
