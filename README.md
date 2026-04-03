# CartLy — Full-Stack MERN eCommerce Platform

A production-grade, enterprise-level eCommerce platform built with the MERN stack (MongoDB, Express.js, React, Node.js), featuring comprehensive security, real-time features, and a modern editorial design aesthetic.

---

## Tech Stack

### Backend
| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| Framework | Express.js 4.x |
| Database | MongoDB 7 + Mongoose 8 |
| Cache / Sessions | Redis 7 |
| Auth | JWT (access + refresh tokens) + Passport.js |
| OAuth | Google & Facebook OAuth 2.0 |
| Payments | Stripe (PaymentIntents + Webhooks) |
| File Storage | Multer + Sharp + Cloudinary |
| Email | Nodemailer (SMTP) |
| Validation | Joi + Celebrate + express-validator |
| Logging | Winston + Morgan |
| Caching | apicache + Redis |
| Slug Generation | slugify |
| Unique IDs | uuid |

### Frontend
| Layer | Technology |
|---|---|
| Framework | React 18 + TypeScript 5 |
| Build Tool | Vite 5 |
| State | Redux Toolkit + React Query (TanStack v5) |
| Routing | React Router v6 |
| Styling | Tailwind CSS 3 |
| Forms | React Hook Form + Zod |
| Animation | Framer Motion |
| Charts | Recharts |
| HTTP | Axios (with interceptors, token refresh, and per-route 401 handling) |
| File Uploads | React Dropzone |
| Payments | Stripe.js + @stripe/react-stripe-js |
| Icons | Lucide React |
| Carousel | Swiper |
| Notifications | React Hot Toast |
| Date Utilities | date-fns |
| Image Gallery | react-image-gallery |
| Utilities | clsx, tailwind-merge, js-cookie |

### Infrastructure
| Layer | Technology |
|---|---|
| Containerization | Docker + Docker Compose |
| Reverse Proxy | Nginx (rate-limiting, compression, static files) |
| Process | Graceful shutdown, Cluster-ready |

---

## Security Features

### Authentication & Authorization
- JWT access tokens (15min) + refresh tokens (7d) with rotation
- Token blacklisting via Redis on logout
- OAuth 2.0 — Google & Facebook sign-in
- Role-Based Access Control — `user` / `seller` / `admin` / `superadmin`
- Brute-force protection — account lockout after 5 failed attempts
- Password reset with time-limited cryptographic tokens
- Email verification flow
- Seller approval workflow (admin must approve)

### Security Middleware
- **Helmet** — 15 secure HTTP headers
- **CORS** — whitelist-based origin control
- **Rate Limiting** — global (100/15min), auth (10/5min with auto-reset on successful login), uploads (30/hr) — backed by Redis
- **MongoDB Sanitization** — prevents NoSQL injection (`express-mongo-sanitize`)
- **XSS Clean** — strips malicious HTML/JS from inputs
- **HPP** — HTTP Parameter Pollution prevention
- **CSRF** — SameSite cookie policy + token validation

### Data & Performance
- Response caching via Redis (`apicache`) with automatic invalidation
- Compression — gzip responses (threshold: 1KB)
- ETag — conditional requests for client-side caching
- Image optimization — Sharp resizes & converts to WebP before upload
- Cloud image storage — Cloudinary (persistent across deploys, CDN-served, UUID-namespaced public IDs prevent cross-user collisions)
- Old image cleanup — previous avatar/logo/banner/product images are deleted from Cloudinary when replaced
- Full-text search — MongoDB text indexes
- Audit Logs — every admin action tracked in DB (90-day TTL)
- Performance timing — slow request detection (>1000ms)
- Request IDs — traceable across request lifecycle

### Validation
- Joi + Celebrate schemas — server-side request validation
- Zod schemas — client-side form validation
- Mongoose pre-validation — schema-level constraints

---

## Features

### For Buyers / Users
- Browse products with advanced filtering (price, rating, category, tags, stock)
- Full-text search with fuzzy matching and autocomplete
- Product detail with image gallery, variants, ratings
- Shopping cart (persistent, synced to backend)
- Coupon / discount code application
- Stripe checkout with real-time payment
- Order tracking with status history
- Wishlist management
- Address book (multiple shipping addresses)
- Email notifications (order confirmations, shipping)
- Profile & preference management
- Become Seller upgrade flow

### For Sellers
- Upgrade from buyer to seller (admin approval flow)
- Seller dashboard with revenue charts, top products (Recharts)
- Full product management (add/edit/delete with image upload)
- Inventory tracking & low-stock alerts
- Order management & status updates
- Store profile with custom slug
- Product analytics (views, sales, revenue)
- Variant support (sizes, colors, etc.)
- SEO fields (meta title, description)
- Seller profile management

### For Admins
- Real-time dashboard with charts (Recharts)
- User management — view, activate, ban, role assignment
- Seller approval workflow with email notification
- Product oversight — all sellers' products
- Order management across all sellers
- Category management (CRUD)
- Coupon management (create, deactivate, delete)
- Carrier / shipping management
- User feedback management
- Audit log viewer (superadmin only)
- Revenue analytics & growth tracking

---

## Project Structure

```
theCartLy/
├── backend/
│   ├── config/
│   │   ├── cloudinary.js       # Cloudinary client, uploadBuffer (UUID public_id), deleteImage helpers
│   │   ├── db.js               # MongoDB connection
│   │   ├── passport.js         # Passport strategies (local, Google, Facebook, JWT)
│   │   └── redis.js            # Redis client setup
│   ├── controllers/
│   │   ├── authController.js   # register, login, logout, OAuth, password reset, email verify
│   │   ├── carrierController.js# Shipping carrier CRUD
│   │   ├── orderController.js  # Order create/read/update, Stripe webhook
│   │   ├── productController.js# Product CRUD, seller products, wishlist, stats
│   │   └── index.js            # Re-exports all controller functions
│   ├── middleware/
│   │   └── index.js            # authenticate, RBAC, rate limiters, upload (Cloudinary), validate, cache, audit
│   ├── models/
│   │   ├── Carrier.js          # Shipping carrier schema
│   │   ├── Order.js            # Order schema
│   │   ├── Product.js          # Product schema
│   │   ├── User.js             # User schema (all roles)
│   │   └── index.js            # Re-exports all models
│   ├── routes/
│   │   └── index.js            # All route definitions (auth, products, orders, admin, etc.)
│   ├── utils/
│   │   ├── ApiError.js         # Custom error class
│   │   ├── ApiResponse.js      # Standardized response wrapper
│   │   ├── email.js            # Nodemailer email service
│   │   ├── jwt.js              # JWT sign/verify helpers
│   │   ├── logger.js           # Winston logger
│   │   └── seeder.js           # DB seed script
│   ├── logs/
│   │   ├── combined.log
│   │   ├── error.log
│   │   ├── exceptions.log
│   │   └── rejections.log
│   ├── server.js               # Express entry point
│   ├── .env.example
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   │   └── axios.ts        # Axios instance with interceptors + token refresh
│   │   ├── components/
│   │   │   ├── auth/
│   │   │   │   └── ProtectedRoute.tsx
│   │   │   ├── cart/
│   │   │   │   └── CartSidebar.tsx
│   │   │   ├── feedback/
│   │   │   │   └── FeedbackModal.tsx
│   │   │   ├── layout/
│   │   │   │   ├── AdminLayout.tsx
│   │   │   │   ├── Footer.tsx
│   │   │   │   ├── MainLayout.tsx
│   │   │   │   ├── Navbar.tsx
│   │   │   │   └── SellerLayout.tsx
│   │   │   └── products/
│   │   │       └── ProductCard.tsx
│   │   ├── hooks/
│   │   │   └── useOrderStatusUpdate.ts
│   │   ├── pages/
│   │   │   ├── BecomeSeller.tsx
│   │   │   ├── Cart.tsx
│   │   │   ├── Checkout.tsx
│   │   │   ├── ForgotPassword.tsx
│   │   │   ├── Home.tsx
│   │   │   ├── Login.tsx
│   │   │   ├── OrderDetail.tsx
│   │   │   ├── Orders.tsx
│   │   │   ├── ProductDetail.tsx
│   │   │   ├── Products.tsx
│   │   │   ├── Profile.tsx
│   │   │   ├── Register.tsx
│   │   │   ├── ResetPassword.tsx
│   │   │   ├── Store.tsx
│   │   │   ├── VerifyEmail.tsx
│   │   │   ├── Wishlist.tsx
│   │   │   ├── admin/
│   │   │   │   ├── AuditLogs.tsx
│   │   │   │   ├── Carriers.tsx
│   │   │   │   ├── Categories.tsx
│   │   │   │   ├── Coupons.tsx
│   │   │   │   ├── Dashboard.tsx
│   │   │   │   ├── Feedback.tsx
│   │   │   │   ├── Orders.tsx
│   │   │   │   ├── Products.tsx
│   │   │   │   └── Users.tsx
│   │   │   └── seller/
│   │   │       ├── AddProduct.tsx
│   │   │       ├── Dashboard.tsx
│   │   │       ├── EditProduct.tsx
│   │   │       ├── Orders.tsx
│   │   │       ├── Products.tsx
│   │   │       └── Profile.tsx
│   │   ├── store/
│   │   │   ├── slices/
│   │   │   │   ├── authSlice.ts
│   │   │   │   ├── cartSlice.ts
│   │   │   │   ├── productSlice.ts
│   │   │   │   └── uiSlice.ts
│   │   │   └── index.ts        # Redux store configuration
│   │   ├── types/
│   │   │   └── index.ts        # TypeScript interfaces & types
│   │   ├── utils/
│   │   │   └── fuzzy.ts        # Fuzzy search utility
│   │   ├── App.tsx
│   │   ├── index.css           # Tailwind + custom design system
│   │   └── main.tsx
│   ├── Dockerfile
│   ├── index.html
│   ├── nginx-spa.conf          # Nginx SPA config
│   ├── package.json
│   ├── postcss.config.js
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   └── vite.config.ts
├── docker-compose.yml
├── nginx.conf
└── README.md
```

---

## API Routes Reference

### Auth (`/api/auth`)
| Method | Route | Access |
|---|---|---|
| POST | `/register` | Public |
| POST | `/login` | Public |
| POST | `/logout` | Private |
| POST | `/refresh` | Public |
| GET | `/me` | Private |
| POST | `/forgot-password` | Public |
| PUT | `/reset-password/:token` | Public |
| GET | `/verify-email/:token` | Public |
| PUT | `/change-password` | Private |
| GET | `/google` | OAuth |
| GET | `/facebook` | OAuth |

### Products (`/api/products`)
| Method | Route | Access |
|---|---|---|
| GET | `/` | Public |
| GET | `/featured` | Public |
| GET | `/my-products` | Seller |
| GET | `/seller-stats` | Seller |
| GET | `/:slug` | Public |
| GET | `/:id/related` | Public |
| POST | `/` | Seller |
| PUT | `/:id` | Seller (own) |
| DELETE | `/:id` | Seller (own) |
| POST | `/:id/wishlist` | Private |

### Orders (`/api/orders`)
| Method | Route | Access |
|---|---|---|
| POST | `/` | Private |
| GET | `/my-orders` | Private |
| GET | `/seller-orders` | Seller |
| GET | `/:id` | Private (own/admin) |
| PUT | `/:id/status` | Seller/Admin |
| POST | `/:id/return` | Private |
| POST | `/webhook` | Stripe |

### Admin (`/api/admin`)
| Method | Route | Access |
|---|---|---|
| GET | `/dashboard` | Admin |
| GET | `/users` | Admin |
| PUT | `/users/:id` | Admin |
| DELETE | `/users/:id` | Admin |
| POST | `/users/:id/approve-seller` | Admin |
| GET | `/products` | Admin |
| GET | `/orders` | Admin |
| GET/POST/DELETE | `/coupons` | Admin |
| GET/POST/PUT/DELETE | `/carriers` | Admin |
| GET/POST/PUT/DELETE | `/categories` | Admin |
| GET/DELETE | `/feedback` | Admin |
| GET | `/audit-logs` | Superadmin |

### User (`/api/users`)
| Method | Route | Access |
|---|---|---|
| PUT | `/profile` | Private |
| GET/POST/PUT/DELETE | `/addresses` | Private |
| POST | `/become-seller` | Private |
| GET | `/wishlist` | Private |

### Cart (`/api/cart`)
| Method | Route | Access |
|---|---|---|
| GET | `/` | Private |
| POST | `/` | Private |
| PUT | `/:itemId` | Private |
| DELETE | `/:itemId` | Private |
| DELETE | `/` | Private |

### Reviews (`/api/reviews`)
| Method | Route | Access |
|---|---|---|
| POST | `/:productId` | Private |
| PUT | `/:id` | Private (own) |
| DELETE | `/:id` | Private (own) |

### Carriers (`/api/carriers`)
| Method | Route | Access |
|---|---|---|
| GET | `/` | Public |
| POST | `/` | Admin |
| PUT | `/:id` | Admin |
| DELETE | `/:id` | Admin |

### Feedback (`/api/feedback`)
| Method | Route | Access |
|---|---|---|
| POST | `/` | Private |
| GET | `/` | Admin |
| DELETE | `/:id` | Admin |

---

## Quick Start

### Prerequisites
- Node.js 20+
- MongoDB 7+
- Redis 7+
- Cloudinary account (free tier)
- (Optional) Docker + Docker Compose

### Option A — Manual Setup

**1. Install dependencies**
```bash
cd backend && npm install
cd ../frontend && npm install
```

**2. Configure environment**
```bash
cp backend/.env.example backend/.env
# Edit backend/.env with your values
```

**3. Seed the database**
```bash
cd backend && npm run seed
```

**4. Start services**
```bash
# Terminal 1 — Backend
cd backend && npm run dev

# Terminal 2 — Frontend
cd frontend && npm run dev
```

Open: `http://localhost:5173`

---

### Option B — Docker Compose

```bash
# Copy and edit env file first
cp backend/.env.example backend/.env

# Start everything
docker-compose up --build

# Seed the database (first time)
docker-compose exec backend node utils/seeder.js
```

Open: `http://localhost`

Docker services:
- **MongoDB** (mongo:7.0) — port 27017
- **Redis** (redis:7.2-alpine) — port 6379
- **Backend** (Node.js) — port 5000
- **Frontend** (React/Vite) — port 80
- **Nginx** — ports 80 / 443 (reverse proxy)

---

## Default Test Accounts (after seeding)

| Role | Email | Password |
|---|---|---|
| Superadmin | superadmin@CartLy.com | Admin@123456 |
| Admin | admin@CartLy.com | Admin@123456 |
| Seller | seller@CartLy.com | Seller@123456 |
| Seller 2 | seller2@CartLy.com | Seller@123456 |
| User | user@CartLy.com | User@123456 |

---

## Environment Variables

Full template in `backend/.env.example`. Key variables:

```env
# Server
NODE_ENV=development
PORT=5000
FRONTEND_URL=http://localhost:5173

# Database
MONGODB_URI=mongodb://localhost:27017/CartLy_ecommerce

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-32-char-minimum-secret
JWT_ACCESS_EXPIRE=15m
JWT_REFRESH_SECRET=your-refresh-secret
JWT_REFRESH_EXPIRE=7d
JWT_COOKIE_EXPIRE=7

# OAuth — Google
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/google/callback

# OAuth — Facebook
FACEBOOK_APP_ID=...
FACEBOOK_APP_SECRET=...
FACEBOOK_CALLBACK_URL=http://localhost:5000/api/auth/facebook/callback

# Session
SESSION_SECRET=your-session-secret

# Email (Nodemailer)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
FROM_NAME=CartLy
FROM_EMAIL=noreply@CartLy.com

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Cloudinary — cloud image storage (required in production)
# Option A — single URL
CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>
# Option B — individual vars
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
AUTH_RATE_LIMIT_MAX=10

# Crypto
CRYPTO_SECRET=your-crypto-secret-32-chars-minimum
```

---

## Design System

The UI follows an **editorial/luxury** aesthetic inspired by high-end fashion and editorial publications:

- **Typography**: Manrope (headlines) + Plus Jakarta Sans (body) + JetBrains Mono (code)
- **Color**: Deep navy `#1A237E` primary, neutral surfaces, precise accent system
- **Spacing**: 8px grid system
- **Border Radius**: Sharp (2px–8px), intentionally not rounded
- **Motion**: Framer Motion — staggered reveals, slide-in drawers, scale animations
- **Shadows**: Editorial shadow system (light, directional)

---

## Nginx Configuration

`nginx.conf` (root, for Docker) configures:
- Worker connections: 1024
- Client max body size: 20MB
- Rate limit zones: API (30 req/min), Auth (10 req/min)
- Gzip compression (level 6)
- Security headers: `X-Frame-Options`, `X-Content-Type-Options`, `X-XSS-Protection`, `Referrer-Policy`
- Reverse proxy to backend (`/api/`) and frontend (`/`)

`frontend/nginx-spa.conf` handles SPA fallback (`try_files $uri /index.html`).

---

## Production Deployment

1. Set `NODE_ENV=production` in `.env`
2. Use strong, unique secrets for all JWT/session keys
3. Configure HTTPS in Nginx (add SSL certificates)
4. Set up MongoDB Atlas or a managed MongoDB cluster
5. Use managed Redis (Redis Cloud / Upstash)
6. Configure Stripe webhooks pointing to `/api/orders/webhook`
7. Set `CLOUDINARY_URL` (or the three individual vars) — images are uploaded directly to Cloudinary and served via CDN
8. Configure a production SMTP service (SendGrid, Resend, Postmark, etc.)

---

## Changelog

### Fixes & Improvements

- **Cloudinary image storage** — Images (product photos, avatars, store logos/banners) are now uploaded directly to Cloudinary and served via CDN instead of being saved to the local server filesystem. This fixes image persistence on ephemeral platforms like Render's free tier. Sharp still handles resizing and WebP conversion before the upload. Supports both `CLOUDINARY_URL` and individual credential vars.
- **Unique Cloudinary public IDs** — Every upload is assigned a UUID-based `public_id` (e.g. `cartly/avatars/3f2a1b4c-...`) so no two users can ever overwrite each other's files, even if they upload images with the same filename.
- **Automatic old image cleanup** — When a user replaces their avatar, store logo, store banner, or product images, the previous Cloudinary asset is deleted automatically using the stored `public_id`. The `public_id` is persisted in MongoDB alongside the image URL.
- **Auth error messages** — Login failures (wrong email/password) now correctly surface the API message (`"Invalid email or password"`) instead of the generic Axios `"Request failed with status code 401"`. Root cause: the response interceptor was attempting a token refresh on every 401, including intentional login failures. Auth endpoints (`/auth/login`, `/auth/register`) are now excluded from the refresh retry logic.
- **Auth rate limiter window** — Reduced from 15 minutes to 5 minutes per window.
- **Auth rate limiter reset** — The `authLimiter` IP counter is now cleared automatically after a successful login, so a legitimate user who previously failed attempts is not penalized for the rest of the window.

---

## License

MIT — Built with love for CartLy Platform
