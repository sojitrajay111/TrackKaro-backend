import { NotFoundException } from '@nestjs/common';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';

import { DealsService } from '../deals.service';
import { DealsProvider, ProviderDealResult } from '../providers/deals-provider.interface';
import { DEALS_PROVIDERS, DealsProviderRegistry } from '../providers/deals-provider.registry';
import { DealAlert, DealAlertDocument, DealAlertSchema } from '../schemas/deal-alert.schema';
import { DealClick, DealClickDocument, DealClickSchema } from '../schemas/deal-click.schema';
import { DealSearchLog, DealSearchLogSchema } from '../schemas/deal-search-log.schema';
import {
  MerchantOffer,
  MerchantOfferDocument,
  MerchantOfferSchema,
} from '../schemas/merchant-offer.schema';
import { PriceHistory, PriceHistorySchema } from '../schemas/price-history.schema';
import { Product, ProductSchema } from '../schemas/product.schema';
import { DealCacheService } from './deal-cache.service';
import { DealEngineService } from './deal-engine.service';
import { DealIngestionService } from './deal-ingestion.service';
import { MarketplaceDealsService } from './marketplace-deals.service';

const USER_ID = '000000000000000000000001';

function fakeDeal(overrides: Partial<ProviderDealResult> = {}): ProviderDealResult {
  return {
    title: 'Test Product',
    platform: 'FakeMart',
    category: 'Electronics',
    originalPrice: 1000,
    currentPrice: 700,
    discountPercent: 30,
    deliveryCharge: 0,
    finalPrice: 700,
    savingsAmount: 300,
    dealUrl: 'https://fakemart.example/product',
    priceVerified: true,
    urlVerified: true,
    ...overrides,
  };
}

describe('MarketplaceDealsService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let service: MarketplaceDealsService;
  let searchMock: jest.Mock;
  let discoverDealsMock: jest.Mock;
  let offerModel: Model<MerchantOfferDocument>;
  let dealAlertModel: Model<DealAlertDocument>;
  let dealClickModel: Model<DealClickDocument>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();

    searchMock = jest.fn();
    const fakeProvider: DealsProvider = {
      id: 'fake-marketplace',
      displayName: 'Fake Marketplace (test double)',
      isConfigured: () => true,
      search: searchMock,
    };

    discoverDealsMock = jest.fn().mockResolvedValue([]);
    const dealsServiceStub = {
      engineMode: () => 'provider',
      discoverDeals: discoverDealsMock,
    } as unknown as DealsService;

    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([
          { name: Product.name, schema: ProductSchema },
          { name: MerchantOffer.name, schema: MerchantOfferSchema },
          { name: PriceHistory.name, schema: PriceHistorySchema },
          { name: DealAlert.name, schema: DealAlertSchema },
          { name: DealClick.name, schema: DealClickSchema },
          { name: DealSearchLog.name, schema: DealSearchLogSchema },
        ]),
      ],
      providers: [
        MarketplaceDealsService,
        DealIngestionService,
        DealEngineService,
        DealCacheService,
        DealsProviderRegistry,
        { provide: DEALS_PROVIDERS, useValue: [fakeProvider] },
        { provide: DealsService, useValue: dealsServiceStub },
      ],
    }).compile();

    service = moduleRef.get(MarketplaceDealsService);
    offerModel = moduleRef.get(getModelToken(MerchantOffer.name));
    dealAlertModel = moduleRef.get(getModelToken(DealAlert.name));
    dealClickModel = moduleRef.get(getModelToken(DealClick.name));
  }, 60_000);

  afterEach(() => {
    searchMock.mockReset();
    discoverDealsMock.mockClear();
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  it('provider mode: ingests and returns real deals from a configured provider', async () => {
    searchMock.mockResolvedValue({
      status: 'ok',
      deals: [fakeDeal({ dealUrl: 'https://fakemart.example/p1' })],
    });

    const response = await service.searchDeals(USER_ID, 'p1-query');

    expect(response.status).toBe('success');
    expect(response.engine).toBe('provider');
    expect(response.deals).toHaveLength(1);
    expect(response.deals[0].sourceType).toBe('fake-marketplace');
    expect(response.deals[0].discountPercent).toBe(30);
    expect(response.deals[0].priceVerified).toBe(true);
    expect(response.deals[0].stale).toBe(false);
    expect(response.deals[0].isAllTimeLow).toBe(false); // only one observation so far
  });

  it('provider mode: reuses cached offers instead of calling the provider again for an identical search', async () => {
    searchMock.mockResolvedValue({
      status: 'ok',
      deals: [fakeDeal({ dealUrl: 'https://fakemart.example/p2' })],
    });

    await service.searchDeals(USER_ID, 'p2-query');
    expect(searchMock).toHaveBeenCalledTimes(1);

    await service.searchDeals(USER_ID, 'p2-query');
    expect(searchMock).toHaveBeenCalledTimes(1); // second call served from cache, not a new provider hit
  });

  it('provider mode: never fabricates a deal — returns unavailable when the provider has none', async () => {
    searchMock.mockResolvedValue({ status: 'unavailable', deals: [], message: 'no credentials' });

    const response = await service.searchDeals(USER_ID, 'p3-nothing-here');

    expect(response.status).toBe('unavailable');
    expect(response.engine).toBe('provider');
    expect(response.deals).toEqual([]);
  });

  it('provider mode: surfaces a provider exception as an "error" status, not a crash', async () => {
    searchMock.mockRejectedValue(new Error('network exploded'));

    const response = await service.searchDeals(USER_ID, 'p4-throws');

    expect(response.status).toBe('unavailable'); // no provider left to try -> overall unavailable
    expect(response.deals).toEqual([]);
  });

  it('legacy mode: delegates to DealsService.discoverDeals and wraps the result in the new envelope', async () => {
    discoverDealsMock.mockResolvedValue([
      {
        id: 'legacy-1',
        title: 'Legacy Deal',
        platform: 'Myntra',
        category: 'Fashion',
        originalPrice: 2000,
        currentPrice: 1200,
        discountPercent: 40,
        deliveryCharge: 0,
        finalPrice: 1200,
        savingsAmount: 800,
        expiryDate: '2026-12-31',
        bestReason: 'AI-generated',
        dealUrl: 'https://myntra.example/x',
        sourceType: 'gemini-legacy',
        tracked: false,
      },
    ]);

    const response = await service.searchDeals(USER_ID, 'legacy-query', 'legacy');

    expect(discoverDealsMock).toHaveBeenCalledWith(USER_ID, 'legacy-query', 'legacy');
    expect(response.engine).toBe('legacy');
    expect(response.status).toBe('success');
    expect(response.deals[0].title).toBe('Legacy Deal');
    // The envelope never claims AI-generated legacy output as provider-verified.
    expect(response.deals[0].priceVerified).toBe(false);
    expect(response.deals[0].urlVerified).toBe(false);
  });

  it('legacy mode: reports "unavailable" (not fabricated success) when Gemini returns nothing', async () => {
    discoverDealsMock.mockResolvedValue([]);

    const response = await service.searchDeals(USER_ID, 'legacy-empty', 'legacy');

    expect(response.status).toBe('unavailable');
    expect(response.deals).toEqual([]);
  });

  it('setAlert creates a DealAlert for a real offer, and recordClick logs a click and falls back to the plain deal URL', async () => {
    const offer = await offerModel.create({
      productId: new Types.ObjectId(),
      providerId: 'fake-marketplace',
      title: 'Alertable Product',
      platform: 'FakeMart',
      originalPriceMinor: 1000_00,
      currentPriceMinor: 800_00,
      deliveryChargeMinor: 0,
      finalPriceMinor: 800_00,
      dealUrl: 'https://fakemart.example/alertable',
      observedAt: new Date(),
    });

    const alert = await service.setAlert(USER_ID, offer._id.toString(), {
      enabled: true,
      targetPrice: 750,
    });
    expect(alert.enabled).toBe(true);
    expect(alert.targetPriceMinor).toBe(75_000);

    const stored = await dealAlertModel.findOne({ merchantOfferId: offer._id }).exec();
    expect(stored).not.toBeNull();

    const click = await service.recordClick(USER_ID, offer._id.toString());
    expect(click.redirectUrl).toBe('https://fakemart.example/alertable');
    expect(click.isAffiliateResolved).toBe(false); // no affiliate resolver implemented yet

    const storedClick = await dealClickModel.findOne({ merchantOfferId: offer._id }).exec();
    expect(storedClick).not.toBeNull();
    expect(storedClick?.destinationUrl).toBe('https://fakemart.example/alertable');
  });

  it('setAlert throws NotFoundException for a nonexistent offer id', async () => {
    await expect(
      service.setAlert(USER_ID, '000000000000000000000099', { enabled: true }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('recordClick throws NotFoundException for a nonexistent offer id', async () => {
    await expect(service.recordClick(USER_ID, '000000000000000000000099')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
