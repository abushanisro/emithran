import type { DraftPackage } from './draft-line.dto';

/**
 * One ranked alternative route produced by AlternativeRoutePlannerService.
 *
 * The `draft` field intentionally omits `alternatives` and `selectedRouteId`
 * to prevent circular nesting — only the top-level DraftPackage carries those.
 */
export interface AlternativeRoute {
  routeId: string;                                       // 'route-a', 'route-b', ...
  routeLabel: string;                                    // "Route A — Laser Cutting (Recommended)"
  complexityLevel: string;                               // 'simple' | 'standard' | 'complex'
  templateName: string;
  draft: Omit<DraftPackage, 'alternatives' | 'selectedRouteId'>;
  costPreview: DraftPackage['costPreview'];
  estimatedLeadTimeHours: number;                        // sum of cycleTimeSeconds / 3600
  riskScore: number;                                     // 0–100
  compositeRank: number;                                 // 0–1, lower = better
  isRecommended: boolean;
  rationale: string;                                     // "₹24 (17%) lower cost than Route B"
}
