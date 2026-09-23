import { ConfigService } from '@nestjs/config';

import { AppConfig } from '@/config/configuration';
import { AmazonDealsProvider } from './amazon.provider';
import { CuelinksDealsProvider } from './cuelinks.provider';

describe('AmazonDealsProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function makeConfig(rapidApiKey = 'test_rapid_key', channelId = '322790') {
    return {
      get: (key: string) => {
        if (key === 'rapidapi') return { key: rapidApiKey };
        if (key === 'cuelinks') return { apiKey: 'test_cuelinks', channelId };
        return null;
      },
    } as unknown as ConfigService<AppConfig>;
  }

  function makeCuelinksProvider(channelId = '322790') {
    const config = makeConfig('test_rapid_key', channelId);
    return new CuelinksDealsProvider(config);
  }

  it('reports isConfigured true when RAPIDAPI_KEY is present', () => {
    const provider = new AmazonDealsProvider(makeConfig('some_key'), makeCuelinksProvider());
    expect(provider.isConfigured()).toBe(true);
  });

  it('reports isConfigured false when RAPIDAPI_KEY is empty', () => {
    const provider = new AmazonDealsProvider(makeConfig(''), makeCuelinksProvider());
    expect(provider.isConfigured()).toBe(false);
  });

  it('returns unavailable when not configured', async () => {
    const provider = new AmazonDealsProvider(makeConfig(''), makeCuelinksProvider());
    const res = await provider.search({
      query: 'toothbrush',
      profile: {
        currentBalance: 1000,
        upcomingBills: 0,
        safeSpendingLimit: 1000,
        topCategories: [],
        budgetMap: new Map(),
      },
    });
    expect(res.status).toBe('unavailable');
    expect(res.deals).toHaveLength(0);
  });

  it('fetches real Amazon India products and wraps links with Cuelinks', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'OK',
        data: {
          products: [
            {
              asin: 'B0CFLFYC93',
              product_title: 'Colgate Sensitive Care Toothbrush',
              product_price: '₹183',
              product_original_price: '₹310',
              currency: 'INR',
              product_star_rating: '4.3',
              product_num_ratings: 19482,
              product_url: 'https://www.amazon.in/dp/B0CFLFYC93',
              product_photo: 'https://m.media-amazon.com/images/I/71ei8lg5vyL.jpg',
            },
          ],
        },
      }),
    });

    const cuelinks = makeCuelinksProvider('322790');
    const provider = new AmazonDealsProvider(makeConfig('test_key', '322790'), cuelinks);

    const res = await provider.search({
      query: 'toothbrush',
      userId: 'user_123',
      profile: {
        currentBalance: 5000,
        upcomingBills: 0,
        safeSpendingLimit: 5000,
        topCategories: [],
        budgetMap: new Map(),
      },
    });

    expect(res.status).toBe('ok');
    expect(res.deals).toHaveLength(1);

    const deal = res.deals[0];
    expect(deal.title).toBe('Colgate Sensitive Care Toothbrush');
    expect(deal.currentPrice).toBe(183);
    expect(deal.originalPrice).toBe(310);
    expect(deal.discountPercent).toBe(41);
    expect(deal.category).toBe('Beauty');
    expect(deal.platform).toBe('Amazon.in');
    expect(deal.dealUrl).toContain('linksredirect.com/?cid=322790');
    expect(deal.dealUrl).toContain(encodeURIComponent('https://www.amazon.in/dp/B0CFLFYC93'));
  });

  it('handles API errors gracefully without throwing', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

    const cuelinks = makeCuelinksProvider('322790');
    const provider = new AmazonDealsProvider(makeConfig('test_key'), cuelinks);

    const res = await provider.search({
      query: 'iphone',
      profile: {
        currentBalance: 1000,
        upcomingBills: 0,
        safeSpendingLimit: 1000,
        topCategories: [],
        budgetMap: new Map(),
      },
    });

    expect(res.status).toBe('error');
    expect(res.deals).toHaveLength(0);
    expect(res.message).toContain('Network offline');
  });
});
