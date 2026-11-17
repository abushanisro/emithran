import { Injectable } from '@nestjs/common';
import { MachiningLookupService } from '../lookup/machining-lookup.service';
import { detectMaterialClass } from '../process/cost-machining-engine';
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
/**
 * Why a part's analysis has no tool access, corner or wall measurements. The machining analysis measures them (machining/feature_access.py), so a
 * machining analysis without them is older than the measurement. The analysis of another process measures what that process needs (a forging
 * or powder metal part along its die direction, a casting its walls for the casting checks) and never these: Refresh analysis would not add them.
 */
export function unmeasuredReasonOf(family: unknown): string {
  const other: Record<string, string> = {
    forged: 'forging', powder_metal: 'powder metal', die_cast: 'casting', sand_cast: 'casting', investment_cast: 'casting',
    sheet_metal: 'sheet metal', plastic_molded: 'plastic molding',
  };
  const process = typeof family === 'string' ? other[family] : undefined;
  return process
    ? `Not measured: the ${process} analysis does not measure tool access, inside corners or walls behind features (they are measured for machined parts).`
    : 'This analysis is from before the measurement: use Refresh analysis.';
}

@Injectable()
export class MachiningDfmService {
  constructor(private readonly lookup: MachiningLookupService) {}

  async evaluate(req: { featureGraph: unknown; grade: string | null; part: Omit<MachiningDfmPart, 'accessMeasured' | 'unmeasuredReason'> }): Promise<MachiningDfmView> {
    const fg = req.featureGraph as { feature_graph_v2?: { features?: unknown; metadata?: { feature_access?: unknown } }; classification?: { family?: unknown } } | null;
    const graph = fg?.feature_graph_v2;
    const features = graph?.features;
    if (!Array.isArray(features) || features.length === 0) {
      return { status: 'no_analysis', result: null, reasons: ['The part has no machining features: run the CAD analysis first.'] };
    }
    const [sizeRanges, variables, drillSizesMm, setup, minWall] = await Promise.all([
      this.lookup.getOperationSizeRanges(), this.lookup.getVariables(DFM_VARIABLES), this.lookup.getDrillSizesMm(),
      this.lookup.getSetupAxisRule(), this.lookup.getMachiningMinWall(detectMaterialClass(req.grade)),
    ]);
    const part = { ...req.part, accessMeasured: graph?.metadata?.feature_access === true, unmeasuredReason: unmeasuredReasonOf(fg?.classification?.family) };
    return { status: 'ok', result: evaluateMachiningDfm(features, part, { sizeRanges, variables, drillSizesMm, setupRule: setup.rule, minWall }), reasons: [] };
  }
}
