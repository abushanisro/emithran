import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { FrankfurterFxProvider } from './frankfurter-fx.provider';

export interface CachedFxRate {
  rate: number;
  /** YYYY-MM-DD the rate is FOR. */
  rateDate: string;
  provider: string;
  providerSource: string;
  retrievedAt: string;
  /**
   * true when this rate could not be freshly confirmed today (the live
   * provider call failed and this is the most recent row on file, however
   * old) — the caller MUST disclose this to the user, never present it as
   * current silently.
   */
  stale: boolean;
}

/**
 * Caches reference FX rates (fx_rate_snapshots table, migration 472) so a
 * Cost Summary request never needs to call the external provider directly —
 * one fetch per (base, quote, day), reused for every request that day.
 *
 * Freshness policy: a cached row is valid for its own `rate_date` (through
 * end of that calendar day). On a cache miss, calls the live provider and
 * writes a new row. If the live provider is unavailable AND there is no
 * row for today, falls back to the most recent row on file for this pair —
 * flagged `stale: true` — rather than fabricating a number. If no row
 * exists at all, the provider's own failure propagates (fail clearly).
 */
@Injectable()
export class FxRateCacheService {
  private readonly logger = new Logger(FxRateCacheService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly provider: FrankfurterFxProvider,
  ) {}

  async getCachedOrFetch(base: string, quote: string): Promise<CachedFxRate> {
    const from = base.toUpperCase();
    const to = quote.toUpperCase();
    const today = todayIso();
    const client = this.supabaseService.getAdminClient();

    const { data: cached, error: cacheError } = await client
      .from('fx_rate_snapshots')
      .select('rate, rate_date, provider, provider_source, retrieved_at')
      .eq('base_currency', from)
      .eq('quote_currency', to)
      .eq('rate_date', today)
      .order('retrieved_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!cacheError && cached) {
      return {
        rate: Number(cached.rate),
        rateDate: cached.rate_date,
        provider: cached.provider,
        providerSource: cached.provider_source,
        retrievedAt: cached.retrieved_at,
        stale: false,
      };
    }

    try {
      return await this.fetchAndCache(from, to);
    } catch (fetchError) {
      const { data: staleRow } = await client
        .from('fx_rate_snapshots')
        .select('rate, rate_date, provider, provider_source, retrieved_at')
        .eq('base_currency', from)
        .eq('quote_currency', to)
        .order('rate_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (staleRow) {
        this.logger.warn(
          `Reference FX provider unavailable for ${from} → ${to}; serving stale cached rate from ${staleRow.rate_date}`,
        );
        return {
          rate: Number(staleRow.rate),
          rateDate: staleRow.rate_date,
          provider: staleRow.provider,
          providerSource: staleRow.provider_source,
          retrievedAt: staleRow.retrieved_at,
          stale: true,
        };
      }
      throw fetchError;
    }
  }

  /** Always calls the live provider — bypasses the cache-hit check. Backs the "Refresh FX" action. */
  async refresh(base: string, quote: string): Promise<CachedFxRate> {
    return this.fetchAndCache(base.toUpperCase(), quote.toUpperCase());
  }

  private async fetchAndCache(from: string, to: string): Promise<CachedFxRate> {
    const result = await this.provider.getRate(from, to);
    const retrievedAt = new Date().toISOString();
    const client = this.supabaseService.getAdminClient();

    const { error } = await client
      .from('fx_rate_snapshots')
      .upsert(
        {
          provider: this.provider.providerName,
          provider_source: this.provider.providerSource,
          base_currency: from,
          quote_currency: to,
          rate: result.rate,
          rate_date: result.rateDate,
          provider_timestamp: result.providerTimestamp,
          retrieved_at: retrievedAt,
          source_metadata: result.sourceMetadata,
        },
        { onConflict: 'provider,base_currency,quote_currency,rate_date' },
      );

    if (error) {
      this.logger.error(`Failed to cache FX rate ${from} → ${to}: ${error.message}`);
    }

    return {
      rate: result.rate,
      rateDate: result.rateDate,
      provider: this.provider.providerName,
      providerSource: this.provider.providerSource,
      retrievedAt,
      stale: false,
    };
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
