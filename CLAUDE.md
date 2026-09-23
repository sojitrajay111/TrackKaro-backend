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

### Deals provider architecture (`src/modules/deals/`)

- **Core rule:** the production deal-search path (`GET /deals/search`, default `DEALS_ENGINE_MODE=provider`) must never fabricate a product, price, discount or link. It only surfaces data a real marketplace provider actually returned; if no provider is configured/implemented, it returns an empty result rather than inventing one.
- **`DealsProvider` interface** (`providers/deals-provider.interface.ts`): `isConfigured()` + `search(context) → { status: 'ok'|'unavailable'|'error', deals: ProviderDealResult[], message? }`. A provider returns raw, already-real deal data — it does **not** persist or score anything.
- **`CuelinksDealsProvider`** (`providers/cuelinks.provider.ts`) is the affiliate aggregator provider: `isConfigured()` checks `CUELINKS_API_KEY`/`CUELINKS_CHANNEL_ID`. It resolves direct merchant URLs into verified Cuelinks tracking redirects (`https://linksredirect.com/?cid=...&subid=...&url=...`).
- **`GeminiLegacyDealsProvider`** (`providers/gemini-legacy.provider.ts`) is the pre-existing AI-generated deal finder (optionally Google Search-grounded), preserved unchanged in behavior for comparison. It is deliberately **not** registered in `DealsProviderRegistry`/`DEALS_PROVIDERS` — `DealsService` invokes it directly, and only when `DealsEngineMode` is `'legacy'` (via `DEALS_ENGINE_MODE=legacy` env or `?engine=legacy` on the request). The production (`'provider'`) path never silently falls back to it.
- **`DealsProviderRegistry`** (`providers/deals-provider.registry.ts`) holds every registered real provider via the `DEALS_PROVIDERS` multi-provider injection token (wired in `deals.module.ts`).
- **`DealsService.discoverDeals()`** is the orchestrator: in `'provider'` mode it tries each registered provider in order and stops at the first with real results; in `'legacy'` mode it runs only the Gemini provider. Either way, whatever a provider returns flows through `rankAndPersistProviderDeals()` — TrackKaro's own interpretation layer (purchase-safety check via `calculatePurchaseCheck`, multi-factor ranking via `calculateMultiFactorRank`, a generic category-stock-photo fallback when no image is supplied) — before being persisted and returned. This layer scores/displays provider data; it never invents it.
- Money: providers return rupee floats on `ProviderDealResult`; `rankAndPersistProviderDeals` converts to paise via `toMinorUnits` before persisting, matching the rest of the codebase's minor-units-at-rest convention.

#### The provider-neutral catalog + engine (`src/modules/deals/engine/`, `schemas/product.schema.ts` et al.)

A second, parallel data model exists alongside the legacy `Deal` collection, used only by the `'provider'` engine (never by `'legacy'`/Gemini — see "Keep Gemini out of the factual pipeline" below):

- **`Product`** (`schemas/product.schema.ts`) — canonical, de-duplicated product identity. **Not `userId`-scoped** — unlike almost everything else in this codebase, this is shared catalog data (like a product listing), not a personal record. The same real product from two different providers resolves to one `Product` via `normalizedKey` (a heuristic brand+title match in `DealIngestionService#buildNormalizedKey` — revisit with a stronger identifier like GTIN/EAN once a provider actually supplies one).
- **`MerchantOffer`** (`schemas/merchant-offer.schema.ts`) — one provider's specific listing for a `Product` (price, coupon, URL, `observedAt`). Also not `userId`-scoped. Upserted idempotently by `providerId`+`providerProductId` when the provider gives us one, else by `providerId`+`dealUrl`.
- **`PriceHistory`** (`schemas/price-history.schema.ts`) — an immutable, append-only log of observed prices per `MerchantOffer`, written on every ingest. This is what makes "is this actually a low price?" answerable from real data instead of a single snapshot.
- **`DealAlert`** (`schemas/deal-alert.schema.ts`, `userId`-scoped) — a user's price-drop alert on a `MerchantOffer`. The provider-neutral replacement for the legacy `Deal.tracked`/`targetPriceMinor` fields; managed via `PATCH /deals/offers/:offerId/alert`, separate from the legacy `PATCH /deals/:id/track`.
- **`DealClick`** (`schemas/deal-click.schema.ts`, `userId`-scoped, append-only) — records a click-through via `POST /deals/offers/:offerId/click`, dynamically resolving affiliate tracking links via Cuelinks when configured.
- **`DealSearchLog`** (`schemas/deal-search-log.schema.ts`) — powers `DealCacheService`'s freshness policy: a `(providerId, normalizedQuery)` search that succeeded within `OFFER_STALE_AFTER_MS` (6h) is served from already-stored `MerchantOffer`s instead of hitting the provider again.

Pipeline (`engine/`):
1. **`DealIngestionService`** — turns a real provider's `ProviderDealResult[]` into `Product`/`MerchantOffer`/`PriceHistory` rows. Only ever called with data from a real `DealsProvider`.
2. **`DealEngineService`** — derived calculations only, never facts: `computeDiscountPercent`, `computeEffectivePriceMinor` (currently a no-op passthrough — no provider supplies a *verified, numeric* coupon/cashback amount yet, so there's nothing safe to subtract without guessing), `priceHistoryComparison` (only ever reports "all-time low" with more than one historical sample), `cheapestCompetingOfferMinor`, `computeScore`.
3. **`DealCacheService`** — the freshness/staleness policy above, plus `isStale()` used to flag (never hide) an old price in the API response.
4. **`MarketplaceDealsService`** — the orchestrator `GET /deals/search` actually calls. `'provider'` mode: cache check → iterate configured real providers → ingest on a hit → derive via `DealEngineService` → respond; `status: 'unavailable'` (never a fabricated result) if nothing configured/returned. `'legacy'` mode: delegates to `DealsService.discoverDeals(..., 'legacy')` unchanged, then wraps its output in the same envelope shape — and deliberately reports the legacy Deal doc's `priceVerified`/`urlVerified` as `false` in that envelope, since AI-generated text was never actually provider-verified regardless of what the old `Deal` schema's default said.

**Response contract** (`engine/types.ts` → `DealSearchResponse`): `{ status: 'success'|'unavailable'|'error', engine: 'provider'|'legacy', message?, deals: PublicMerchantDeal[] }`. This is what `GET /deals/search` returns today — a genuinely different (and intentionally *not* backward-compatible in field names, e.g. `offerId`/`productId` instead of `id`) shape from the legacy `PublicDeal`/`GET /deals` contract, which is untouched and still legacy-`Deal`-collection-backed.

**Affiliate links**: `MarketplaceDealsService.recordClick()` dynamically resolves merchant URLs via `CuelinksDealsProvider.resolveAffiliateUrl(url, userId)`, stamping `isAffiliateResolved: true` when configured, or falling back safely to the direct `dealUrl` with `isAffiliateResolved: false`.

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
8. **Never fabricate marketplace/deal data:** if you're touching `src/modules/deals/`, a provider (`DealsProvider.search()`) returns only what a real source actually said — an empty/`'unavailable'` result beats inventing a product, price, discount or link. Never wire a provider's HTTP call against a guessed API contract; verify the real request/response shape against that marketplace's current docs first. See "Deals provider architecture" above.
