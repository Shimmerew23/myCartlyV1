# CartLy — Software Requirements Specification (SRS)

A full-stack MERN eCommerce platform. This document specifies the functional,
non-functional, security, and technical requirements of the system.

- **Status legend:** ✅ Implemented · 🔭 Planned / Future
- **Audience:** developers, reviewers, stakeholders
- **Source of truth:** code in `backend/` and `frontend/`; see [README.md](README.md) and [CLAUDE.md](CLAUDE.md)
- **Last reviewed:** 2026-06-01

---

## Table of Contents

1. [Functional Requirements (by Role)](#1-functional-requirements-by-role)
2. [Non-Functional Requirements](#2-non-functional-requirements)
3. [Security Requirements](#3-security-requirements)
4. [Technical Requirements (Stack & Infrastructure)](#4-technical-requirements-stack--infrastructure)
5. [Gaps & Future Requirements](#5-gaps--future-requirements)

---

## 1. Functional Requirements (by Role)

### 1.1 Buyer / Customer

| ID | Requirement | Status |
|---|---|---|
| FR-B-01 | Register an account (email + password) | ✅ |
| FR-B-02 | Log in and log out | ✅ |
| FR-B-03 | Verify email via emailed link | ✅ |
| FR-B-04 | Reset password via time-limited cryptographic token | ✅ |
| FR-B-05 | Change password while authenticated | ✅ |
| FR-B-06 | Sign in with Google OAuth 2.0 | ✅ |
| FR-B-07 | Browse products with advanced filtering (price, rating, category, tags, stock) | ✅ |
| FR-B-08 | Full-text search with fuzzy matching and autocomplete | ✅ |
| FR-B-09 | View product detail: image gallery, variants, ratings | ✅ |
| FR-B-10 | Manage a persistent shopping cart synced to the backend | ✅ |
| FR-B-11 | Manage a wishlist | ✅ |
| FR-B-12 | Apply coupon / discount codes | ✅ |
| FR-B-13 | Check out and pay via Stripe (PaymentIntents) | ✅ |
| FR-B-14 | Place orders and view order history | ✅ |
| FR-B-15 | Track order status and view status history | ✅ |
| FR-B-16 | Request a return on an order | ✅ |
| FR-B-17 | Create, edit, and delete own product reviews and ratings | ✅ |
| FR-B-18 | Manage an address book (multiple shipping addresses, CRUD) | ✅ |
| FR-B-19 | Manage profile and preferences | ✅ |
| FR-B-20 | Receive email notifications (order confirmation, shipping) | ✅ |
| FR-B-21 | Request upgrade to Seller ("Become Seller" flow) | ✅ |
| FR-B-22 | Submit feedback | ✅ |

### 1.2 Seller

| ID | Requirement | Status |
|---|---|---|
| FR-S-01 | Upgrade from buyer via admin-approval workflow | ✅ |
| FR-S-02 | View seller dashboard with revenue charts and top products | ✅ |
| FR-S-03 | Add, edit, and delete products with image upload | ✅ |
| FR-S-04 | Manage product variants (sizes, colors, etc.) | ✅ |
| FR-S-05 | Track inventory and receive low-stock alerts | ✅ |
| FR-S-06 | Manage own orders and update their status | ✅ |
| FR-S-07 | View product analytics (views, sales, revenue) | ✅ |
| FR-S-08 | Set SEO fields (meta title, description) per product | ✅ |
| FR-S-09 | Manage store profile with a custom slug | ✅ |

### 1.3 Admin

| ID | Requirement | Status |
|---|---|---|
| FR-A-01 | View real-time dashboard with revenue and growth charts | ✅ |
| FR-A-02 | Manage users — view, activate, ban, assign roles | ✅ |
| FR-A-03 | Approve sellers (with email notification) | ✅ |
| FR-A-04 | Oversee products across all sellers | ✅ |
| FR-A-05 | Manage orders across all sellers | ✅ |
| FR-A-06 | Manage categories (CRUD) | ✅ |
| FR-A-07 | Manage coupons (create, deactivate, delete) | ✅ |
| FR-A-08 | Manage carriers / shipping (CRUD) | ✅ |
| FR-A-09 | Manage warehouse accounts (create, edit, activate/deactivate, delete) | ✅ |
| FR-A-10 | Manage user feedback | ✅ |
| FR-A-11 | View revenue analytics and growth tracking | ✅ |

### 1.4 Superadmin

| ID | Requirement | Status |
|---|---|---|
| FR-SA-01 | Perform all admin capabilities | ✅ |
| FR-SA-02 | View the audit log of every admin action (90-day TTL) | ✅ |

### 1.5 Warehouse Staff

| ID | Requirement | Status |
|---|---|---|
| FR-W-01 | Access a dedicated, role-gated warehouse portal (auto-redirect on login) | ✅ |
| FR-W-02 | Scan/look up parcels by order number (`CUR-xxx`) or MongoDB ID | ✅ |
| FR-W-03 | Check in orders: Processing, Shipped, Out for Delivery, Delivered, Location Update | ✅ |
| FR-W-04 | Capture a tracking number when marking an order as Shipped | ✅ |
| FR-W-05 | Attach location and note fields to each check-in event | ✅ |
| FR-W-06 | View full status-history timeline showing which warehouse handled each update | ✅ |

---

## 2. Non-Functional Requirements

### 2.1 Performance

| ID | Requirement | Status |
|---|---|---|
| NFR-P-01 | Cache responses in Redis with automatic invalidation (`apicache`) | ✅ |
| NFR-P-02 | Compress responses with gzip (threshold 1KB) | ✅ |
| NFR-P-03 | Support conditional requests via ETag | ✅ |
| NFR-P-04 | Detect and log slow requests (>1000ms) | ✅ |
| NFR-P-05 | Optimize images via Sharp (resize + WebP) before upload | ✅ |

### 2.2 Scalability

| ID | Requirement | Status |
|---|---|---|
| NFR-SC-01 | Use stateless JWT auth to allow horizontal scaling | ✅ |
| NFR-SC-02 | Back sessions/refresh tokens/blacklist with Redis | ✅ |
| NFR-SC-03 | Be cluster-ready | ✅ |
| NFR-SC-04 | Orchestrate services via Docker Compose | ✅ |
| NFR-SC-05 | Front the stack with an Nginx reverse proxy | ✅ |

### 2.3 Availability & Reliability

| ID | Requirement | Status |
|---|---|---|
| NFR-R-01 | Shut down gracefully | ✅ |
| NFR-R-02 | Degrade gracefully on Redis failure (non-fatal) | ✅ |
| NFR-R-03 | Serve images via CDN (Cloudinary) for persistence across deploys | ✅ |
| NFR-R-04 | Return a standardized response envelope for all endpoints | ✅ |
| NFR-R-05 | Centralize error handling (`ApiError` / `errorHandler`) | ✅ |

### 2.4 Observability & Maintainability

| ID | Requirement | Status |
|---|---|---|
| NFR-O-01 | Structured logging via Winston + Morgan | ✅ |
| NFR-O-02 | Trace requests with request IDs across the lifecycle | ✅ |
| NFR-O-03 | Audit logs for admin actions | ✅ |
| NFR-O-04 | Separate combined / error / exception / rejection log files | ✅ |
| NFR-M-01 | Consolidated barrel-module architecture | ✅ |
| NFR-M-02 | Centralized TypeScript types (`src/types/index.ts`) | ✅ |
| NFR-M-03 | ESLint gate enforced (`--max-warnings 0`) | ✅ |

### 2.5 Usability & Portability

| ID | Requirement | Status |
|---|---|---|
| NFR-U-01 | Editorial/luxury design system (Manrope + Plus Jakarta Sans, navy primary, 8px grid) | ✅ |
| NFR-U-02 | Responsive single-page application | ✅ |
| NFR-U-03 | Toast notifications and Framer Motion transitions | ✅ |
| NFR-PT-01 | Fully containerized with environment-driven config (`.env`) | ✅ |

---

## 3. Security Requirements

| ID | Requirement | Status |
|---|---|---|
| SEC-01 | JWT access (15 min) + refresh (7 d) tokens with rotation | ✅ |
| SEC-02 | Token blacklisting via Redis on logout | ✅ |
| SEC-03 | Role-Based Access Control (`user` / `seller` / `admin` / `superadmin` / `warehouse`) | ✅ |
| SEC-04 | Brute-force protection — account lockout after 5 failed attempts | ✅ |
| SEC-05 | Helmet — 15 secure HTTP headers | ✅ |
| SEC-06 | CORS whitelist-based origin control | ✅ |
| SEC-07 | Rate limiting — global (100/15min), auth (10/5min), uploads (30/hr), Redis-backed | ✅ |
| SEC-08 | NoSQL injection prevention (`express-mongo-sanitize`) | ✅ |
| SEC-09 | XSS input sanitization | ✅ |
| SEC-10 | HTTP Parameter Pollution (HPP) prevention | ✅ |
| SEC-11 | CSRF protection — SameSite cookies + token validation | ✅ |
| SEC-12 | Server-side validation (Joi + Celebrate) | ✅ |
| SEC-13 | Client-side validation (Zod) | ✅ |
| SEC-14 | Schema-level validation (Mongoose pre-validation) | ✅ |
| SEC-15 | UUID-namespaced Cloudinary public IDs to prevent cross-user collisions | ✅ |
| SEC-16 | Stripe webhook signature verification (raw-body handling) | ✅ |

---

## 4. Technical Requirements (Stack & Infrastructure)

### 4.1 Backend

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| Framework | Express.js 4.x |
| Database | MongoDB 7 + Mongoose 8 |
| Cache / Sessions | Redis 7.4 |
| Auth | JWT (access + refresh) + Passport.js |
| OAuth | Google OAuth 2.0 |
| Payments | Stripe (PaymentIntents + Webhooks) |
| File Storage | Multer + Sharp + Cloudinary |
| Email | Nodemailer (SMTP) |
| Validation | Joi + Celebrate + express-validator |
| Logging | Winston + Morgan |
| Caching | apicache + Redis |

### 4.2 Frontend

| Layer | Technology |
|---|---|
| Framework | React 18 + TypeScript 5 |
| Build Tool | Vite 5 |
| Client State | Redux Toolkit (`auth`, `cart`, `products`, `ui` slices) |
| Server State | React Query (TanStack v5) |
| Routing | React Router v6 |
| Styling | Tailwind CSS 3 |
| Forms | React Hook Form + Zod |
| Animation | Framer Motion |
| Charts | Recharts |
| HTTP | Axios (interceptors, token refresh, per-route 401 handling) |
| Payments | Stripe.js + @stripe/react-stripe-js |

### 4.3 Infrastructure

| Layer | Technology |
|---|---|
| Containerization | Docker + Docker Compose |
| Reverse Proxy | Nginx (rate-limiting, compression, static files, SPA + API proxy) |
| Search Indexing | MongoDB text indexes |
| Process | Graceful shutdown, cluster-ready |

---

## 5. Gaps & Future Requirements

Items below are **not yet implemented**. Notably, there is currently **no automated test suite** configured (see [CLAUDE.md](CLAUDE.md)).

### 5.1 Testing & Quality

| ID | Requirement | Status |
|---|---|---|
| FUT-T-01 | Unit tests (Jest) for controllers/utils | 🔭 |
| FUT-T-02 | Integration tests (Supertest) for API routes | 🔭 |
| FUT-T-03 | End-to-end tests (Playwright / Cypress) | 🔭 |
| FUT-T-04 | Test coverage gate in CI | 🔭 |

### 5.2 CI/CD

| ID | Requirement | Status |
|---|---|---|
| FUT-C-01 | GitHub Actions pipeline (lint, build, test) | 🔭 |
| FUT-C-02 | Automated deployment | 🔭 |
| FUT-C-03 | Staging environment | 🔭 |

### 5.3 Payments

| ID | Requirement | Status |
|---|---|---|
| FUT-PAY-01 | Additional providers (PayPal, GCash) | 🔭 |
| FUT-PAY-02 | Automated refunds | 🔭 |
| FUT-PAY-03 | Saved cards / stored payment methods | 🔭 |
| FUT-PAY-04 | Multi-currency support | 🔭 |

### 5.4 Notifications

| ID | Requirement | Status |
|---|---|---|
| FUT-N-01 | Real-time order updates (WebSocket / SSE) | 🔭 |
| FUT-N-02 | Web push notifications | 🔭 |
| FUT-N-03 | SMS notifications | 🔭 |

### 5.5 Search & Discovery

| ID | Requirement | Status |
|---|---|---|
| FUT-SE-01 | Dedicated search engine (Elasticsearch / Algolia) | 🔭 |
| FUT-SE-02 | Product recommendations | 🔭 |
| FUT-SE-03 | Abandoned-cart recovery | 🔭 |
| FUT-SE-04 | Cohort / funnel analytics | 🔭 |

### 5.6 Internationalization

| ID | Requirement | Status |
|---|---|---|
| FUT-I18N-01 | Multi-language (i18n) | 🔭 |
| FUT-I18N-02 | Multi-currency display | 🔭 |
| FUT-I18N-03 | Localized tax / VAT handling | 🔭 |

### 5.7 Shipping & Fulfillment

| ID | Requirement | Status |
|---|---|---|
| FUT-SH-01 | Live carrier rate calculation | 🔭 |
| FUT-SH-02 | Real carrier tracking API integration | 🔭 |

### 5.8 Compliance & Accessibility

| ID | Requirement | Status |
|---|---|---|
| FUT-CMP-01 | GDPR data export / delete | 🔭 |
| FUT-CMP-02 | Cookie consent | 🔭 |
| FUT-CMP-03 | PCI-DSS posture documentation | 🔭 |
| FUT-CMP-04 | WCAG accessibility conformance | 🔭 |

### 5.9 Reliability & Operations

| ID | Requirement | Status |
|---|---|---|
| FUT-OPS-01 | APM / error monitoring (Sentry) | 🔭 |
| FUT-OPS-02 | Metrics & dashboards (Prometheus / Grafana) | 🔭 |
| FUT-OPS-03 | Health-check endpoints | 🔭 |
| FUT-OPS-04 | Automated database backups & DR plan | 🔭 |

### 5.10 Content & Platform

| ID | Requirement | Status |
|---|---|---|
| FUT-PLT-01 | CMS for banners / static pages | 🔭 |
| FUT-PLT-02 | Blog | 🔭 |
| FUT-PLT-03 | Multi-vendor commission / payout system | 🔭 |
| FUT-PLT-04 | PWA support or React Native mobile app | 🔭 |
