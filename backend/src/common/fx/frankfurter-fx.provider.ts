import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { FxProviderRate, FxRateProvider } from './fx-provider.interface';

/**
 * Frankfurter (api.frankfurter.dev) — free, open-source, no API key, ECB
 * reference-rate based, updated once daily (~16:00 CET). This is a REFERENCE
 * rate, not an executable transaction rate — the product must always label
 * it "reference rate" / "latest available FX rate," never "live FX," which
 * is why every result this class produces carries providerSource so the UI
 * can say so.
 *
 * The costing engine and controllers never import this class directly —
 * only FxRateCacheService/FxService do — so swapping in a commercial feed
 * later is one new class, not a rewrite of the costing model.
 */
@Injectable()
export class FrankfurterFxProvider implements FxRateProvider {
  readonly providerName = 'frankfurter';
  readonly providerSource = 'ECB reference rates (via Frankfurter)';

  private readonly logger = new Logger(FrankfurterFxProvider.name);
  private static readonly BASE_URL = 'https://api.frankfurter.dev/v1/latest';

  async getRate(base: string, quote: string): Promise<FxProviderRate> {
    const from = base.toUpperCase();
    const to = quote.toUpperCase();

    try {
      const { data } = await axios.get(FrankfurterFxProvider.BASE_URL, {
        params: { from, to },
        timeout: 8000,
      });
      const rate = data?.rates?.[to];
      if (typeof rate !== 'number' || !(rate > 0) || typeof data?.date !== 'string') {
        throw new Error(`unexpected response shape: ${JSON.stringify(data)}`);
      }
      return {
        rate,
        rateDate: data.date,
        providerTimestamp: null,
        sourceMetadata: { amount: data.amount, base: data.base, date: data.date },
      };
    } catch (error: any) {
      const message = error?.response?.data?.message ?? error?.message ?? 'unknown error';
      this.logger.error(`Frankfurter rate fetch failed for ${from} → ${to}: ${message}`);
      throw new ServiceUnavailableException(
        `Reference FX rate provider (Frankfurter) unavailable for ${from} → ${to}: ${message}`,
      );
    }
  }
}
