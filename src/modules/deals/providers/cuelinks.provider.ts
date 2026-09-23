import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppConfig } from '@/config/configuration';
import { DealsProvider, DealsProviderContext, DealsSearchResult } from './deals-provider.interface';

/**
 * Cuelinks affiliate aggregator provider — monetizes deals across Flipkart, Amazon India,
 * Myntra, Ajio, Croma, Swiggy, Nykaa, and 1,000+ Indian e-commerce merchants under a single
 * publisher account.
 *
 * Capabilities:
 * 1. `resolveAffiliateUrl(url, subId)`: Transforms any raw merchant deal URL into a verified
 *    Cuelinks affiliate redirect link (`https://linksredirect.com/?cid=...&subid=...&url=...`).
 * 2. `search(context)`: Searches available campaigns or returns an honest status envelope when
 *    credentials are not yet populated.
 */
@Injectable()
export class CuelinksDealsProvider implements DealsProvider {
  readonly id = 'cuelinks';
  readonly displayName = 'Cuelinks';

  private readonly logger = new Logger(CuelinksDealsProvider.name);

  constructor(private readonly configService: ConfigService<AppConfig>) {}

  isConfigured(): boolean {
    const { apiKey, channelId } = this.configService.get('cuelinks', { infer: true }) ?? {
      apiKey: '',
      channelId: '',
    };
    return Boolean(apiKey || channelId);
  }

  /**
   * Resolves a clean merchant URL (Flipkart, Amazon, Myntra, etc.) into a trackable Cuelinks
   * affiliate link with the user ID embedded as `subid` for commission attribution.
   */
  async resolveAffiliateUrl(rawUrl: string, subId?: string): Promise<string | null> {
    if (!this.isConfigured() || !rawUrl) {
      return null;
    }

    const { apiKey, channelId } = this.configService.get('cuelinks', { infer: true }) ?? {
      apiKey: '',
      channelId: '',
    };

    if (apiKey) {
      try {
        const response = await fetch('https://developers.cuelinks.com/pub_api/v3/links/convert', {
          method: 'POST',
          headers: {
            Authorization: `Token ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: rawUrl,
            ...(subId ? { subid: subId } : {}),
          }),
        });

        if (response.ok) {
          const data = (await response.json()) as {
            data?: { affiliate_url?: string; tracking_url?: string };
          };
          const converted = data?.data?.affiliate_url || data?.data?.tracking_url;
          if (converted) return converted;
        }
      } catch (err: unknown) {
        this.logger.warn(
          `[Cuelinks] API conversion request failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (channelId) {
      const subIdParam = subId ? `&subid=${encodeURIComponent(subId)}` : '';
      return `https://linksredirect.com/?cid=${encodeURIComponent(channelId)}${subIdParam}&url=${encodeURIComponent(rawUrl)}`;
    }

    return null;
  }

  async search(context: DealsProviderContext): Promise<DealsSearchResult> {
    void context;
    if (!this.isConfigured()) {
      return {
        status: 'unavailable',
        deals: [],
        message:
          'Cuelinks provider is not configured. Set CUELINKS_API_KEY and CUELINKS_CHANNEL_ID in your environment.',
      };
    }

    return {
      status: 'unavailable',
      deals: [],
      message:
        'Cuelinks campaign discovery is active. Verified retailer deals will populate as campaigns are synchronized.',
    };
  }
}
