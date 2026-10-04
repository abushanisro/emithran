import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { resolveGdtCallouts } from '../costing/shared/physics/gdt-callouts';
import { CastingReferenceService } from '../costing/casting/casting-reference.service';
import { holeCastability, holeProximityCastability, type HoleCastability } from '../costing/casting/casting-reference';
import { castingProcessLabel, castingProcessOfFamily } from '../costing/casting/casting-cost-summary';
import { resolveScenarioDieCastingProcess } from '../costing/casting/die-casting-process-choice';
import { HPDC_PROCESS } from '../costing/casting/hpdc-engine';
import { GDC_PROCESS } from '../costing/casting/gdc-engine';
import { evaluateMachiningNeed, type MachiningNeedResult } from '../costing/shared/tolerance/machining-need';
import { ToleranceReferenceService } from '../costing/shared/tolerance/tolerance-reference.service';
import { GTOL_CATEGORIES, type GtolCategory } from '../costing/shared/tolerance/process-capability';
import {
  featureInstances,
  parseTolerancePolicy,
  resolveFeatureRequirements,
  type FeatureInstance,
  type ManualTolerance,
  type TolerancePolicy,
  type ToleranceResolution,
} from '../costing/shared/tolerance/feature-tolerances';

export interface FeatureTolerancesView extends ToleranceResolution {
  policy: TolerancePolicy;
  /** Set when the stored policy is not a valid shape; the default is used instead. */
  policyErrors: string[];
}

const isCategory = (c: string): c is GtolCategory => (GTOL_CATEGORIES as readonly string[]).includes(c);

/**
 * Per-feature required tolerances (feature_tolerances, migration 881) and the
 * item Tolerance Policy (scenario_overrides.tolerancePolicy), resolved by
 * feature-tolerances.ts against the item current feature graph.
 */
@Injectable()
export class FeatureToleranceService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly toleranceReference: ToleranceReferenceService,
    private readonly castingReference: CastingReferenceService,
  ) {}

  private async loadItem(id: string, accessToken: string) {
    const { data, error } = await this.supabase.getUserClient(accessToken)
      .from('bom_items')
      .select('id, organization_id, feature_graph, drawing_intelligence, scenario_overrides, family_classification, material_grade, material')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(`Failed to read BOM item: ${error.message}`);
    if (!data) throw new NotFoundException(`BOM item with ID ${id} not found`);
    return data as {
      id: string; organization_id: string | null; feature_graph: any;
      drawing_intelligence: unknown; scenario_overrides: Record<string, unknown> | null;
      family_classification: string | null; material_grade: string | null; material: string | null;
    };
  }

  private instancesOf(item: { feature_graph: any }) {
    const fg = item.feature_graph;
    return featureInstances(fg?.feature_graph_v2 ?? fg?.machining_features?.feature_graph_v2 ?? null);
  }

  async get(id: string, accessToken: string): Promise<FeatureTolerancesView> {
    const item = await this.loadItem(id, accessToken);
    const { data: rows, error } = await this.supabase.getUserClient(accessToken)
      .from('feature_tolerances')
      .select('feature_key, category, value')
      .eq('bom_item_id', id);
    if (error) throw new InternalServerErrorException(`Failed to read feature tolerances: ${error.message}`);
    const manual: ManualTolerance[] = (rows ?? [])
      .filter((r: any) => isCategory(r.category))
      .map((r: any) => ({ featureKey: r.feature_key, category: r.category, value: Number(r.value) }));
    const parsed = parseTolerancePolicy(item.scenario_overrides?.['tolerancePolicy']);
    const policy = parsed.policy ?? parseTolerancePolicy(null).policy!;
    return {
      ...resolveFeatureRequirements({
        instances: this.instancesOf(item),
        manual,
        policy,
        callouts: resolveGdtCallouts(item.feature_graph, item.drawing_intelligence),
      }),
      policy,
      policyErrors: parsed.errors,
    };
  }

  /** Set (number) or clear back to Auto (null) categories of one feature instance. */
  async setFeature(
    id: string,
    featureKey: string,
    values: Record<string, unknown>,
    accessToken: string,
  ): Promise<FeatureTolerancesView> {
    const item = await this.loadItem(id, accessToken);
    const instance = this.instancesOf(item).find((i) => i.key === featureKey);
    if (!instance) throw new BadRequestException(`No feature ${featureKey} on this item (re-analysed since?)`);
    const upserts: Array<{ category: GtolCategory; value: number }> = [];
    const clears: GtolCategory[] = [];
    const errors: string[] = [];
    for (const [category, v] of Object.entries(values ?? {})) {
      if (!isCategory(category)) errors.push(`unknown tolerance category "${category}"`);
      else if (v === null) clears.push(category);
      else if (typeof v === 'number' && Number.isFinite(v) && v > 0) upserts.push({ category, value: v });
      else errors.push(`${category} must be a positive number or null (Auto)`);
    }
    if (errors.length) throw new BadRequestException(errors.join('; '));

    const client = this.supabase.getUserClient(accessToken);
    if (upserts.length) {
      const { error } = await client.from('feature_tolerances').upsert(
        upserts.map((u) => ({
          bom_item_id: id, organization_id: item.organization_id, feature_key: featureKey,
          feature_type: instance.featureType, category: u.category, value: u.value, updated_at: new Date().toISOString(),
        })),
        { onConflict: 'bom_item_id,feature_key,category' },
      );
      if (error) throw new InternalServerErrorException(`Failed to save feature tolerances: ${error.message}`);
    }
    if (clears.length) {
      const { error } = await client.from('feature_tolerances').delete()
        .eq('bom_item_id', id).eq('feature_key', featureKey).in('category', clears);
      if (error) throw new InternalServerErrorException(`Failed to clear feature tolerances: ${error.message}`);
    }
    return this.get(id, accessToken);
  }

  /** Validate and store the item Tolerance Policy. */
  async setPolicy(id: string, raw: unknown, accessToken: string): Promise<FeatureTolerancesView> {
    const { policy, errors } = parseTolerancePolicy(raw);
    if (!policy) throw new BadRequestException(`Invalid tolerance policy: ${errors.join('; ')}`);
    const { error } = await this.supabase.getUserClient(accessToken)
      .rpc('merge_scenario_overrides', { p_id: id, p_patch: { tolerancePolicy: policy } })
      .single();
    if (error) {
      if (error.message?.includes('not found')) throw new NotFoundException(`BOM item with ID ${id} not found`);
      throw new InternalServerErrorException(`Failed to save tolerance policy: ${error.message}`);
    }
    return this.get(id, accessToken);
  }

  /**
   * Which features the part's primary process leaves short of their required
   * tolerances (or cannot form), and the machining operations that can finish
   * each (machining-need.ts). Primary process today: the casting processes,
   * whose names tblGtolProcessCapabilities carries; any other family is
   * reported as not yet assessed rather than guessed.
   */
  async getMachiningNeed(id: string, accessToken: string, primaryProcessOverride?: string): Promise<MachiningNeedView> {
    const item = await this.loadItem(id, accessToken);
    const tolerances = await this.get(id, accessToken);
    const family = item.feature_graph?.classification?.family ?? item.family_classification ?? 'unknown';
    const casting = castingProcessOfFamily(family);
    if (!casting) {
      return { assessed: false, reason: `No primary-process capability assessment for family ${family} yet.`, missing: [], result: null, instances: [] };
    }
    const { reference, missing } = await this.toleranceReference.get();
    if (!reference) return { assessed: false, reason: 'Tolerance reference data not staged.', missing, result: null, instances: [] };
    // The casting process the part is cast by: the caller's (the cost summary
    // prices HPDC and GDC each), else the Cost Guide die-casting process
    // choice, else the family's process.
    const familyProcess = castingProcessLabel(casting);
    const chosen = casting === 'die_casting'
      ? resolveScenarioDieCastingProcess(item.scenario_overrides, [HPDC_PROCESS, GDC_PROCESS])
      : null;
    const primaryProcess = primaryProcessOverride ?? chosen ?? familyProcess;

    // The grade the part is costed on: the same precedence as getCostSummary
    // (Material Grade, else the material picked at Create BOM).
    const grade = item.material_grade ?? item.material ?? null;
    const [{ reference: castRef, missing: castMissing }, alloy] = await Promise.all([
      this.castingReference.getReference(),
      this.castingReference.getMaterial(this.supabase.getUserClient(accessToken), grade),
    ]);
    const formabilityNote = !castRef
      ? `hole castability not assessed: ${castMissing.join(', ')}`
      : !alloy
        ? `hole castability not assessed: "${grade ?? '(no material)'}" is not a die-casting alloy`
        : null;

    // Other parallel holes, for the hole-to-hole wall check.
    const holes = tolerances.instances
      .map((i) => i.instance)
      .filter((i) => i.featureType === 'SimpleHole' && i.sizeMm != null && i.centroidMm && i.axis)
      .map((i) => ({ label: i.label, diameterMm: i.sizeMm!, centroidMm: i.centroidMm!, axis: i.axis! }));
    // Every check must pass: one failing = not castable; otherwise one
    // undecided = undecided, each with its reason.
    const all = (checks: HoleCastability[]) => ({
      formable: checks.some((c) => c.castable === false) ? false : checks.some((c) => c.castable === null) ? null : true,
      detail: checks.map((c) => c.detail).join('; '),
    } as const);

    const result = evaluateMachiningNeed({
      primaryProcess,
      features: tolerances.instances,
      ...reference,
      formability: ({ instance }) => {
        if (instance.featureType === 'SimpleHole' && instance.sizeMm != null) {
          if (formabilityNote) return { formable: null, detail: formabilityNote };
          const checks = [holeCastability(castRef!, primaryProcess, alloy!.materialType, instance.sizeMm, instance.depthMm)];
          checks.push(instance.centroidMm && instance.axis
            ? holeProximityCastability(castRef!, primaryProcess,
                { diameterMm: instance.sizeMm, centroidMm: instance.centroidMm, axis: instance.axis },
                holes.filter((h) => h.label !== instance.label))
            : { castable: null, detail: 'hole axis not measured (re-run analysis): hole-to-hole wall not checked' });
          return all(checks);
        }
        if (instance.featureType === 'MultiStepHole' && instance.steps?.length) {
          if (formabilityNote) return { formable: null, detail: formabilityNote };
          // A stepped core pin: every step must be castable on its own.
          return all(instance.steps.map((st) => {
            const c = holeCastability(castRef!, primaryProcess, alloy!.materialType, st.diameterMm, st.depthMm);
            return { ...c, detail: `step Ø${st.diameterMm}: ${c.detail}` } as HoleCastability;
          }));
        }
        return null;
      },
    });
    return { assessed: true, reason: null, missing: [], result, instances: tolerances.instances.map((i) => i.instance) };
  }
}

export interface MachiningNeedView {
  assessed: boolean;
  /** Why not assessed (family has no primary-process capability, data missing). */
  reason: string | null;
  missing: string[];
  result: MachiningNeedResult | null;
  /** The feature instances assessed (sizes, depths, extents, viewer refs). */
  instances: FeatureInstance[];
}
