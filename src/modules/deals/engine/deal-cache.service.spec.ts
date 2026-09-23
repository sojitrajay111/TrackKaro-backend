import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';

import {
  DealSearchLog,
  DealSearchLogDocument,
  DealSearchLogSchema,
} from '../schemas/deal-search-log.schema';
import {
  MerchantOffer,
  MerchantOfferDocument,
  MerchantOfferSchema,
} from '../schemas/merchant-offer.schema';
import { DealCacheService, OFFER_STALE_AFTER_MS } from './deal-cache.service';

describe('DealCacheService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let service: DealCacheService;
  let searchLogModel: Model<DealSearchLogDocument>;
  let offerModel: Model<MerchantOfferDocument>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([
          { name: DealSearchLog.name, schema: DealSearchLogSchema },
          { name: MerchantOffer.name, schema: MerchantOfferSchema },
        ]),
      ],
      providers: [DealCacheService],
    }).compile();

    service = moduleRef.get(DealCacheService);
    searchLogModel = moduleRef.get(getModelToken(DealSearchLog.name));
    offerModel = moduleRef.get(getModelToken(MerchantOffer.name));
  }, 60_000);

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  it('normalizes an empty/undefined query the same as "all"', () => {
    expect(service.normalizeQuery(undefined)).toBe('all');
    expect(service.normalizeQuery('  Nike Shoes  ')).toBe('nike shoes');
  });

  it('treats a freshly observed timestamp as not stale, and an old one as stale', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    expect(service.isStale(new Date('2026-01-01T11:00:00Z'), now)).toBe(false);
    expect(service.isStale(new Date(now.getTime() - OFFER_STALE_AFTER_MS - 1), now)).toBe(true);
  });

  it('is a cache miss when nothing has ever been logged for this provider+query', async () => {
    const result = await service.getFreshCachedOffers('flipkart', 'nonexistent-query');
    expect(result).toBeNull();
  });

  it('is a cache hit once a recent successful search was logged and offers exist', async () => {
    await service.logSearch('flipkart', 'nike shoes', 'success', 1);
    await offerModel.create({
      productId: new Types.ObjectId(),
      providerId: 'flipkart',
      title: 'Nike Air Zoom',
      platform: 'Flipkart',
      originalPriceMinor: 500_00,
      currentPriceMinor: 400_00,
      deliveryChargeMinor: 0,
      finalPriceMinor: 400_00,
      dealUrl: 'https://flipkart/nike-air-zoom',
      observedAt: new Date(),
    });

    const result = await service.getFreshCachedOffers('flipkart', 'Nike Shoes');
    expect(result).not.toBeNull();
    expect(result?.length).toBeGreaterThan(0);
  });

  it('is a cache miss for a different provider even with the same query logged', async () => {
    const result = await service.getFreshCachedOffers('amazon', 'nike shoes');
    expect(result).toBeNull();
  });

  it('is a cache miss once the logged search is older than the staleness window', async () => {
    await searchLogModel.create({
      providerId: 'flipkart',
      normalizedQuery: 'stale query',
      status: 'success',
      resultCount: 1,
      observedAt: new Date(Date.now() - OFFER_STALE_AFTER_MS - 60_000),
    });

    const result = await service.getFreshCachedOffers('flipkart', 'stale query');
    expect(result).toBeNull();
  });

  it('does not treat an unavailable/error log as cacheable', async () => {
    await service.logSearch('flipkart', 'unconfigured-search', 'unavailable', 0, 'not configured');
    const result = await service.getFreshCachedOffers('flipkart', 'unconfigured-search');
    expect(result).toBeNull();
  });
});
