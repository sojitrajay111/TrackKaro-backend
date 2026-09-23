import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppConfig } from '@/config/configuration';
import { DealsProvider, DealsProviderContext, DealsSearchResult } from './deals-provider.interface';

/**
 * Flipkart marketplace provider — the first real-data provider for the Deals engine.
 *
 * INTENTIONALLY NOT WIRED TO A LIVE ENDPOINT YET. Do not guess Flipkart's affiliate/API
 * request or response shape here — verify it against the current Flipkart Affiliate API
 * documentation (https://affiliate.flipkart.com, program terms may change the exact endpoint,
 * auth headers and response schema over time) once an application/API key is actually issued.
 * Wiring a guessed contract against a live partner API is worse than not wiring one at all.
 *
 * What IS real:
 * - `isConfigured()` genuinely checks for credentials in the environment.
 * - `search()` makes NO network call. Until real credentials + a verified request/response
 *   contract exist, it always returns an 'unavailable' result — per the core product rule, an
 *   honest "no data" beats an invented deal.
 *
 * To finish this integration later:
 * 1. Confirm the current Flipkart Affiliate API base URL, auth headers and search endpoint.
 * 2. Implement the actual `fetch`/HTTP call inside `search()`, mapping Flipkart's response
 *    fields onto `ProviderDealResult` (price in the affiliate feed is typically already in
 *    rupees — confirm before assuming, since the rest of this codebase stores money in paise
 *    at rest via `toMinorUnits`/`toMajorUnits`).
 * 3. Set `priceVerified`/`urlVerified: true` only for fields the API response actually confirms.
 * 4. Add response caching (the spec mentions a "cached" unavailable state) once real traffic
 *    patterns against the affiliate API's rate limits are known.
 */
@Injectable()
export class FlipkartDealsProvider implements DealsProvider {
  readonly id = 'flipkart';
  readonly displayName = 'Flipkart';

  private readonly logger = new Logger(FlipkartDealsProvider.name);

  constructor(private readonly configService: ConfigService<AppConfig>) {}

  isConfigured(): boolean {
    const { affiliateId, affiliateToken } = this.configService.get('flipkart', { infer: true }) ?? {
      affiliateId: '',
      affiliateToken: '',
    };
    return Boolean(affiliateId && affiliateToken);
  }

  async search(context: DealsProviderContext): Promise<DealsSearchResult> {
    void context; // not used yet — see class doc comment; kept for interface + call-site compatibility.
    if (!this.isConfigured()) {
      return {
        status: 'unavailable',
        deals: [],
        message:
          'Flipkart provider has no credentials configured. Set FLIPKART_AFFILIATE_ID and ' +
          'FLIPKART_AFFILIATE_TOKEN once approved for the Flipkart Affiliate API.',
      };
    }

    // Credentials exist, but the real HTTP call is deliberately not implemented — see the class
    // doc comment above for why, and what's needed to finish this.
    this.logger.warn(
      'Flipkart credentials are set, but the live API call is not implemented yet — returning ' +
        '"unavailable" rather than guessing at Flipkart\'s request/response contract.',
    );
    return {
      status: 'unavailable',
      deals: [],
      message:
        'Flipkart integration is configured but not yet implemented — awaiting verified API documentation.',
    };
  }
}
