import { Injectable, Logger } from '@nestjs/common';

/**
 * Credit accounting for the Process Plan Generator.
 *
 * Debit happens at APPLY time (not at generate), so:
 *   - Discarded drafts cost nothing.
 *   - Out-of-scope generations cost nothing.
 *   - Apply that fails inside the transaction → refund (no charge).
 *
 * The total credit pool is tracked in the frontend's MithranAICreditsBar
 * via aggregations over project/BOM counts. For this Phase, we don't
 * maintain a separate credit-ledger table — we record the charge on the
 * generation row itself, and the credit-bar will sum applied generations
 * the same way it sums other modules.
 */
@Injectable()
export class CreditMeterService {
  private readonly logger = new Logger(CreditMeterService.name);

  // 50 credits per applied generation. Matches the value documented in
  // CR_PER_GENERATION in components/layout/MithranAICreditsBar.tsx.
  static readonly CREDITS_PER_GENERATION = 50;

  costFor(_userId: string, _bomItemId: string): number {
    return CreditMeterService.CREDITS_PER_GENERATION;
  }
}
