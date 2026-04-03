# 🎨 CartLy — Full-Stack MERN eCommerce Platform

A production-grade, enterprise-level eCommerce platform built with the MERN stack (MongoDB, Express.js, React, Node.js), featuring comprehensive security, real-time features, and a modern editorial design aesthetic.

---

## 🚀 Tech Stack

### Backend
| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| Framework | Express.js 4.x |
| Database | MongoDB 7 + Mongoose |
| Cache / Sessions | Redis 7 |
| Auth | JWT (access + refresh tokens) + Passport.js |
| OAuth | Google & Facebook OAuth 2.0 |
| Payments | Stripe (PaymentIntents + Webhooks) |
| File Storage | Multer + Sharp (local) |
| Email | Nodemailer (SMTP) |
| Validation | Joi + express-validator |
| Logging | Winston + Morgan |

### Frontend
| Layer | Technology |
|---|---|
| Framework | React 18 + TypeScript |
| Build Tool | Vite 5 |
| State | Redux Toolkit + React Query |
| Routing | React Router v6 |
| Styling | Tailwind CSS 3 |
| Forms | React Hook Form + Zod |
| Animation | Framer Motion |
| Charts | Recharts |
| HTTP | Axios (with interceptors + token refresh) |
| File Uploads | React Dropzone |

### Infrastructure
| Layer | Technology |
|---|---|
| Containerization | Docker + Docker Compose |
| Reverse Proxy | Nginx |
| Process | Graceful shutdown, Cluster-ready |

---

## 🔒 Security Features (All 41 Middleware Implemented)

### Authentication & Authorization
- ✅ **JWT** access tokens (15min) + refresh tokens (7d) with rotation
- ✅ **Token blacklisting** via Redis on logout
- ✅ **OAuth 2.0** — Google & Facebook sign-in
- ✅ **Role-Based Access Control** — `user` / `seller` / `admin` / `superadmin`
- ✅ **Brute-force protection** — account lockout after 5 failed attempts
- ✅ **Password reset** with time-limited cryptographic tokens
- ✅ **Email verification** flow
- ✅ **Seller approval** workflow (admin must approve)

### Security Middleware
- ✅ **Helmet** — 15 secure HTTP headers
- ✅ **CORS** — whitelist-based origin control
- ✅ **Rate Limiting** — global (100/15min), auth (10/15min), uploads (30/hr)
- ✅ **MongoDB Sanitization** — prevents NoSQL injection (`express-mongo-sanitize`)
- ✅ **XSS Clean** — strips malicious HTML/JS from inputs
- ✅ **HPP** — HTTP Parameter Pollution prevention
- ✅ **CSRF** — SameSite cookie policy + token validation

### Data & Performance
- ✅ **Response caching** via Redis with automatic invalidation
- ✅ **Compression** — gzip responses (threshold: 1KB)
- ✅ **ETag** — conditional requests for client-side caching
- ✅ **Image optimization** — Sharp resizes & converts to WebP
- ✅ **Full-text search** — MongoDB text indexes

### Logging & Monitoring
- ✅ **Winston** — structured logging to files (error.log, combined.log)
- ✅ **Morgan** — HTTP request logging
- ✅ **Audit Logs** — every admin action tracked in DB (90-day TTL)
- ✅ **Performance timing** — slow request detection (>1000ms)
- ✅ **Request IDs** — traceable across request lifecycle

### Validation
- ✅ **Joi schemas** — server-side request validation
- ✅ **Zod schemas** — client-side form validation
- ✅ **Mongoose pre-validation** — schema-level constraints

---

## 🌟 Features

### For Buyers / Users
- Browse products with advanced filtering (price, rating, category, tags, stock)
- Full-text search with autocomplete
- Product detail with image gallery, variants, ratings
- Shopping cart (persistent, synced to backend)
- Coupon / discount code application
- Stripe checkout with real-time payment
- Order tracking with status history
- Wishlist management
- Address book (multiple shipping addresses)
- Email notifications (order confirmations, shipping)
- Profile & preference management

### For Sellers
- Upgrade from buyer to seller (admin approval flow)
- Seller dashboard with revenue charts, top products
- Full product management (add/edit/delete with image upload)
- Inventory tracking & low-stock alerts
- Order management & status updates
- Store profile with custom slug
- Product analytics (views, sales, revenue)
- Variant support (sizes, colors, etc.)
- SEO fields (meta title, description)

### For Admins
- Real-time dashboard with charts (Recharts)
- User management — view, activate, ban, role assignment
- Seller approval workflow with email notification
- Product oversight — all sellers' products
- Order management across all sellers
- Category management (CRUD)
- Coupon management (create, deactivate, delete)
- Audit log viewer (superadmin only)
- Revenue analytics & growth tracking

---

## 📂 Project Structure

```
mern-ecommerce/
├── backend/
│   ├── config/          # DB, Redis, Passport
│   ├── controllers/     # Business logic
│   ├── middleware/      # All 41 middleware (auth, rbac, rate-limit, validate…)
│   ├── models/          # Mongoose schemas (User, Product, Order, Cart…)
│   ├── routes/          # Express routers
│   ├── utils/           # Logger, JWT helpers, email, seeder
│   ├── uploads/         # Local image storage
│   ├── logs/            # Winston logs
│   ├── server.js        # Entry point
│   ├── .env.example     # Environment template
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── api/         # Axios instance with interceptors
│   │   ├── components/  # Layout, Navbar, Cart sidebar, ProductCard…
│   │   ├── pages/       # All pages (public, user, seller, admin)
│   │   ├── store/       # Redux slices (auth, cart, products, ui)
│   │   ├── types/       # TypeScript interfaces
│   │   └── index.css    # Tailwind + custom design system
│   ├── tailwind.config.js
│   ├── vite.config.ts
│   └── Dockerfile
├── docker-compose.yml
├── nginx.conf
└── README.md
```

---

## ⚡ Quick Start

### Prerequisites
- Node.js 20+
- MongoDB 7+
- Redis 7+
- (Optional) Docker + Docker Compose

### Option A — Manual Setup

**1. Clone and install**
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

---

## 🔑 Default Test Accounts (after seeding)

| Role | Email | Password |
|---|---|---|
| Superadmin | superadmin@CartLy.com | Admin@123456 |
| Admin | admin@CartLy.com | Admin@123456 |
| Seller | seller@CartLy.com | Seller@123456 |
| Seller 2 | seller2@CartLy.com | Seller@123456 |
| User | user@CartLy.com | User@123456 |

---

## 🛣️ API Routes Reference

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
| GET | `/audit-logs` | Superadmin |

---

## 🎨 Design System

The UI follows an **editorial/luxury** aesthetic inspired by high-end fashion and CartLyial publications:

- **Typography**: Manrope (headlines) + Plus Jakarta Sans (body) + JetBrains Mono (code)
- **Color**: Deep navy `#1A237E` primary, neutral surfaces, precise accent system
- **Spacing**: 8px grid system
- **Border Radius**: Sharp (2px–8px), intentionally not rounded
- **Motion**: Framer Motion — staggered reveals, slide-in drawers, scale animations
- **Shadows**: Editorial shadow system (light, directional)

---

## 📦 Environment Variables

See `backend/.env.example` for the full list. Key variables:

```env
MONGODB_URI=mongodb://localhost:27017/CartLy_ecommerce
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-32-char-minimum-secret
STRIPE_SECRET_KEY=sk_test_...
GOOGLE_CLIENT_ID=...
SMTP_USER=...
FRONTEND_URL=http://localhost:5173
```

---

## 🚢 Production Deployment

1. Set `NODE_ENV=production` in `.env`
2. Use strong, unique secrets for all JWT/session keys
3. Configure HTTPS in Nginx (add SSL certificates)
4. Set up MongoDB Atlas or a managed MongoDB cluster
5. Use managed Redis (Redis Cloud / Upstash)
6. Configure Stripe webhooks pointing to `/api/orders/webhook`
7. Set up Cloudinary or S3 for image storage (replace local Multer)
8. Configure a proper SMTP service (SendGrid, Resend, etc.)

---

## 📄 License

MIT — Built with ❤️ for CartLy Platform
