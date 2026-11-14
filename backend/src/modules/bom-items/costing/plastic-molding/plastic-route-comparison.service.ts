import { electricityUsd, loadLocationElectricity } from '../shared/location-electricity';
import { Injectable } from '@nestjs/common';

import { CalculatorFieldOverridesService, overridesByCalculator } from '../../services/calculator-field-overrides.service';
import { DatabaseService } from '../../../../common/database/database.service';
import type { RateSnapshot } from '../../../../common/exchange-rate/exchange-rate.service';
import type { BOMItemResponseDto } from '../../dto/bom-item-response.dto';
import type { RouteResultDto } from '../../dto/route-comparison.dto';
import type { RateResolutionService } from '../../services/rate-resolution.service';
import type { MaterialResolutionService } from '../../services/material-resolution.service';
import { CalculatorCatalogService } from '../../services/calculator-catalog.service';
import { PlasticReferenceService } from './lookup/plastic-reference.service';
import { injectionMoldabilityGap } from '../../../raw-materials/material-moldability';
import { buildMoldingCommonInput, cadFaceCount, partBboxLongestFirst, type MoldingSummary } from './molding-input';
import { estimatedToolHeightMm } from '../shared/capability/machine-selection/press-checks';
import { mhrRateFromCandidate } from '../shared/capability/machine-selection/rate-from-candidate';
import { fetchMachinePool } from '../shared/capability/machine-selection/selector';
import { MATERIAL_OVERHEAD_PCT, RATES_SOURCE_LABEL } from '../shared/core/default-rates.constants';
import { findRouteDataGaps } from '../shared/core/engine-kernel';
import { resolveScenarioCavityCount } from '../shared/physics/scenario-overrides';
import { undercutCountFromDraftSummary, type DraftSummary } from './draft-signals';
import { selectIMmachinesByTier, type IMSelectionRequirements } from './machine/machine-selector-im';
import { computeCompressionMoldingCost } from './process/cost-compression-molding-engine';
import { computeInjectionMoldedCostSummary, type InjectionMoldingCostInput } from './process/cost-injection-molding-engine';
import { computeReactionInjectionMoldingCost } from './process/cost-reaction-injection-molding-engine';
import { processCompatibilityGap, type MoldingProcess } from './process-compatibility';
import { shotGppsGramsPerCavity, shotWeightKgPerPart } from './shot-size';
import { sideActionSignals } from './side-action-signals';
import type { PlasticFeatureGraph } from './operation/plastic-catalog-operations.service';

type ResolvedMaterial = Awaited<ReturnType<MaterialResolutionService['resolveMaterialForFamily']>>;
type ResolvedRates = Awaited<ReturnType<RateResolutionService['resolveMHRRates']>>;

const r2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * What the plastic route comparison reads, stated once. Everything here is already resolved by the caller (the part, its material, the rates, the
 * scenario); the comparison itself reads the press pool and the plastic reference data, prices each route, and returns the routes.
 */
export interface PlasticComparisonInput {
  item: BOMItemResponseDto;
  /** The feature graph's summary: wall thickness, ribs, undercuts, the plastic feature graph. */
  summary: MoldingSummary;
  grade: string | null;
  material: ResolvedMaterial;
  mhrRates: ResolvedRates;
  rates: RateSnapshot;
  location: string;
  locationInfo: { code: string; symbol: string };
  batchSize: number;
  annualVolume: number | null;
  productionLifeYears: number;
  accessToken: string;
  /** Warnings gathered so far; the result carries them on, with this comparison's added. */
  comparisonWarnings: readonly string[];
}

export interface PlasticComparison {
  routes: RouteResultDto[];
  comparisonWarnings: string[];
  materialNote: ReturnType<typeof injectionMoldabilityGap>;
  /** The standard press's material cost (the comparison's material cost), the gross weight and the material rate. */
  materialCost: number;
  grossWeightKg: number;
}

/**
 * The Lowest cost and Fastest badges of the molding routes, over the routes that are physically capable and not confirmed incompatible (a route whose process
 * cannot make a feature of the part is never presented as the best). Idempotent: it clears both badges first, so it can run again once compatibility is known
 * (bom-items.service attaches it after the catalog operations), and a badge can never name a route the recommendation excludes.
 * No bestQuality badge for molding routes: the reference data gives no quality measure between presses (the former clamp-utilization sweet spot and score were invented).
 */
export function assignMoldingRouteBadges(routes: RouteResultDto[]): void {
  for (const r of routes) { r.badges.lowestCost = false; r.badges.fastest = false; }
  const capableRoutes = routes.filter((r) => r.capability.overallCapable && r.compatibility?.status !== 'incompatible');
  if (capableRoutes.length === 0) return;
  const feasibleRoutes = capableRoutes.filter((r) => r.isFeasible && r.totalCost != null);
  if (feasibleRoutes.length > 0) {
    const minFeasibleCost = Math.min(...feasibleRoutes.map((r) => r.totalCost!));
    feasibleRoutes.forEach((r) => { r.badges.lowestCost = r.totalCost === minFeasibleCost; });
  }
  capableRoutes.reduce((a, b) => a.cycleTimes.totalMin < b.cycleTimes.totalMin ? a : b).badges.fastest = true;
}

@Injectable()
export class PlasticRouteComparisonService {
  constructor(
    private readonly database: DatabaseService,
    private readonly plasticReference: PlasticReferenceService,
    private readonly calculatorCatalog: CalculatorCatalogService,
  ) {}

  async compare(input: PlasticComparisonInput): Promise<PlasticComparison> {
    const { item, summary, grade, mhrRates, rates, location, batchSize, annualVolume, productionLifeYears, accessToken } = input;
    const locInfo = input.locationInfo;
    const comparisonWarnings = [...input.comparisonWarnings];
    const {
      materialCostPerKg, materialDensityKgM3, materialSource, cureTimeMinFromMaterial: rcCureTimeMinFromMaterial, materialType: rcMaterialType,
      stockForm: rcStockForm, matlState: rcMatlState, clampProperties: rcClampProperties, densityOfMeltKgM3: rcDensityOfMeltKgM3,
    } = input.material;
    const family = 'plastic_molded';
    // The stored cycle-time calculators (migration 975): every molding route's cycle time is computed by its own process's calculator.
    const calculators = await this.calculatorCatalog.loadPlasticMoldingCalculators(accessToken);
    // The part's own calculator field values, laid over the calculators by each engine (migration 1011).
    const calculatorOverrides = overridesByCalculator(await CalculatorFieldOverridesService.rows(this.database.getClient(accessToken), item.id));
    // The real per-grade thermal inputs, from the same resolved material row as the cost per kg and density.
    const rcRealResinInputs = {
      meltingTempC: input.material.meltingTempC, moldTempC: input.material.moldTempC, ejectionTempC: input.material.ejectionTempC,
      specificHeatMeltJgC: input.material.specificHeatMeltJgC, thermalConductivityMeltWMK: input.material.thermalConductivityMeltWMK,
      densityOfMeltKgM3: rcDensityOfMeltKgM3,
    };
    const client = this.database.getClient(accessToken);
    const imBboxRC = partBboxLongestFirst(item);
    const projectedAreaMm2 = imBboxRC[0] * imBboxRC[1] > 0 ? imBboxRC[0] * imBboxRC[1] : null;
    const partVolumeMm3 = (item.volume ?? 0) as number;

    const plasticRefSet = await this.plasticReference.getReference();
    const plasticRef = plasticRefSet.reference;
    // Presses are pre-selected on a single-cavity basis (cavities depend on the
    // press); each tier's engine run then sizes cavities against its real press.
    const imReq: Omit<IMSelectionRequirements, 'clampModel'> = {
      projectedAreaMm2,
      cavityCount: 1,
      // Same shot rule the engine uses (shot-size.ts), cold runner, one cavity.
      shotGppsGPerCavity: shotGppsGramsPerCavity({
        shotWeightKg: shotWeightKgPerPart((partVolumeMm3 / 1e9) * materialDensityKgM3, 'cold'),
        meltDensityKgM3: rcDensityOfMeltKgM3,
        reference: plasticRef,
      }),
      material: rcClampProperties,
      materialLabel: grade ?? 'this material',
      runner: 'cold',
      partLengthMm: imBboxRC[0] > 0 ? imBboxRC[0] : null,  // largest bbox dim
      partWidthMm: imBboxRC[1] > 0 ? imBboxRC[1] : null,
      partHeightMm: imBboxRC[2] > 0 ? imBboxRC[2] : null,
      estimatedToolHeightMm: estimatedToolHeightMm(imBboxRC[0]),
    };

    // Fetch machine pool and run tier-based 4-constraint selection.
    // Each tier (Small ≤120T / Standard 121–350T / Large 351T+) picks the best
    // real HR Rates press in range. A tier with no real press — or whose press
    // has no real clamp/shot capacity on file — is NOT offered: there is no
    // synthetic press, rate multiplier or stand-in clamp/shot spec.
    const pool = await fetchMachinePool(client, location);
    if (!plasticRef) {
      comparisonWarnings.push(`Injection presses not evaluated: Plastic reference data missing (${plasticRefSet.missing.join('; ')}).`);
    }
    const tiers = (plasticRef ? selectIMmachinesByTier(pool, {
      ...imReq,
      clampModel: plasticRef.clampModel,
    }) : []);
    const sfmCandidate = mhrRates.structuralFoamMolding.selection?.balanced?.candidate;
    const rimCandidate = mhrRates.reactionInjectionMolding.selection?.balanced?.candidate;
    const compressionCandidate = mhrRates.compressionMolding.selection?.balanced?.candidate;
    const pressRecordsRC = await this.plasticReference.getPressRecords(
      client,
      [...tiers.flatMap((t) => t.candidates.map((e) => e.candidate.machineId ?? '')), sfmCandidate?.machineId ?? '', rimCandidate?.machineId ?? '', compressionCandidate?.machineId ?? ''],
    );
    const rcUsdToLocal = locInfo.code === 'USD' ? 1 : rates.convertStrict('USD', locInfo.code);
    const imCommon = buildMoldingCommonInput({
      item, summary, cadFaceCount: cadFaceCount((item as { featureGraph?: unknown }).featureGraph), grade, family, location, batchSize, annualVolume, productionLifeYears,
      material: {
        materialCostPerKg, materialDensityKgM3, materialSource, materialType: rcMaterialType, materialStockForm: rcStockForm,
        materialMatlState: rcMatlState, materialClamp: rcClampProperties, realResinInputs: rcRealResinInputs,
        materialRecord: input.material.materialRecord,
      },
      plasticReference: { plasticReference: plasticRef, plasticReferenceMissing: plasticRefSet.missing },
      electricity: electricityUsd(await loadLocationElectricity(client, location), location,
        (value, currency) => { try { return value * rates.convertStrict(currency, 'USD'); } catch { return null; } }),
      calculators, calculatorOverrides,
      currencySymbol: locInfo.symbol, usdToLocal: rcUsdToLocal,
      deburrRate: mhrRates.deburring, inspectionRate: mhrRates.inspection,
      cavityCountOverride: resolveScenarioCavityCount(item.scenarioOverrides),
    });
    // What is wrong with the material itself is said once, on the comparison (materialNote), not again on every press tier.
    const materialNote = injectionMoldabilityGap({
      grade, stockForm: rcStockForm, matlState: rcMatlState,
      injectionPressureMaxMpa: rcClampProperties?.injectionPressureMaxMpa ?? null,
      flowLengthRatio: rcClampProperties?.flowLengthRatio ?? null,
      meltingTempC: rcRealResinInputs?.meltingTempC ?? null,
      moldTempC: rcRealResinInputs?.moldTempC ?? null,
      densityOfMeltKgM3: rcRealResinInputs?.densityOfMeltKgM3 ?? null,
      cureTimeMin: null,
    });
    // Each tier offers the press with the lowest cost per part among its
    // capable real presses, costed by the engine itself: no utilization sweet
    // spot or score weights (the mold is the same whichever press runs it). A
    // tier with no capable press shows its largest press as not feasible, with
    // the reasons.
    const realTiers = tiers.flatMap((tier) => {
      const real = tier.candidates.filter((e) => e.candidate.machineId && e.candidate.capability.maxTonnage != null && e.candidate.capability.shotCapacityGrams != null);
      if (real.length === 0) {
        comparisonWarnings.push(`No ${tier.tierLabel} injection press with clamp tonnage and shot size in HR Rates for ${location} — that size is not offered.`);
        return [];
      }
      const capablePresses = real.filter((e) => e.capable);
      const costed = (capablePresses.length > 0 ? capablePresses : [real[0]!]).map((ev) => {
        const cand = ev.candidate;
        const cost = computeInjectionMoldedCostSummary({
          ...imCommon,
          mhrRate: mhrRateFromCandidate(cand, 'injection_molding', rcUsdToLocal),
          machineClampTonnes: cand.capability.maxTonnage, machineShotCapacityG: cand.capability.shotCapacityGrams,
          pressTiming: cand.machineId ? pressRecordsRC.get(cand.machineId) ?? null : null,
          goodPartYield: cand.machineId ? pressRecordsRC.get(cand.machineId)?.goodPartYield ?? null : null,
        });
        const complete = cost.processLines.every((l) => !l.physicsGap);
        return { tier, ev, cost, complete };
      });
      costed.sort((a, b) => (a.complete !== b.complete ? (a.complete ? -1 : 1) : a.cost.totalCost - b.cost.totalCost));
      return [costed[0]!];
    });

    const TIER_ROUTE_IDS: Record<string, 'im-small-50t' | 'im-standard-200t' | 'im-large-500t'> = {
      small:  'im-small-50t',
      medium: 'im-standard-200t',
      large:  'im-large-500t',
    };

    const imRoutes: RouteResultDto[] = realTiers.map(({ tier, ev, cost }) => {
      const cand = ev.candidate;
      cost.warnings.push(...comparisonWarnings);
      // With a material gap, the press-level "not derivable" reasons are that same gap repeated: the note carries it.
      const repeatsMaterialGap = (r: string) => materialNote != null && /^(Clamp force|Shot size) not derivable/.test(r);
      const tierReasons = ev.blockReasons.filter((r) => !repeatsMaterialGap(r));
      if (!ev.capable) cost.warnings.push(...tierReasons.map((r) => `⚠ ${r}`));

      const capable = ev.capable;
      const routeLabel = `${tier.tierLabel} — ${cand.machineName}`;

      return {
        routeId: TIER_ROUTE_IDS[tier.tierId]!,
        routeLabel,
        processFamily: 'cutting',
        toolingVolumeNote: null,
        autoRoutable: true, // cutting-family route: always eligible, as before
        processLines: cost.processLines, materialCost: cost.materialCost, abrasiveCost: 0,
        totalProcessCost: cost.totalProcessCost,
        isFeasible: capable,
        dataComplete: findRouteDataGaps(cost.processLines).length === 0,
        dataGaps: findRouteDataGaps(cost.processLines),
        totalCost: capable ? cost.totalCost : null,
        cycleTimes: {
          cuttingMin: cost.cycleTimes.laserMin, pressBrakeMin: cost.cycleTimes.pressBrakeMin,
          tappingMin: cost.cycleTimes.tappingMin, deburrMin: cost.cycleTimes.deburrMin,
          totalMin: cost.cycleTimes.totalMin,
        },
        badges: { lowestCost: false, fastest: false, bestQuality: false },
        capability: {
          cuttingCapable: capable, pressBrakeCapable: capable, overallCapable: capable,
          confidence: cand.capabilitySource === 'imported' ? 'high' : 'medium',
          estimatedTonnage: cand.capability.maxTonnage,
          reasonCodes: capable ? [] : ['DIMENSIONS_UNAVAILABLE' as const],
          warnings: tierReasons,
        },
        warnings: cost.warnings, ratesSource: cost.ratesSource,
        sustainability: cost.sustainability ? {
          totalCo2Kg: cost.sustainability.totalCo2Kg,
          totalProcessEnergyKwh: cost.sustainability.totalProcessEnergyKwh,
          wasteCostInr: cost.sustainability.wasteCostInr,
          sustainabilityScore: cost.sustainability.sustainabilityScore,
        } : undefined,
        // Real per-part clamp/shot sizing behind this tier — the same
        // evaluateIMCandidate() numbers that decided capability/scoring
        // above, now exposed so the frontend can show the actual tonnage
        // math instead of just the pass/fail badge.
        injectionMolding: {
          clampRequiredT: ev.clampRequiredT ?? null,
          clampMachineT: ev.clampMachineT,
          clampUtilPct: ev.clampUtil != null ? Math.round(ev.clampUtil * 1000) / 10 : null,
          shotRequiredG: ev.shotRequiredG ?? null,
          shotMachineG: ev.shotMachineG ?? null,
          shotUtilPct: ev.shotUtil != null ? Math.round(ev.shotUtil * 1000) / 10 : null,
          cavityCount: cost.injectionMolding?.cavityCount ?? 1,
          gateType: cost.injectionMolding?.gateType ?? 'edge',
          machineDataSource: 'imported',
        },
      } satisfies RouteResultDto;
    });

    // Real, distinct manufacturing PROCESSES (not IMM size tiers) — added
    // as additional candidate routes so a real user can see and compare
    // them, closing the process-duplicate-audit finding (2026-09-02) that
    // these two previously had no route through which a real quote could
    // ever reflect their own real machine class. Deliberately NOT folded
    // into the tier-comparison scoring above (bestQuality's clamp-
    // utilization sweet-spot logic is injection-molding-specific and
    // meaningless for a compression press) — only pushed into the flat
    // route list so lowestCost/fastest badges (computed generically below
    // over the whole array) correctly consider them too.
    const netWeightKgRC = (Math.max(partVolumeMm3, 0) / 1e9) * materialDensityKgM3;
    const compressionMaterialCost = r2(netWeightKgRC * materialCostPerKg);
    const compressionResult = computeCompressionMoldingCost({
      batchSize,
      partWeightKg: netWeightKgRC > 0 ? netWeightKgRC : undefined,
      rate: mhrRates.compressionMolding,
      // Real per-grade cure_time_min — same resolved material row as
      // materialCostPerKg above (rcCureTimeMinFromMaterial, Phase 1).
      cureTimeMinFromMaterial: rcCureTimeMinFromMaterial,
      // The press's HR Rates record, for its open/close time's source (the rate itself comes from the same record through the rate resolver).
      machineRecord: compressionCandidate?.machineId ? pressRecordsRC.get(compressionCandidate.machineId)?.record ?? null : null,
      materialRecord: input.material.materialRecord,
      calculators, calculatorOverrides,
    });
    // A route is a real alternative only on a material the dataset flags for that process, and only where a real machine rate resolved.
    const processCompat = await this.plasticReference.getProcessCompatibility(client, grade);
    const compatGap = (process: MoldingProcess) => processCompatibilityGap(processCompat, process, grade);
    const compressionGap = compatGap('compression');
    const compressionCapable = mhrRates.compressionMolding.source === 'mhr_database' && compressionGap == null;
    imRoutes.push({
      routeId: 'im-compression-molding',
      routeLabel: mhrRates.compressionMolding.machineName
        ? `Compression Molding — ${mhrRates.compressionMolding.machineName}`
        : 'Compression Molding',
      processFamily: 'cutting',
      toolingVolumeNote: null,
      autoRoutable: true, // cutting-family route: always eligible, as before
      processLines: compressionResult.processLines, materialCost: compressionMaterialCost, abrasiveCost: 0,
      totalProcessCost: r2(compressionResult.processLines.reduce((s, l) => s + l.totalCost, 0)),
      isFeasible: compressionCapable,
      dataComplete: findRouteDataGaps(compressionResult.processLines).length === 0,
      dataGaps: findRouteDataGaps(compressionResult.processLines),
      totalCost: compressionCapable ? r2(compressionMaterialCost + compressionResult.processLines.reduce((s, l) => s + l.totalCost, 0)) : null,
      cycleTimes: {
        cuttingMin: 0, pressBrakeMin: r2(compressionResult.cuttingMin), tappingMin: 0, deburrMin: 0,
        totalMin: r2(compressionResult.cuttingMin),
      },
      badges: { lowestCost: false, fastest: false, bestQuality: false },
      capability: {
        cuttingCapable: compressionCapable, pressBrakeCapable: compressionCapable, overallCapable: compressionCapable,
        confidence: compressionCapable ? 'medium' : 'low',
        estimatedTonnage: null,
        reasonCodes: compressionCapable ? [] : [compressionGap ? 'MATERIAL_NOT_COMPATIBLE' as any : 'NO_REAL_MACHINE_RATE' as any],
        warnings: compressionCapable ? [] : [compressionGap ?? 'No real compression_molding machine rate resolved for this location'],
      },
      warnings: [...compressionResult.warnings, ...comparisonWarnings], ratesSource: RATES_SOURCE_LABEL,
    } satisfies RouteResultDto);

    const rimResult = computeReactionInjectionMoldingCost({
      batchSize,
      partWeightKg: netWeightKgRC > 0 ? netWeightKgRC : undefined,
      rate: mhrRates.reactionInjectionMolding,
      // Real per-grade cure/reaction time — same resolved material row as
      // materialCostPerKg above (rcCureTimeMinFromMaterial, Phase 1).
      cureTimeMinFromMaterial: rcCureTimeMinFromMaterial,
      // The fill time is the CAD part volume (mm3) over the selected machine's staged injection rate (mm3/s): formula registry F-19.
      partVolumeMm3: partVolumeMm3 > 0 ? partVolumeMm3 : null,
      injectionRateMm3PerS: rimCandidate?.machineId ? pressRecordsRC.get(rimCandidate.machineId)?.injectionRateMm3PerS ?? null : null,
      machineRecord: rimCandidate?.machineId ? pressRecordsRC.get(rimCandidate.machineId)?.record ?? null : null,
      materialRecord: input.material.materialRecord,
      calculators, calculatorOverrides,
    });
    const rimGap = compatGap('reaction_injection');
    const rimCapable = mhrRates.reactionInjectionMolding.source === 'mhr_database' && rimGap == null;
    imRoutes.push({
      routeId: 'im-reaction-injection-molding',
      routeLabel: mhrRates.reactionInjectionMolding.machineName
        ? `Reaction Injection Molding — ${mhrRates.reactionInjectionMolding.machineName}`
        : 'Reaction Injection Molding',
      processFamily: 'cutting',
      toolingVolumeNote: null,
      autoRoutable: true, // cutting-family route: always eligible, as before
      processLines: rimResult.processLines, materialCost: compressionMaterialCost, abrasiveCost: 0,
      totalProcessCost: r2(rimResult.processLines.reduce((s, l) => s + l.totalCost, 0)),
      isFeasible: rimCapable,
      dataComplete: findRouteDataGaps(rimResult.processLines).length === 0,
      dataGaps: findRouteDataGaps(rimResult.processLines),
      totalCost: rimCapable ? r2(compressionMaterialCost + rimResult.processLines.reduce((s, l) => s + l.totalCost, 0)) : null,
      cycleTimes: {
        cuttingMin: 0, pressBrakeMin: r2(rimResult.cuttingMin), tappingMin: 0, deburrMin: 0,
        totalMin: r2(rimResult.cuttingMin),
      },
      badges: { lowestCost: false, fastest: false, bestQuality: false },
      capability: {
        cuttingCapable: rimCapable, pressBrakeCapable: rimCapable, overallCapable: rimCapable,
        confidence: rimCapable ? 'medium' : 'low',
        // Real per-machine clamp tonnage now that RIM's identical-schema
        // machines are gated by the same injectionMoldingRequirement()
        // physics as Injection Molding (buildPartRequirements) — see that
        // function's comment on why RIM reuses the IM clamp formula as-is.
        estimatedTonnage: mhrRates.reactionInjectionMolding.selection?.balanced?.candidate?.capability?.maxTonnage ?? null,
        reasonCodes: rimCapable ? [] : [rimGap ? 'MATERIAL_NOT_COMPATIBLE' as any : 'NO_REAL_MACHINE_RATE' as any],
        // Real reason from selectMachine() — distinguishes "no machine of
        // this class exists" from "real machines exist but none fit this
        // part's clamp/footprint requirement", now that RIM is capability-
        // gated instead of always-generic.
        warnings: rimCapable ? [] : [
          rimGap ?? mhrRates.reactionInjectionMolding.selection?.balanced?.reasons?.[0]
            ?? 'No real reaction_injection_molding machine rate resolved for this location',
        ],
      },
      warnings: [...rimResult.warnings, ...comparisonWarnings], ratesSource: RATES_SOURCE_LABEL,
    } satisfies RouteResultDto);

    const structuralFoamInput: InjectionMoldingCostInput = {
      ...imCommon,
      mhrRate: mhrRates.structuralFoamMolding,
      machineClampTonnes: sfmCandidate?.capability?.maxTonnage ?? null,
      machineShotCapacityG: sfmCandidate?.capability?.shotCapacityGrams ?? null,
      pressTiming: sfmCandidate?.machineId ? pressRecordsRC.get(sfmCandidate.machineId) ?? null : null,
      goodPartYield: sfmCandidate?.machineId ? pressRecordsRC.get(sfmCandidate.machineId)?.goodPartYield ?? null : null,
    };
    const structuralFoamCost = computeInjectionMoldedCostSummary(structuralFoamInput);
    structuralFoamCost.warnings.push(...comparisonWarnings);
    const foamGap = compatGap('injection_or_foam');
    const structuralFoamCapable = mhrRates.structuralFoamMolding.source === 'mhr_database' && foamGap == null;
    imRoutes.push({
      routeId: 'im-structural-foam-molding',
      routeLabel: mhrRates.structuralFoamMolding.machineName
        ? `Structural Foam Molding — ${mhrRates.structuralFoamMolding.machineName}`
        : 'Structural Foam Molding',
      processFamily: 'cutting',
      toolingVolumeNote: null,
      autoRoutable: true, // cutting-family route: always eligible, as before
      processLines: structuralFoamCost.processLines, materialCost: structuralFoamCost.materialCost, abrasiveCost: 0,
      totalProcessCost: structuralFoamCost.totalProcessCost,
      isFeasible: structuralFoamCapable,
      dataComplete: findRouteDataGaps(structuralFoamCost.processLines).length === 0,
      dataGaps: findRouteDataGaps(structuralFoamCost.processLines),
      totalCost: structuralFoamCapable ? structuralFoamCost.totalCost : null,
      cycleTimes: {
        cuttingMin: structuralFoamCost.cycleTimes.laserMin, pressBrakeMin: structuralFoamCost.cycleTimes.pressBrakeMin,
        tappingMin: structuralFoamCost.cycleTimes.tappingMin, deburrMin: structuralFoamCost.cycleTimes.deburrMin,
        totalMin: structuralFoamCost.cycleTimes.totalMin,
      },
      badges: { lowestCost: false, fastest: false, bestQuality: false },
      capability: {
        cuttingCapable: structuralFoamCapable, pressBrakeCapable: structuralFoamCapable, overallCapable: structuralFoamCapable,
        confidence: structuralFoamCapable ? 'medium' : 'low',
        // Real per-machine clamp tonnage now that Structural Foam Molding's
        // identical-schema machines are gated by the same
        // injectionMoldingRequirement() physics as Injection Molding
        // (buildPartRequirements) — see that function's comment.
        estimatedTonnage: mhrRates.structuralFoamMolding.selection?.balanced?.candidate?.capability?.maxTonnage ?? null,
        reasonCodes: structuralFoamCapable ? [] : [foamGap ? 'MATERIAL_NOT_COMPATIBLE' as any : 'NO_REAL_MACHINE_RATE' as any],
        warnings: structuralFoamCapable ? [] : [
          foamGap ?? mhrRates.structuralFoamMolding.selection?.balanced?.reasons?.[0]
            ?? 'No real structural_foam_molding machine rate resolved for this location',
        ],
      },
      warnings: structuralFoamCost.warnings, ratesSource: structuralFoamCost.ratesSource,
      ...(structuralFoamCost.tooling ? { tooling: structuralFoamCost.tooling } : {}),
      sustainability: structuralFoamCost.sustainability ? {
        totalCo2Kg: structuralFoamCost.sustainability.totalCo2Kg,
        totalProcessEnergyKwh: structuralFoamCost.sustainability.totalProcessEnergyKwh,
        wasteCostInr: structuralFoamCost.sustainability.wasteCostInr,
        sustainabilityScore: structuralFoamCost.sustainability.sustainabilityScore,
      } : undefined,
    } satisfies RouteResultDto);

    assignMoldingRouteBadges(imRoutes);

    const imGrossKg = (partVolumeMm3 / 1e9) * materialDensityKgM3 * (1 + MATERIAL_OVERHEAD_PCT / 100);

    const imGrossKgOut = imGrossKg;
    const medRoute = imRoutes.find((r) => r.routeId === 'im-standard-200t') ?? imRoutes[0];
    return { routes: imRoutes, comparisonWarnings, materialNote, materialCost: medRoute?.materialCost ?? 0, grossWeightKg: imGrossKgOut };
  }
}
