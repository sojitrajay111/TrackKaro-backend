# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Commands

```bash
# Start with hot-reload (default dev entry point)
npm run start:dev      # or: npm run dev — both are `nest start --watch`

# Build then run compiled output
npm run build
npm run start:prod

# Type check via build (there is no separate `tsc --noEmit` script)
npm run build

# Lint (auto-fixes)
npm run lint

# Unit tests
npm test
npm run test:watch
npm run test:cov

# A single unit test file
npx jest src/modules/auth/auth.service.spec.ts

# E2E tests (spins up its own Nest app instance)
npm run test:e2e
```

**Critical constraint:** only 3 `*.spec.ts` files exist today (`auth.service.spec.ts` plus two more) — the module surface is otherwise untested. Don't assume a change is covered; check for a sibling `.spec.ts` before relying on tests to catch a regression.

---

## Architecture Overview

NestJS 10 + Mongoose 8, one feature module per domain under `src/modules/`, wired together in `src/app.module.ts`. Every route requires a valid JWT by default — `JwtAuthGuard` is registered as a global `APP_GUARD`; opt a route out with `@Public()` (see `src/common/decorators/public.decorator.ts`, used by `auth.controller.ts`'s login/register/forgot-password/reset-password/refresh and `health.controller.ts`). `ThrottlerGuard` is also global (`ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])`), with stricter per-route `@Throttle()` overrides on auth and OTP endpoints.

### Bootstrap (`src/main.ts`)

`bootstrapApp()` builds and caches a single Nest app instance (`cachedApp`), then two different entry points reuse it: a local standalone listener (`app.listen(port)`, skipped when `process.env.VERCEL` is set) and a Vercel serverless `handler(req, res)` export. When changing global setup (CORS, `ValidationPipe`, `helmet`, the exception filter), edit `bootstrapApp()` — both entry points pick it up. CORS allows configured origins from `CORS_ORIGINS`, any `localhost`/`127.0.0.1` origin, and any `*.vercel.app` origin. `ValidationPipe` runs with `whitelist: true, forbidNonWhitelisted: true, transform: true` — DTOs are the single source of truth for what a request body may contain.

### Module shape

Each `src/modules/<domain>/` follows the same layout: `<domain>.module.ts`, `<domain>.controller.ts`, `<domain>.service.ts`, `dto/*.dto.ts` (class-validator classes), `schemas/*.schema.ts` (Mongoose `@Schema()` classes). Larger domains (e.g. `groups/`) split service logic further into `services/`. Controllers stay thin — validation and auth are handled by DTOs/guards, and business logic lives in the service.

Modules: `auth`, `users`, `account` (GDPR-style full data wipe), `transactions`, `khata`, `groups`, `budgets`, `reminders`, `subscriptions`, `deals`, `savings`, `assistant` (Gemini AI), `notifications`, `health`. All are imported into `AppModule`; `MailModule` (OTP email) and `DatabaseModule` are global-ish infra modules imported once alongside them.

### Mongoose schema conventions

- `@Schema({ timestamps: true })` on every top-level document; declare the timestamp fields Mongoose injects rather than re-adding them: `declare createdAt: Date;` (see `expense-group.schema.ts`).
- Subdocuments that don't need their own `_id` use `@Schema({ _id: false })` (e.g. `GroupMember`, expense splits).
- Ownership is `@Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true }) userId!: Types.ObjectId;` — every domain document is scoped to its owning user this way; services filter every query by the authenticated user's id (from `@CurrentUser()`, `src/common/decorators/current-user.decorator.ts`) and never trust a client-supplied user id.
- Enums are modeled as a `const` array + derived union type (`export const GROUP_CATEGORIES = [...] as const; export type GroupCategory = (typeof GROUP_CATEGORIES)[number];`) rather than a TS `enum`, then referenced in `@Prop({ enum: ... })`.
- Compare ObjectIds with `Types.ObjectId.equals(...)`, never `===` or string coercion.

### Money handling (`src/common/money/money.util.ts`)

The API boundary and frontend speak rupee floats (`amount: number`); everything persisted in MongoDB is an integer count of paise (`toMinorUnits`/`toMajorUnits`) to avoid float rounding drift — this matters most for group-expense splits, which must sum exactly to the total. Any new money field follows this same minor-units-at-rest, major-units-at-the-API-edge pattern. `formatINR()` mirrors `TrackKaro/src/lib/money.ts#formatINR` and is used when composing notification/email text server-side.

### Groups domain specifics

- Groups are single-owner-writes: one `userId` owns the group document; `members` are name records, not necessarily linked accounts (`GroupMember.linkedUserId` is `null` until matched). `findGroupForUser` resolves a group the caller may access either as owner or via a `members[].linkedUserId` match.
- **Pending confirmations & self-healing link** (`groups.service.ts`): `getPendingConfirmations(userId)` walks every group where the user is the owner or a linked member, and for each non-settlement expense returns splits belonging to the user that haven't been confirmed into a personal transaction yet (`split.confirmedTransactionId` unset). `getMyMemberNames()` resolves which member name(s) in a group belong to the calling user; if the group's owner has an unlinked member literally named "you" (created before any invite flow existed), it self-heals by setting that member's `linkedUserId`/`status` on first read rather than requiring a separate migration. `confirmExpenseSplit()` creates a real `TransactionsService.create(...)` record (category suggested per `GROUP_CATEGORY_SUGGESTION`, keyed off the group's category) and stamps the split with `confirmedTransactionId` so it won't be offered again.
- Debt simplification is a greedy pairwise algorithm; settlements are recorded as a `GroupExpense` with `isSettlement: true` and `settlementFrom`/`settlementTo` — pending-confirmation logic explicitly excludes settlements (`isSettlement: { $ne: true }`).

### Auth

- Access + refresh JWT pair, refresh-token rotation with reuse detection (a reused/replayed refresh token invalidates the whole token family), bcrypt password hashing. `logout-all` revokes every active refresh token for the user; a successful password reset does the same automatically.
- **Email OTP password reset:** `POST /auth/forgot-password` emails a time-limited 6-digit code via `MailService` (nodemailer, Gmail SMTP — requires `EMAIL_USER`/`EMAIL_PASSCODE`, a Gmail [App Password](https://myaccount.google.com/apppasswords), not the account password). `POST /auth/reset-password` verifies the OTP (`schemas/password-reset-otp.schema.ts`, TTL-indexed) and rotates the password + revokes all sessions. If email isn't configured, `MailService` throws a clear `ServiceUnavailableException` rather than the OTP silently failing or the app crashing at boot.

### Config (`src/config/configuration.ts`, `src/config/env.validation.ts`)

`ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate })` — `configuration()` maps every env var into a typed `AppConfig` (with safe defaults for optional ones like `geminiApiKey`/`email`), and `validate()` fails startup fast on missing required vars. Read config via injected `ConfigService<AppConfig>` + `config.get('email', { infer: true })`, never `process.env` directly inside a service.

### Testing

- Jest (`npm test`) for unit specs colocated as `<name>.spec.ts` next to the file under test (e.g. `src/modules/auth/auth.service.spec.ts`).
- `npm run test:e2e` uses `test/jest-e2e.json` and (per the dependency list) `mongodb-memory-server` + Supertest for a real in-memory Mongo instance rather than mocks.
- There's also a standalone in-memory dev server variant (`dev-server-inmemory.ts` style scripts, run via `ts-node -r tsconfig-paths/register`) used for local iteration without a real Atlas connection — don't confuse its state with the real `npm run start:dev` server; they're separate processes and, if both are started, will fight over port 4000 (`EADDRINUSE`).

---

## House Rules

1. **Zero client-side secret exposure:** DB URIs, JWT secrets, Gemini/OpenAI keys, and the Gmail app password live only in this repo's `.env` — never returned in an API response, never duplicated into the frontend.
2. **Every domain document is user-scoped:** filter every query by the authenticated user's id; never trust a client-supplied `userId`/`ownerId` field in a request body (the `ValidationPipe`'s `forbidNonWhitelisted: true` also strips unexpected fields like this by default).
3. **Money is minor-units at rest:** persist paise (integers), not rupee floats; convert at the API boundary with `toMinorUnits`/`toMajorUnits`.
4. **DTOs are the validation boundary:** every mutating endpoint takes a `class-validator` DTO; add `@Min`/`@Max` bounds on money fields (the existing convention is `@Min(0)` / `@Max(100_000_000)`, i.e. ₹10 crore) to block overflow/unrealistic inputs.
5. **Throttle sensitive endpoints:** apply `@Throttle(...)` on auth and OTP routes beyond the global 100 req/min default (existing convention: 10 req/min for auth, 5 req/min for OTP-sending endpoints).
6. **Run `npm run build` before finishing a task** to confirm zero TypeScript errors (there's no separate `tsc --noEmit` script — `nest build` is the type-check).
7. **Don't run `npm run test:e2e` casually** — it's slower (spins up `mongodb-memory-server`) and should be run when you've touched request/response shapes or auth guards, not after every small change; `npm test` (unit) is the fast default when a `.spec.ts` exists for what you touched.
