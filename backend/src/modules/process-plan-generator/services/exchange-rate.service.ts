import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';

/**
 * Loads the active budget exchange rates from the `exchange_rates` table and
 * provides cost conversion to INR.
 *
 * Rates are admin-set (budget rates for the financial year), NOT live FX.
 * This is the correct approach for manufacturing cost engineering:
 *   - Live rates introduce noise and break reproducibility
 *   - Every generated plan snapshots the rates it used so costs remain
 *     stable when reopened months later
 *
 * All rates are from_currency → INR. INR itself has a rate of 1.
 */
@Injectable()
export class ExchangeRateService {
  private readonly logger = new Logger(ExchangeRateService.name);

  // In-memory cache — reloaded once per generate call (stateless across requests)
  private rateMap: Map<string, number> = new Map([['INR', 1]]);
  private lastLoaded: number = 0;
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Load the active budget rates from DB (cached per TTL).
   * Always call this at the start of a generation session.
   */
  async loadRates(accessToken: string | null): Promise<void> {
    const now = Date.now();
    if (now - this.lastLoaded < ExchangeRateService.CACHE_TTL_MS && this.rateMap.size > 1) {
      return;
    }

    const client = this.supabaseService.getClient(accessToken ?? undefined);
    const { data, error } = await client
      .from('exchange_rates')
      .select('from_currency, to_currency, rate')
      .eq('is_active', true)
      .eq('to_currency', 'INR');

    if (error) {
      this.logger.warn(`Failed to load exchange rates: ${error.message}. Using defaults.`);
      this.applyDefaults();
      return;
    }

    this.rateMap = new Map([['INR', 1]]);
    for (const row of data ?? []) {
      if (row.from_currency && typeof row.rate === 'number' && row.rate > 0) {
        this.rateMap.set(row.from_currency, row.rate);
      }
    }

    if (this.rateMap.size === 1) {
      this.logger.warn('No active exchange rates found in DB. Applying defaults.');
      this.applyDefaults();
    }

    this.lastLoaded = now;
    this.logger.log(`Exchange rates loaded: ${JSON.stringify(Object.fromEntries(this.rateMap))}`);
  }

  /**
   * Convert an amount from `fromCurrency` to INR.
   * If the currency is unknown, logs a warning and returns the raw value
   * (treats it as INR to avoid silently producing wrong costs).
   */
  convertToInr(amount: number, fromCurrency: string | null | undefined): number {
    if (!fromCurrency || fromCurrency === 'INR') return amount;
    const rate = this.rateMap.get(fromCurrency.toUpperCase());
    if (rate == null) {
      this.logger.warn(`Unknown currency '${fromCurrency}' — treating as INR. Add rate to exchange_rates table.`);
      return amount;
    }
    return amount * rate;
  }

  /**
   * Returns the current rate map as a plain object suitable for snapshotting
   * on the process_plan_generations record.
   */
  snapshot(): Record<string, number> {
    return Object.fromEntries(this.rateMap);
  }

  private applyDefaults(): void {
    // FY2026-27 fallback rates if table is empty or unreachable
    this.rateMap.set('USD', 83.50);
    this.rateMap.set('EUR', 89.00);
    this.rateMap.set('GBP', 104.00);
    this.rateMap.set('AED', 22.75);
    this.rateMap.set('SGD', 61.50);
  }
}
