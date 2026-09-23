# 🛡️ TrackKaro Backend — NestJS, MongoDB & Gemini AI API

The official backend API service for **TrackKaro**, a personal finance, digital bahi khata, and group expense management ecosystem. Built with **NestJS**, **MongoDB (Mongoose)**, **TypeScript**, and **Google Gemini 1.5 Flash AI**.

---

## 🌟 Key Features

- **🔐 Robust JWT Authentication:** Access token + refresh token rotation with bcrypt password hashing, stolen-token-reuse detection, and token invalidation.
- **📧 Email OTP Password Reset:** `/auth/forgot-password` emails a time-limited 6-digit code via Gmail SMTP (nodemailer); `/auth/reset-password` verifies it, updates the password, and revokes every existing session.
- **📊 Real-Time Financial Transactions:** Complete CRUD for income and expenses with category aggregation, Indian Rupee (`₹`) minor-unit integer precision, and monthly filtering.
- **📖 Digital Bahi Khata Ledger:** Customer-centric debt and credit ledgers with settlement tracking and transaction history.
- **👥 Expense Groups & Debt Simplification:** Multi-member expense groups with equal, exact, and percentage splitting, plus a built-in greedy pairwise debt simplification engine to minimize inter-member transactions.
- **✅ Group Expense Confirmations:** `GET /groups/pending-confirmations` aggregates every unconfirmed split across all of a user's groups (owned or joined); `POST /groups/:id/expenses/:expenseId/confirm` turns a confirmed split into a real personal transaction, with a category suggested from the group's category. A self-healing lookup links a group's placeholder "you" member to the real account the first time it's queried, so older groups created before an invite flow existed still resolve correctly.
- **🎯 Category Spending Budgets:** Monthly budget limits per category with automatic 80% and 100% threshold alerting.
- **⏰ Smart Bill & EMI Reminders:** Scheduled reminder tracking with due dates and payment status.
- **📱 Recurring Subscriptions & Redundancy Audit:** Tracks recurring annual and monthly commitments, calculates amortized monthly costs, and flags duplicate services.
- **🛍️ Deals & Affiliate Engine:** A provider-abstracted, provider-neutral deal-discovery system — `GET /deals/search` tries real marketplace providers (Flipkart is the first, currently a credential-gated stub pending API approval) in the default `provider` engine mode, and never fabricates a product, price, or link. Real offers are deduplicated into a canonical `Product`/`MerchantOffer` catalog with an append-only `PriceHistory` (so "is this actually a low price?" is answerable from real data), a freshness/caching layer that avoids re-hitting a provider for an identical search, price-drop alerts (`DealAlert`), and affiliate click-through tracking (`DealClick`, with `isAffiliateResolved: false` until a provider's real affiliate-link resolver exists). The pre-existing Gemini-generated deal finder is preserved as an explicit `legacy` engine mode for side-by-side comparison during the Flipkart rollout (`DEALS_ENGINE_MODE=legacy`, or per-request `?engine=legacy`), and never touches the new catalog tables — see `src/modules/deals/providers/` and `src/modules/deals/engine/`.
- **💰 Dynamic Savings Hub:** Computes genuine capital preserved from tracked deals, coupons, cashbacks, and eliminated subscriptions.
- **🤖 Google Gemini 1.5 Flash AI Service:**
  - **Financial Copilot (`POST /assistant/messages`):** Ingests live user financial summaries and answers queries using Gemini 1.5 Flash with prompts tailored for India (INR ₹, UPI, EMIs).
  - **Receipt Vision OCR (`POST /assistant/scan-bill`):** Extracts merchant, amount, category, and date directly from receipt images using Gemini 1.5 Flash Vision.
  - **AI Deal Finder (`GET /deals/search`):** Discovers real-time discounts and promotions across Amazon, Flipkart, Myntra, Swiggy, and Zomato.
  - **Graceful Local Fallback:** Automatically falls back to local rule-based analytics if `GEMINI_API_KEY` is not provided or offline.

---

## 🛠️ Technology Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Framework** | NestJS 10 | Scalable, modular enterprise backend framework |
| **Language** | TypeScript (Strict Mode) | End-to-end type safety |
| **Database** | MongoDB Atlas via Mongoose 8 | Document storage with schemas and indexing |
| **Authentication** | Passport.js + `@nestjs/jwt` + bcrypt | Stateless JWT access & refresh authentication |
| **AI Integration** | Google Gemini 1.5 Flash (REST API) | Conversational financial copilot, receipt OCR & deal search |
| **Validation** | `class-validator` + `class-transformer` | Strict runtime DTO and environment validation |
| **Security** | Helmet + `@nestjs/throttler` | HTTP header security and rate limiting |
| **Testing** | Jest + `mongodb-memory-server` + Supertest | Unit and E2E integration testing |

---

## 📁 Module Architecture

```
TrackKaro-backend/
├── src/
│   ├── common/                  # Shared decorators, guards, filters, money utilities
│   ├── config/                  # Configuration factory and env validation
│   ├── database/                # MongoDB connection module
│   ├── modules/
│   │   ├── auth/                # Login, registration, token refresh
│   │   ├── users/               # User profile management
│   │   ├── account/             # Full account data wipe (GDPR-style erasure)
│   │   ├── transactions/        # Expenses, income, category metrics
│   │   ├── khata/               # Digital Bahi Khata ledgers & customers
│   │   ├── groups/              # Shared expense groups & debt simplification
│   │   ├── budgets/             # Category budget limits & threshold alerts
│   │   ├── reminders/           # Bill & EMI due date tracking
│   │   ├── subscriptions/       # Recurring costs & redundancy flags
│   │   ├── deals/               # Shopping offers, price tracking & AI deals search
│   │   ├── savings/             # Real-time savings analytics
│   │   ├── assistant/           # Gemini AI financial copilot & receipt OCR
│   │   ├── notifications/       # In-app notification dispatcher
│   │   └── health/              # Server health checks
│   ├── app.module.ts            # Root application module
│   └── main.ts                  # Application bootstrap entry point
├── .env.example                 # Environment variable template
├── package.json
└── tsconfig.json
```

---

## ⚙️ Environment Configuration

Create a `.env` file in the root of `TrackKaro-backend/` based on `.env.example`:

```env
PORT=4000
MONGO_URI=mongodb+srv://<username>:<password>@cluster0.example.mongodb.net/trackkaro?retryWrites=true&w=majority

JWT_ACCESS_SECRET=your-secure-access-secret-key-min-32-chars
JWT_ACCESS_TTL=15m

JWT_REFRESH_SECRET=your-secure-refresh-secret-key-min-32-chars
JWT_REFRESH_TTL=30d

CORS_ORIGINS=http://localhost:8081,http://localhost:8082,http://localhost:19006,https://*.vercel.app

# Google Gemini AI API Key (Optional — enables Gemini 1.5 Flash features)
GEMINI_API_KEY=AIzaSy...your_gemini_key_here

# Gmail account used to send "forgot password" OTP emails (Optional — enables password reset)
EMAIL_USER=youraccount@gmail.com
EMAIL_PASSCODE=your-16-char-gmail-app-password

# Deals engine mode — "provider" (default) is the production target: real marketplace providers
# only (Flipkart, once credentialed below), no AI-generated deals. "legacy" restores the old
# Gemini deal finder for comparison. Can also be overridden per-request: GET /deals/search?engine=legacy
DEALS_ENGINE_MODE=provider

# Flipkart Affiliate API credentials (Optional — the provider stays a stub, making no network
# calls, until both are set AND the real API call is implemented in
# src/modules/deals/providers/flipkart.provider.ts)
FLIPKART_AFFILIATE_ID=
FLIPKART_AFFILIATE_TOKEN=
```

> **Note:** If `GEMINI_API_KEY` is not provided, the server will start normally and seamlessly use rule-based fallback responses for the assistant and receipt scanner.
>
> **Note:** `EMAIL_PASSCODE` must be a [Gmail App Password](https://myaccount.google.com/apppasswords) (not your regular Gmail password — Google rejects plain-password SMTP auth). If `EMAIL_USER`/`EMAIL_PASSCODE` are not set, `/auth/forgot-password` will fail with a clear "Email service is not configured" error instead of the app crashing at boot.

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Start in Development Mode
```bash
npm run start:dev
```
The server will start on `http://localhost:4000` with hot-reload enabled.

### 3. Build for Production
```bash
npm run build
npm run start:prod
```

### 4. Run Tests
```bash
# Unit tests
npm test

# E2E integration tests
npm run test:e2e
```

---

## 📡 Key API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/auth/register` | Register new user account |
| `POST` | `/auth/login` | Log in and receive access + refresh tokens |
| `POST` | `/auth/refresh` | Rotate access token using valid refresh token |
| `POST` | `/auth/logout` | Revoke a single refresh token |
| `POST` | `/auth/logout-all` | Revoke all active refresh tokens for the authenticated user |
| `POST` | `/auth/forgot-password` | Email a 6-digit OTP via Gmail SMTP to reset a forgotten password |
| `POST` | `/auth/reset-password` | Verify OTP and set a new password (revokes all active sessions) |
| `GET` | `/users/me` | Fetch currently authenticated user profile |
| `PATCH` | `/users/me` | Update user profile (`name`, `phone`) |
| `DELETE` | `/account/data` | Permanently wipe all data owned by the authenticated user (GDPR erasure) |
| `GET` | `/transactions` | List all user transactions (filtered by category, date) |
| `POST` | `/transactions` | Create a new transaction (with `@Max(100_000_000)` amount validation) |
| `GET` | `/khata` | Fetch customer ledgers and balances |
| `POST` | `/khata` | Record a debit or credit khata entry |
| `GET` | `/groups` | List user's shared expense groups |
| `GET` | `/groups/pending-confirmations` | List every unconfirmed group-expense split across all of the user's groups |
| `POST` | `/groups/:id/expenses` | Add group expense and recalculate debt simplification |
| `POST` | `/groups/:id/expenses/:expenseId/confirm` | Confirm a pending split, creating a personal transaction in the chosen category |
| `GET` | `/budgets` | Get monthly category budgets and progress |
| `PUT` | `/budgets/:category` | Upsert monthly budget limit for a category |
| `GET` | `/reminders` | Fetch pending and paid bill reminders |
| `GET` | `/reminders/stats` | Fetch live on-time payment rate percentage |
| `GET` | `/subscriptions` | List recurring subscriptions and redundant services |
| `GET` | `/subscriptions/stats` | Calculate amortized monthly subscription costs and MoM change % |
| `GET` | `/deals` | Retrieve promotional deals and price targets (legacy `Deal` collection) |
| `GET` | `/deals/search?q=:query&engine=` | **Deal discovery:** tries real providers (Flipkart) by default, returning `{status, engine, deals}`; `engine=legacy` opts into the old Gemini-generated search for comparison |
| `PATCH` | `/deals/offers/:offerId/alert` | Create/update/disable a price-drop alert on a provider-mode merchant offer |
| `POST` | `/deals/offers/:offerId/click` | Record a click-through and resolve where to redirect (affiliate link once implemented, else the plain deal URL) |
| `GET` | `/savings` | Retrieve real aggregate savings metrics |
| `GET` | `/savings/metrics` | Retrieve 5-month historical trend, MoM growth %, and computed saver tier |
| `POST` | `/assistant/messages` | **Gemini AI Copilot:** Ask financial advice |
| `POST` | `/assistant/scan-bill` | **Gemini Vision OCR:** Extract structured data from receipt image |
| `GET` | `/health` | Service health status check |

---

## 🔒 Security & Quality Practices

- **Zero Client-Side Secret Exposure:** All database URIs, JWT signing secrets, and Gemini API keys are kept strictly on the backend.
- **Input Sanitization & DTO Validation:** All payloads are validated at the controller boundary using `class-validator` with whitelist stripping enabled.
- **Financial Bounds Validation:** All transaction, budget, reminder, subscription, and group split amounts are bounded with `@Min(0)` and `@Max(100_000_000)` (100 million rupees / 10 crore) to prevent integer overflow and unrealistic inputs.
- **Budget Threshold Deduplication:** Category budget threshold notifications are evaluated against current calendar month transactions only (`date: { $regex: ^YYYY-MM }`), with persistent `lastAlertedMonth` and `lastAlertedLevel` state on the budget document to prevent duplicate alert spam on subsequent transactions.
- **Session Revocation:** Authenticated users can revoke all active refresh tokens with `POST /auth/logout-all`, and password resets automatically terminate all existing sessions.
- **Throttling & Rate Limiting:** Protected with `@nestjs/throttler` (default 100 req/min, with strict 10 req/min for auth and 5 req/min for OTP endpoints) against brute-force attacks.
- **Security Headers:** Enforced via `helmet` across all API responses.

---

## 📄 License

TrackKaro API. All Rights Reserved.
