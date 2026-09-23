import { ConfigService } from '@nestjs/config';

import { AppConfig } from '@/config/configuration';
import { CuelinksDealsProvider } from './cuelinks.provider';

function makeConfig(cuelinks: { apiKey: string; channelId: string }): ConfigService<AppConfig> {
  return { get: () => cuelinks } as unknown as ConfigService<AppConfig>;
}

describe('CuelinksDealsProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('is not configured when both credentials are empty', () => {
    const provider = new CuelinksDealsProvider(makeConfig({ apiKey: '', channelId: '' }));
    expect(provider.isConfigured()).toBe(false);
  });

  it('is configured when channelId or apiKey is present', () => {
    const provider = new CuelinksDealsProvider(
      makeConfig({ apiKey: 'api-123', channelId: 'chan-456' }),
    );
    expect(provider.isConfigured()).toBe(true);
  });

  it('returns unavailable status when search is called without configuration', async () => {
    const provider = new CuelinksDealsProvider(makeConfig({ apiKey: '', channelId: '' }));
    const result = await provider.search({ userId: 'u1', profile: emptyProfile() });
    expect(result.status).toBe('unavailable');
    expect(result.deals).toEqual([]);
    expect(result.message).toMatch(/CUELINKS_API_KEY/);
  });

  it('returns null for resolveAffiliateUrl when not configured', async () => {
    const provider = new CuelinksDealsProvider(makeConfig({ apiKey: '', channelId: '' }));
    const resolved = await provider.resolveAffiliateUrl('https://www.flipkart.com/item1', 'user1');
    expect(resolved).toBeNull();
  });

  it('resolves authentic Cuelinks redirect URL when configured with channelId and subId', async () => {
    const provider = new CuelinksDealsProvider(makeConfig({ apiKey: '', channelId: '12345' }));
    const resolved = await provider.resolveAffiliateUrl(
      'https://www.flipkart.com/item1?q=test',
      'user_abc',
    );
    expect(resolved).toBe(
      'https://linksredirect.com/?cid=12345&subid=user_abc&url=https%3A%2F%2Fwww.flipkart.com%2Fitem1%3Fq%3Dtest',
    );
  });

  it('fetches and maps real deals from Cuelinks offers.json', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 129412,
            title: 'Huge Savings: Get 50% Off on Asus Wireless Mouse Today!',
            description: 'Wireless optical mouse with ergonomic grip',
            coupon_code: null,
            campaign_name: 'Asus India',
            categories: [{ id: 1, name: 'Electronics' }],
            tracking_url: 'https://linksredirect.com/?cid=12345&url=https%3A%2F%2Fasus.com',
            percent_off: 50,
            discount_price: 499,
          },
        ],
      }),
    });

    const provider = new CuelinksDealsProvider(makeConfig({ apiKey: 'key', channelId: '12345' }));
    const result = await provider.search({
      userId: 'u1',
      profile: emptyProfile(),
      query: 'Electronics',
    });

    expect(result.status).toBe('ok');
    expect(result.deals).toHaveLength(1);
    expect(result.deals[0].title).toBe('Huge Savings: Get 50% Off on Asus Wireless Mouse Today!');
    expect(result.deals[0].platform).toBe('Asus India');
    expect(result.deals[0].currentPrice).toBe(499);
    expect(result.deals[0].discountPercent).toBe(50);
    expect(result.deals[0].category).toBe('Electronics');
    expect(result.deals[0].priceVerified).toBe(true);
  });

  it('surfaces API failure cleanly as error status instead of crashing', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

    const provider = new CuelinksDealsProvider(makeConfig({ apiKey: 'key', channelId: '12345' }));
    const result = await provider.search({ userId: 'u1', profile: emptyProfile() });

    expect(result.status).toBe('error');
    expect(result.deals).toEqual([]);
    expect(result.message).toContain('Network offline');
  });
});

function emptyProfile() {
  return {
    currentBalance: 0,
    upcomingBills: 0,
    safeSpendingLimit: 0,
    topCategories: [],
    budgetMap: new Map(),
  };
}
