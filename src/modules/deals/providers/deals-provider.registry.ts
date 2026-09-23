import { Inject, Injectable, InjectionToken } from '@nestjs/common';

import { DealsProvider } from './deals-provider.interface';

/** Multi-provider injection token — see `deals.module.ts` for how providers register into it. */
export const DEALS_PROVIDERS: InjectionToken = Symbol('DEALS_PROVIDERS');

/**
 * Holds every registered real-marketplace provider (Flipkart today; Amazon/Myntra/Croma/Ajio/
 * Tata CLiQ later), in priority order. Deliberately excludes the legacy Gemini engine — that one
 * is wired into `DealsService` directly, since it's an explicit comparison/rollout fallback, not
 * a candidate "real data" provider.
 */
@Injectable()
export class DealsProviderRegistry {
  constructor(@Inject(DEALS_PROVIDERS) private readonly providers: DealsProvider[]) {}

  getProviders(): DealsProvider[] {
    return this.providers;
  }

  getProvider(id: string): DealsProvider | undefined {
    return this.providers.find((p) => p.id === id);
  }
}
