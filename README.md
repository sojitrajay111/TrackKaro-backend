# 🛡️ TrackKaro Backend — NestJS, MongoDB & Gemini AI API

The official backend API service for **TrackKaro**, a personal finance, digital bahi khata, and group expense management ecosystem. Built with **NestJS**, **MongoDB (Mongoose)**, **TypeScript**, and **Google Gemini 1.5 Flash AI**.

---

## 🌟 Key Features

- **🔐 Robust JWT Authentication:** Access token + refresh token rotation with bcrypt password hashing and token invalidation.
- **📊 Real-Time Financial Transactions:** Complete CRUD for income and expenses with category aggregation, Indian Rupee (`₹`) minor-unit integer precision, and monthly filtering.
- **📖 Digital Bahi Khata Ledger:** Customer-centric debt and credit ledgers with settlement tracking and transaction history.
- **👥 Expense Groups & Debt Simplification:** Multi-member expense groups with equal, exact, and percentage splitting, plus a built-in greedy pairwise debt simplification engine to minimize inter-member transactions.
- **🎯 Category Spending Budgets:** Monthly budget limits per category with automatic 80% and 100% threshold alerting.
- **⏰ Smart Bill & EMI Reminders:** Scheduled reminder tracking with due dates and payment status.
- **📱 Recurring Subscriptions & Redundancy Audit:** Tracks recurring annual and monthly commitments, calculates amortized monthly costs, and flags duplicate services.
- **🛍️ Deals & Price Drop Tracking:** Manages promotional offers with custom price target alerts and live AI deal discovery.
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
```

> **Note:** If `GEMINI_API_KEY` is not provided, the server will start normally and seamlessly use rule-based fallback responses for the assistant and receipt scanner.

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
| `DELETE` | `/account/data` | Permanently wipe all data owned by the authenticated user |
| `GET` | `/transactions` | List all user transactions (filtered by category, date) |
| `POST` | `/transactions` | Create a new transaction |
| `GET` | `/khata` | Fetch customer ledgers and balances |
| `POST` | `/khata` | Record a debit or credit khata entry |
| `GET` | `/groups` | List user's shared expense groups |
| `POST` | `/groups/:id/expenses` | Add group expense and recalculate debt simplification |
| `GET` | `/budgets` | Get monthly category budgets and progress |
| `GET` | `/reminders` | Fetch pending and paid bill reminders |
| `GET` | `/subscriptions` | List recurring subscriptions and redundant services |
| `GET` | `/deals` | Retrieve promotional deals and price targets |
| `GET` | `/deals/search?q=:query` | **AI Deal Search:** Find real live deals using Gemini |
| `GET` | `/savings` | Retrieve real aggregate savings metrics |
| `POST` | `/assistant/messages` | **Gemini AI Copilot:** Ask financial advice |
| `POST` | `/assistant/scan-bill` | **Gemini Vision OCR:** Extract structured data from receipt image |
| `GET` | `/health` | Service health status check |

---

## 🔒 Security Practices

- **Zero Client-Side Secret Exposure:** All database URIs, JWT signing secrets, and Gemini API keys are kept strictly on the backend.
- **Input Sanitization & DTO Validation:** All payloads are validated at the controller boundary using `class-validator` with whitelist stripping enabled.
- **Throttling & Rate Limiting:** Protected with `@nestjs/throttler` against brute-force attacks.
- **Security Headers:** Enforced via `helmet` across all API responses.

---

## 📄 License

TrackKaro API. All Rights Reserved.
