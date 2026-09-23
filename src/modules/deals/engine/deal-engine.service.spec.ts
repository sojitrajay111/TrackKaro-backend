import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';

import {
  MerchantOffer,
  MerchantOfferDocument,
  MerchantOfferSchema,
} from '../schemas/merchant-offer.schema';
import {
  PriceHistory,
  PriceHistoryDocument,
  PriceHistorySchema,
} from '../schemas/price-history.schema';
import { DealEngineService } from './deal-engine.service';

describe('DealEngineService — pure calculations', () => {
  // These methods don't touch the DB, so a lightweight module (no memory server) is enough.
  let service: DealEngineService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DealEngineService,
        { provide: getModelToken(PriceHistory.name), useValue: {} },
        { provide: getModelToken(MerchantOffer.name), useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(DealEngineService);
  });

  it('computes discount percent from original vs final price', () => {
    expect(service.computeDiscountPercent(100_00, 60_00)).toBe(40);
    expect(service.computeDiscountPercent(0, 60_00)).toBe(0); // no MRP to compare against
    expect(service.computeDiscountPercent(100_00, 150_00)).toBe(0); // price went up, never negative
  });

  it('caps discount percent at 99%', () => {
    expect(service.computeDiscountPercent(100_00, 1)).toBe(99);
  });

  it('effective price is the offer final price until a verified numeric coupon/cashback amount exists', () => {
    expect(service.computeEffectivePriceMinor({ finalPriceMinor: 500_00 })).toBe(500_00);
  });

  it('scores higher for verified, discounted, coupon-bearing offers', () => {
    const verified = service.computeScore({
      discountPercent: 40,
      priceVerified: true,
      urlVerified: true,
      couponCode: 'X',
      rating: 4.5,
    });
    const unverified = service.computeScore({ discountPercent: 40 });
    expect(verified).toBeGreaterThan(unverified);
  });
});

describe('DealEngineService — price history comparison', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let service: DealEngineService;
  let priceHistoryModel: Model<PriceHistoryDocument>;
  let offerModel: Model<MerchantOfferDocument>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([
          { name: PriceHistory.name, schema: PriceHistorySchema },
          { name: MerchantOffer.name, schema: MerchantOfferSchema },
        ]),
      ],
      providers: [DealEngineService],
    }).compile();

    service = moduleRef.get(DealEngineService);
    priceHistoryModel = moduleRef.get(getModelToken(PriceHistory.name));
    offerModel = moduleRef.get(getModelToken(MerchantOffer.name));
  }, 60_000);

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  it('never claims an all-time low with only a single observation', async () => {
    const offerId = new Types.ObjectId();
    const productId = new Types.ObjectId();
    await priceHistoryModel.create({
      merchantOfferId: offerId,
      productId,
      priceMinor: 500_00,
      finalPriceMinor: 500_00,
      observedAt: new Date(),
    });

    const result = await service.priceHistoryComparison(offerId, 500_00);
    expect(result.sampleCount).toBe(1);
    expect(result.isAllTimeLow).toBe(false);
    expect(result.lowestObservedMinor).toBe(500_00);
  });

  it('reports an all-time low once history has multiple observations and the current price is the lowest', async () => {
    const offerId = new Types.ObjectId();
    const productId = new Types.ObjectId();
    await priceHistoryModel.insertMany([
      {
        merchantOfferId: offerId,
        productId,
        priceMinor: 600_00,
        finalPriceMinor: 600_00,
        observedAt: new Date(Date.now() - 20_000),
      },
      {
        merchantOfferId: offerId,
        productId,
        priceMinor: 550_00,
        finalPriceMinor: 550_00,
        observedAt: new Date(Date.now() - 10_000),
      },
    ]);

    const result = await service.priceHistoryComparison(offerId, 500_00);
    expect(result.sampleCount).toBe(2);
    expect(result.isAllTimeLow).toBe(true);
    expect(result.lowestObservedMinor).toBe(550_00);
  });

  it('does not report an all-time low when a cheaper price was already observed before', async () => {
    const offerId = new Types.ObjectId();
    const productId = new Types.ObjectId();
    await priceHistoryModel.insertMany([
      {
        merchantOfferId: offerId,
        productId,
        priceMinor: 400_00,
        finalPriceMinor: 400_00,
        observedAt: new Date(Date.now() - 20_000),
      },
      {
        merchantOfferId: offerId,
        productId,
        priceMinor: 600_00,
        finalPriceMinor: 600_00,
        observedAt: new Date(Date.now() - 10_000),
      },
    ]);

    const result = await service.priceHistoryComparison(offerId, 500_00);
    expect(result.isAllTimeLow).toBe(false);
    expect(result.lowestObservedMinor).toBe(400_00);
  });

  it('returns null lowest price with no history at all', async () => {
    const result = await service.priceHistoryComparison(new Types.ObjectId(), 500_00);
    expect(result.lowestObservedMinor).toBeNull();
    expect(result.isAllTimeLow).toBe(false);
    expect(result.sampleCount).toBe(0);
  });

  it('finds the cheapest competing offer for the same product, excluding itself', async () => {
    const productId = new Types.ObjectId();
    const offerA = await offerModel.create({
      productId,
      providerId: 'flipkart',
      title: 'Test product',
      platform: 'Flipkart',
      originalPriceMinor: 1000_00,
      currentPriceMinor: 900_00,
      deliveryChargeMinor: 0,
      finalPriceMinor: 900_00,
      dealUrl: 'https://a',
      observedAt: new Date(),
    });
    const offerB = await offerModel.create({
      productId,
      providerId: 'amazon',
      title: 'Test product',
      platform: 'Amazon',
      originalPriceMinor: 1000_00,
      currentPriceMinor: 800_00,
      deliveryChargeMinor: 0,
      finalPriceMinor: 800_00,
      dealUrl: 'https://b',
      observedAt: new Date(),
    });

    const cheapestForA = await service.cheapestCompetingOfferMinor(productId, offerA._id);
    expect(cheapestForA).toBe(800_00);

    const cheapestForB = await service.cheapestCompetingOfferMinor(productId, offerB._id);
    expect(cheapestForB).toBe(900_00);
  });
});
