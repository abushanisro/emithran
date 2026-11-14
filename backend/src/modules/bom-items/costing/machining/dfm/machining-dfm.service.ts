import { Injectable } from '@nestjs/common';
import { MachiningLookupService } from '../lookup/machining-lookup.service';
import { evaluateMachiningDfm, type MachiningDfmPart, type MachiningDfmResult } from './machining-dfm';

export interface MachiningDfmView {
  status: 'ok' | 'no_analysis';
  result: MachiningDfmResult | null;
  /** Why there is no result. */
  reasons: string[];
}

/** The machining variables the checks read their limits from. */
const DFM_VARIABLES = ['easyL2DRatio', 'maxMillingLToDRatio', 'difficultL2DRatio', 'imposedLowerToolDiameterLimitForMilling', 'delicatePartRatio', 'aspectRatioLimitRatio', 'pickWeight'] as const;

/**
 * The design-for-machining checks of an item's CAD analysis against the staged machining reference. Evaluated when
 * asked and not stored with the analysis, so a change to the reference limits is reflected at once.
 */
@Injectable()
export class MachiningDfmService {
  constructor(private readonly lookup: MachiningLookupService) {}

  async evaluate(req: { featureGraph: unknown; part: MachiningDfmPart }): Promise<MachiningDfmView> {
    const features = (req.featureGraph as { feature_graph_v2?: { features?: unknown } } | null)?.feature_graph_v2?.features;
    if (!Array.isArray(features) || features.length === 0) {
      return { status: 'no_analysis', result: null, reasons: ['The part has no machining features: run the CAD analysis first.'] };
    }
    const [sizeRanges, variables, drillSizesMm] = await Promise.all([
      this.lookup.getOperationSizeRanges(), this.lookup.getVariables(DFM_VARIABLES), this.lookup.getDrillSizesMm(),
    ]);
    return { status: 'ok', result: evaluateMachiningDfm(features, req.part, { sizeRanges, variables, drillSizesMm }), reasons: [] };
  }
}
