import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { BudgetsModule } from '@/modules/budgets/budgets.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { RemindersModule } from '@/modules/reminders/reminders.module';
import { TransactionsModule } from '@/modules/transactions/transactions.module';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';
import { DealCacheService } from './engine/deal-cache.service';
import { DealEngineService } from './engine/deal-engine.service';
import { DealIngestionService } from './engine/deal-ingestion.service';
import { MarketplaceDealsService } from './engine/marketplace-deals.service';
import { DEALS_PROVIDERS, DealsProviderRegistry } from './providers/deals-provider.registry';
import { FlipkartDealsProvider } from './providers/flipkart.provider';
import { GeminiLegacyDealsProvider } from './providers/gemini-legacy.provider';
import { DealAlert, DealAlertSchema } from './schemas/deal-alert.schema';
import { DealClick, DealClickSchema } from './schemas/deal-click.schema';
import { DealSearchLog, DealSearchLogSchema } from './schemas/deal-search-log.schema';
import { Deal, DealSchema } from './schemas/deal.schema';
import { MerchantOffer, MerchantOfferSchema } from './schemas/merchant-offer.schema';
import { PriceHistory, PriceHistorySchema } from './schemas/price-history.schema';
import { Product, ProductSchema } from './schemas/product.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Deal.name, schema: DealSchema },
      // Provider-neutral catalog + engine collections (see CLAUDE.md "Deals provider architecture").
      { name: Product.name, schema: ProductSchema },
      { name: MerchantOffer.name, schema: MerchantOfferSchema },
      { name: PriceHistory.name, schema: PriceHistorySchema },
      { name: DealAlert.name, schema: DealAlertSchema },
      { name: DealClick.name, schema: DealClickSchema },
      { name: DealSearchLog.name, schema: DealSearchLogSchema },
    ]),
    NotificationsModule,
    TransactionsModule,
    BudgetsModule,
    RemindersModule,
  ],
  controllers: [DealsController],
  providers: [
    DealsService,
    DealsProviderRegistry,
    FlipkartDealsProvider,
    // Legacy Gemini engine — intentionally NOT included in DEALS_PROVIDERS below, since it's a
    // comparison/rollout fallback (see deals.service.ts#discoverDeals), not a "real data"
    // provider that the production path should ever try automatically.
    GeminiLegacyDealsProvider,
    {
      // Real-marketplace providers, in priority order. Add a new provider to the app by
      // implementing DealsProvider, adding it to the `providers` array above, and appending it
      // here — nothing else in the module (or in DealsService/MarketplaceDealsService) needs to change.
      provide: DEALS_PROVIDERS,
      useFactory: (flipkart: FlipkartDealsProvider) => [flipkart],
      inject: [FlipkartDealsProvider],
    },
    // Provider-neutral deal engine (Phases 1-7 of the Deals & Affiliate Engine spec).
    DealIngestionService,
    DealEngineService,
    DealCacheService,
    MarketplaceDealsService,
  ],
  exports: [DealsService, MarketplaceDealsService],
})
export class DealsModule {}
