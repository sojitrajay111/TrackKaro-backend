import { ConfigService } from '@nestjs/config';

import { AppConfig } from '@/config/configuration';
import { FlipkartDealsProvider } from './flipkart.provider';

function makeConfig(flipkart: {
  affiliateId: string;
  affiliateToken: string;
}): ConfigService<AppConfig> {
  return { get: () => flipkart } as unknown as ConfigService<AppConfig>;
}

describe('FlipkartDealsProvider', () => {
  it('is not configured when credentials are missing', () => {
    const provider = new FlipkartDealsProvider(makeConfig({ affiliateId: '', affiliateToken: '' }));
    expect(provider.isConfigured()).toBe(false);
  });

  it('is configured once both credentials are present', () => {
    const provider = new FlipkartDealsProvider(
      makeConfig({ affiliateId: 'id', affiliateToken: 'token' }),
    );
    expect(provider.isConfigured()).toBe(true);
  });

  it('never returns fabricated deals when unconfigured', async () => {
    const provider = new FlipkartDealsProvider(makeConfig({ affiliateId: '', affiliateToken: '' }));
    const result = await provider.search({ userId: 'u1', profile: emptyProfile() });
    expect(result.status).toBe('unavailable');
    expect(result.deals).toEqual([]);
    expect(result.message).toMatch(/FLIPKART_AFFILIATE_ID/);
  });

  it('still makes no network call and returns unavailable even once "configured" — the real API call is not implemented yet', async () => {
    const provider = new FlipkartDealsProvider(
      makeConfig({ affiliateId: 'id', affiliateToken: 'token' }),
    );
    const result = await provider.search({ userId: 'u1', profile: emptyProfile() });
    expect(result.status).toBe('unavailable');
    expect(result.deals).toEqual([]);
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
