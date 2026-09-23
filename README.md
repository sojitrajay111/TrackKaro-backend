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
- **🛍️ Deals & Affiliate Engine:** A provider-abstracted, provider-neutral deal-discovery system — `GET /deals/search` tries real marketplace providers (Cuelinks is the aggregator provider) in the default `provider` engine mode, and never fabricates a product, price, or link. Real offers are deduplicated into a canonical `Product`/`MerchantOffer` catalog with an append-only `PriceHistory` (so "is this actually a low price?" is answerable from real data), a freshness/caching layer that avoids re-hitting a provider for an identical search, price-drop alerts (`DealAlert`), and affiliate click-through tracking (`DealClick`, with dynamic Cuelinks affiliate link resolution). The pre-existing Gemini-generated deal finder is preserved as an explicit `legacy` engine mode for side-by-side comparison (`DEALS_ENGINE_MODE=legacy`, or per-request `?engine=legacy`), and never touches the new catalog tables — see `src/modules/deals/providers/` and `src/modules/deals/engine/`.
- **💰 Dynamic Savings Hub:** Computes genuine capital preserved from tracked deals, coupons, cashbacks, and eliminated subscriptions.
- **🤖 Google Gemini 1.5 Flash AI Service:**
  - **Financial Copilot (`POST /assistant/messages`):** Ingests live user financial summaries and answers queries using Gemini 1.5 Flash with prompts tailored for India (INR ₹, UPI, EMIs).
  - **Receipt Vision OCR (`POST /assistant/scan-bill`):** Extracts merchant, amount, category, and date directly from receipt images using Gemini 1.5 Flash Vision.
  - **AI Deal Finder (`GET /deals/search`):** Discovers real-time discounts and promotions across Amazon, Flipkart, Myntra, Swiggy, and Zomato.
  - **Graceful Local Fallback:** Automatically falls back to local rule-based analytics if `GEMINI_API_KEY` is not provided or offline.

---

## 🛠️ Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Runtime & Framework** | Node.js (v18+) · NestJS 10 · TypeScript | Modular, enterprise-grade architecture |
| **Database & ODM** | MongoDB Atlas · Mongoose 8 | Multi-model persistence (transactions, groups, budgets, deals) |
| **Authentication** | Passport · JWT (Access + Refresh) · bcrypt | Secure, stateless authentication with session control |
| **AI & Automation** | Google Gemini 1.5 Flash (`@google/genai`) | Conversational copilot, document OCR, natural language parser |
| **Affiliate & Monetization** | Cuelinks API / Linksredirect | Universal Indian merchant affiliate link resolution |
| **Security & Utilities** | Helmet · Throttler · class-validator | Rate limiting, HTTP header hardening, strict DTO validation |
| **Mailing** | Nodemailer · Gmail SMTP | Secure 6-digit OTP delivery for password reset |

---

## 🚀 Getting Started

### 1. Environment Configuration

Copy the example environment file and populate your credentials:

```bash
cp .env.example .env
```

Key environment variables:

```env
PORT=4000
MONGO_URI=mongodb+srv://<username>:<password>@cluster0.example.mongodb.net/?appName=Cluster0
JWT_ACCESS_SECRET=your-access-secret-32-chars-minimum
JWT_REFRESH_SECRET=your-refresh-secret-32-chars-minimum
CORS_ORIGINS=http://localhost:8081,https://your-domain.com

# Google Gemini AI API Key (Optional — enables Gemini 1.5 Flash features)
GEMINI_API_KEY=AIzaSy...your_gemini_key_here

# Gmail account used to send "forgot password" OTP emails (Optional — enables password reset)
EMAIL_USER=youraccount@gmail.com
EMAIL_PASSCODE=your-16-char-gmail-app-password

# Deals engine mode — "provider" (default) is the production target: real marketplace providers
# only (Cuelinks), no AI-generated deals. "legacy" restores the old
# Gemini deal finder for comparison. Can also be overridden per-request: GET /deals/search?engine=legacy
DEALS_ENGINE_MODE=provider

# Cuelinks Publisher / Affiliate API credentials (Optional — sign up at cuelinks.com)
CUELINKS_API_KEY=
CUELINKS_CHANNEL_ID=
```

> **Note:** If `GEMINI_API_KEY` is not provided, the server will start normally and seamlessly use rule-based fallback responses for the assistant and receipt scanner.
>
> **Note:** `EMAIL_PASSCODE` must be a [Gmail App Password](https://myaccount.google.com/apppasswords) (not your regular Gmail password — Google rejects plain-password SMTP auth). If `EMAIL_USER`/`EMAIL_PASSCODE` are not set, `/auth/forgot-password` will fail with a clear "Email service is not configured" error instead of the app crashing at boot.

---

## 📡 API Reference

A summarized listing of available endpoints. All routes (except `/auth/*` and `/health`) require a valid Bearer JWT:

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/auth/register` | Register new user account |
| `POST` | `/auth/login` | Authenticate user & issue token pair |
| `POST` | `/auth/refresh` | Rotate refresh token & issue new access token |
| `POST` | `/auth/forgot-password` | Request 6-digit password reset OTP via email |
| `POST` | `/auth/reset-password` | Reset password using verified OTP |
| `POST` | `/auth/logout` | Revoke current refresh token |
| `POST` | `/auth/logout-all` | Revoke all active sessions for current user |
| `GET` | `/transactions` | List user transactions with category, date & type filters |
| `POST` | `/transactions` | Create income/expense transaction |
| `GET` | `/transactions/stats/today` | Fetch today's total spend and day-over-day change |
| `GET` | `/transactions/stats/categories` | Fetch category-wise spend breakdown for current month |
| `GET` | `/khata` | List consolidated ledger accounts by contact |
| `POST` | `/khata` | Record credit ("You Gave") or debit ("You Got") ledger entry |
| `GET` | `/khata/stats` | Compute net receivables ("You'll Get") and payables ("You'll Give") |
| `GET` | `/groups` | List expense groups user is a member of |
| `POST` | `/groups` | Create an expense group with category |
| `GET` | `/groups/pending-confirmations` | Walk all user groups and fetch unconfirmed personal expense splits |
| `POST` | `/groups/:id/confirm-split` | Confirm a shared split into a real personal transaction |
| `GET` | `/budgets` | Fetch monthly category budgets with live spend tracking |
| `PUT` | `/budgets` | Upsert budget limit for a category |
| `GET` | `/reminders` | Fetch pending and paid bill reminders |
| `GET` | `/reminders/stats` | Fetch live on-time payment rate percentage |
| `GET` | `/subscriptions` | List recurring subscriptions and redundant services |
| `GET` | `/subscriptions/stats` | Calculate amortized monthly subscription costs and MoM change % |
| `GET` | `/deals` | Retrieve promotional deals and price targets (legacy `Deal` collection) |
| `GET` | `/deals/search?q=:query&engine=` | **Deal discovery:** tries real providers (Cuelinks) by default, returning `{status, engine, deals}`; `engine=legacy` opts into the old Gemini-generated search for comparison |
| `PATCH` | `/deals/offers/:offerId/alert` | Create/update/disable a price-drop alert on a provider-mode merchant offer |
| `POST` | `/deals/offers/:offerId/click` | Record a click-through and resolve where to redirect (dynamic Cuelinks affiliate link, else the plain deal URL) |
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
