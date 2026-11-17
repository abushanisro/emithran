import { Injectable } from '@nestjs/common';
import type { DbClient } from '../../../../../common/db/postgrest-client';
import { FeatureToleranceService } from '../../../services/feature-tolerance.service';
import { ForgingCostService } from '../forging-cost.service';
import { evaluateForgingDfm, type ForgingDfmHole, type ForgingDfmPart } from './forging-dfm';
import type { MachiningDfmResult } from '../../machining/dfm/machining-dfm';

export interface ForgingDfmView {
  status: 'ok' | 'no_analysis';
  result: MachiningDfmResult | null;
  reasons: string[];
}

type Graph = { summary?: Record<string, unknown>; feature_graph_v2?: { features?: unknown } } | null | undefined;
const num = (v: unknown): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/** The part's holes from its forging analysis (feature_graph_v2 hole features, one occurrence each). */
function holesOf(features: unknown): ForgingDfmHole[] {
  if (!Array.isArray(features)) return [];
  return (features as Array<Record<string, any>>).filter((f) => f?.feature_type === 'SimpleHole' && typeof f.id === 'string').flatMap((f) =>
    (Array.isArray(f.occurrences) ? f.occurrences : []).flatMap((o: Record<string, any>, occurrenceIndex: number) => {
      const diameterMm = num(o?.diameter_mm);
      return diameterMm && diameterMm > 0 ? [{
        featureId: f.id as string, occurrenceIndex, diameterMm, depthMm: num(o?.depth_mm), variant: String(f.variant ?? ''),
        angleToDieDeg: num(o?.angle_to_die_deg), faces: Array.isArray(o?.face_ids) ? (o.face_ids as number[]) : [],
      }] : [];
    }));
}

/**
 * The design-for-forging checks of a forged part (forging-dfm.ts) against the forging reference data, its material's type and the
 * tolerances it is asked to hold. Evaluated when asked and not stored with the analysis, so a change to the reference is reflected at once.
 */
@Injectable()
export class ForgingDfmService {
  constructor(private readonly forging: ForgingCostService, private readonly tolerances: FeatureToleranceService) {}

  async evaluate(req: { id: string; accessToken: string; client: DbClient; featureGraph: unknown; grade: string | null; threads: number }): Promise<ForgingDfmView> {
    const graph = req.featureGraph as Graph;
    const s = graph?.summary ?? {};
    if (s['forgingExtractionVersion'] == null && s['forgingProjectedAreaMm2'] == null) {
      return { status: 'no_analysis', result: null, reasons: ['The part has no forging analysis: set its Process to Forging and use Refresh analysis.'] };
    }
    const [{ reference }, material, need] = await Promise.all([
      this.forging.reference(),
      this.forging.getMaterial(req.client, req.grade),
      this.tolerances.getMachiningNeed(req.id, req.accessToken, 'Forging', 'forged'),
    ]);
    const severity = reference?.table('forging_manufacturabilitySeverity') ?? [];
    const advice = reference?.table('forging_adviceRules') ?? [];
    const part: ForgingDfmPart = {
      materialType: material?.materialType ?? null,
      projectedAreaMm2: num(s['forgingProjectedAreaMm2']),
      draftFaces: (s['forgingDraftFaces'] as ForgingDfmPart['draftFaces']) ?? null,
      thicknessFaces: (s['forgingThicknessFaces'] as ForgingDfmPart['thicknessFaces']) ?? null,
      radii: (s['forgingRadii'] as ForgingDfmPart['radii']) ?? null,
      sharpEdges: (s['forgingSharpEdges'] as ForgingDfmPart['sharpEdges']) ?? null,
      undercutAreaMm2: num(s['forgingUndercutAreaMm2']),
      trappedVolumes: num(s['forgingTrappedVolumeCount']),
      holes: holesOf(graph?.feature_graph_v2?.features),
      threads: req.threads,
      tolerances: need.assessed && need.result
        ? { assessed: true, short: need.result.features.filter((f) => f.shortCategories.length > 0).map((f) => ({ featureId: f.featureId, occurrenceIndex: f.occurrenceIndex, label: f.label, faces: f.faceIds, categories: f.shortCategories })) }
        : { assessed: false, reason: need.reason ?? 'The tolerances are not assessed for this part.' },
    };
    return {
      status: 'ok', reasons: [],
      result: evaluateForgingDfm(part, {
        severity,
        enabledRules: advice.length ? new Set(advice.filter((r) => String(r['Enabled']).toLowerCase() === 'true').map((r) => String(r['Advice Rule Name']))) : null,
        variables: { minForgeableHoleDiameter: reference?.number('minForgeableHoleDiameter') ?? null },
      }),
    };
  }
}
