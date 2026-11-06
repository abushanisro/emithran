import { Injectable } from '@nestjs/common';

import { ToolingCostService } from '../../tooling-costs/services/tooling-cost.service';
import type { CostSummaryResponseDto } from '../dto/cost-breakdown.dto';
import { ROUTE_TOOLING_NOTE_PREFIX, routeToolingItems, type RouteToolingItem } from '../costing/shared/route-tooling';

export interface ToolingSnapshotResult {
  /** kept: the part's tooling was already right. replaced: it was rewritten. none: the route needs no tooling and none is left. */
  action: 'kept' | 'replaced' | 'none';
  items: string[];
}

interface OwnedRecord { id: string; description: string; unitCost: number; amortizationParts: number; notes: string }

const sameMoney = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * The part's tooling records for the applied route: the mold (and, as the other families join, the die) the engine priced, written as tooling items so
 * the Cost Guide lists them and their amortisation is in the part's cost. Same shape as MaterialCostSnapshotService: the record is a snapshot of the
 * engine's cost summary. The records it writes carry ROUTE_TOOLING_NOTE_PREFIX; those, and only those, are replaced on the next apply, so a tool the
 * user added by hand is never touched. A record already right (same tool, investment and amortisation) is kept.
 */
@Injectable()
export class ToolingCostSnapshotService {
  constructor(private readonly tooling: ToolingCostService) {}

  async ensure(input: { bomItemId: string; summary: CostSummaryResponseDto; userId: string; organizationId: string; token: string }): Promise<ToolingSnapshotResult> {
    const { bomItemId, summary, userId, organizationId, token } = input;
    const wanted = routeToolingItems(summary);
    const { records } = await this.tooling.findAll({ bomItemId, page: 1, limit: 100 } as never, userId, token);
    const owned = (records as unknown as OwnedRecord[]).filter((r) => r.notes?.startsWith(ROUTE_TOOLING_NOTE_PREFIX));

    if (this.isUpToDate(owned, wanted)) return { action: wanted.length === 0 ? 'none' : 'kept', items: wanted.map((w) => w.description) };

    for (const r of owned) await this.tooling.remove(r.id, userId, token);
    for (const w of wanted) {
      await this.tooling.create(
        {
          bomItemId, toolingType: w.toolingType, description: w.description, specifications: w.specifications,
          unitCost: w.investmentUsd, quantity: 1, amortizationParts: w.amortizationParts, usagePercentage: 100, isCustom: true,
          notes: `${ROUTE_TOOLING_NOTE_PREFIX}${w.key}`, isActive: true,
        } as never,
        userId, token, organizationId,
      );
    }
    return { action: wanted.length === 0 ? 'none' : 'replaced', items: wanted.map((w) => w.description) };
  }

  private isUpToDate(owned: OwnedRecord[], wanted: RouteToolingItem[]): boolean {
    if (owned.length !== wanted.length) return false;
    return wanted.every((w) => owned.some((r) => r.notes === `${ROUTE_TOOLING_NOTE_PREFIX}${w.key}` && r.description === w.description && sameMoney(r.unitCost, w.investmentUsd) && r.amortizationParts === w.amortizationParts));
  }
}
