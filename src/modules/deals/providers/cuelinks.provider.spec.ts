import { ConfigService } from '@nestjs/config';

import { AppConfig } from '@/config/configuration';
import { CuelinksDealsProvider } from './cuelinks.provider';

function makeConfig(cuelinks: { apiKey: string; channelId: string }): ConfigService<AppConfig> {
  return { get: () => cuelinks } as unknown as ConfigService<AppConfig>;
}

describe('CuelinksDealsProvider', () => {
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
    const provider = new CuelinksDealsProvider(makeConfig({ apiKey: 'key', channelId: '12345' }));
    const resolved = await provider.resolveAffiliateUrl(
      'https://www.flipkart.com/item1?q=test',
      'user_abc',
    );
    expect(resolved).toBe(
      'https://linksredirect.com/?cid=12345&subid=user_abc&url=https%3A%2F%2Fwww.flipkart.com%2Fitem1%3Fq%3Dtest',
    );
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
