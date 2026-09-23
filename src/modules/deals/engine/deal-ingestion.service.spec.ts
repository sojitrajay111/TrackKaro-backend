import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model } from 'mongoose';

import { ProviderDealResult } from '../providers/deals-provider.interface';
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
import { Product, ProductDocument, ProductSchema } from '../schemas/product.schema';
import { DealIngestionService } from './deal-ingestion.service';

function fakeDeal(overrides: Partial<ProviderDealResult> = {}): ProviderDealResult {
  return {
    title: 'Sony WH-CH520 Headphones',
    platform: 'Flipkart',
    category: 'Electronics',
    originalPrice: 4990,
    currentPrice: 3499,
    discountPercent: 30,
    deliveryCharge: 0,
    finalPrice: 3499,
    savingsAmount: 1491,
    dealUrl: 'https://www.flipkart.com/sony-wh-ch520',
    priceVerified: true,
    urlVerified: true,
    ...overrides,
  };
}

describe('DealIngestionService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let ingestionService: DealIngestionService;
  let productModel: Model<ProductDocument>;
  let offerModel: Model<MerchantOfferDocument>;
  let priceHistoryModel: Model<PriceHistoryDocument>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([
          { name: Product.name, schema: ProductSchema },
          { name: MerchantOffer.name, schema: MerchantOfferSchema },
          { name: PriceHistory.name, schema: PriceHistorySchema },
        ]),
      ],
      providers: [DealIngestionService],
    }).compile();

    ingestionService = moduleRef.get(DealIngestionService);
    productModel = moduleRef.get(getModelToken(Product.name));
    offerModel = moduleRef.get(getModelToken(MerchantOffer.name));
    priceHistoryModel = moduleRef.get(getModelToken(PriceHistory.name));
  }, 60_000);

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  it('creates one Product and one MerchantOffer for a new deal', async () => {
    const [offer] = await ingestionService.ingest('flipkart', [
      fakeDeal({ dealUrl: 'https://x/a' }),
    ]);

    expect(offer.providerId).toBe('flipkart');
    expect(offer.currentPriceMinor).toBe(349_900);
    expect(await productModel.countDocuments().exec()).toBe(1);
    const product = await productModel.findById(offer.productId).exec();
    expect(product?.category).toBe('Electronics');
  });

  it('does not duplicate the Product when the same title is ingested from a different provider', async () => {
    await ingestionService.ingest('amazon', [
      fakeDeal({ dealUrl: 'https://amazon/sony-wh-ch520', platform: 'Amazon' }),
    ]);

    const products = await productModel.find({}).exec();
    expect(products).toHaveLength(1); // still just the one canonical product from the previous test

    const offers = await offerModel.find({}).exec();
    expect(offers).toHaveLength(2); // one MerchantOffer per provider, same productId
    expect(new Set(offers.map((o) => o.productId.toString())).size).toBe(1);
  });

  it('upserts (does not duplicate) the same provider offer on re-ingest, and appends price history', async () => {
    const beforeOffers = await offerModel.countDocuments({ providerId: 'flipkart' }).exec();

    await ingestionService.ingest('flipkart', [
      fakeDeal({ dealUrl: 'https://x/a', currentPrice: 2999, finalPrice: 2999 }),
    ]);

    const afterOffers = await offerModel.countDocuments({ providerId: 'flipkart' }).exec();
    expect(afterOffers).toBe(beforeOffers); // same offer updated, not duplicated

    const updated = await offerModel
      .findOne({ providerId: 'flipkart', dealUrl: 'https://x/a' })
      .exec();
    expect(updated?.currentPriceMinor).toBe(299_900);

    const history = await priceHistoryModel.find({ merchantOfferId: updated?._id }).exec();
    expect(history.length).toBeGreaterThanOrEqual(2); // original ingest + this re-ingest
  });

  it('upserts by providerProductId when the provider supplies one, even if the URL changes', async () => {
    await ingestionService.ingest('flipkart', [
      fakeDeal({ providerProductId: 'FKPT123', dealUrl: 'https://x/b-v1' }),
    ]);
    await ingestionService.ingest('flipkart', [
      fakeDeal({
        providerProductId: 'FKPT123',
        dealUrl: 'https://x/b-v2',
        currentPrice: 3000,
        finalPrice: 3000,
      }),
    ]);

    const matching = await offerModel
      .find({ providerId: 'flipkart', providerProductId: 'FKPT123' })
      .exec();
    expect(matching).toHaveLength(1);
    expect(matching[0].dealUrl).toBe('https://x/b-v2');
  });
});
