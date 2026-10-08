import { Injectable, Logger, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { StepConverterService } from './step-converter.service';
import { SheetMetalFeatureExtractorService } from './sheet-metal-feature-extractor.service';
import axios from 'axios';
import * as path from 'path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AutoFillResponseDto,
  AutoFillGeometryDto,
  AutoFillSuggestionsDto,
} from '../dto/auto-fill.dto';
import { DrawingIntelligenceDto } from '../dto/drawing-intelligence.dto';

// Bumped whenever drawing-intelligence.dto.ts's expected shape changes, so a
// stored drawing_intelligence row can be told apart from one written under a
// future, differently-shaped parser response.
const DRAWING_PARSER_VERSION = 'v1';
import { machiningRouteFamilyOf, resolveCanonicalOperation } from '../costing/machining/process/canonical-operation';
import { REFERENCE_FEATURE_OPERATIONS } from '../costing/shared/reference-features.generated';
import { MachiningLookupService } from '../costing/machining/lookup/machining-lookup.service';
import { requiredMilledClassFromToolAxes } from '../costing/machining/setup-axis-rule';
import { machiningFeatureCounts } from '../costing/machining/operation/machining-feature-counts';

export interface RawGeometry {
  volume: number;
  surfaceArea: number;
  boundingBox: { length: number; width: number; height: number };
  holeCount: number;
  pocketCount: number;
  thinWallCount: number;
  bendCount: number;
  cutLengthMm: number;
  // Breakdown of cutLengthMm by category — lets the UI show a checkable
  // total instead of one opaque number. Undefined for CNC/mesh-inference
  // parts (no panel-wire-walk data available there); the frontend falls
  // back to showing only the combined total when absent.
  cutLengthBreakdown?: { outerProfileMm: number; circularHolesMm: number; internalProfilesMm: number };
  // Length of the single longest unbroken laser path (whole-part outer
  // profile treated as ONE continuous loop, vs. each individual hole rim /
  // internal cutout wire on its own) — laser machines slow down on long
  // contours, so this is the DFM-relevant number, not the summed total.
  // Undefined for CNC/mesh-inference parts, same as cutLengthBreakdown.
  longestContinuousCutMm?: number;
  // Corner turn-angle counts — how many discrete corners on the cut path
  // need the laser/punch head to decelerate. sharpCornerCount: turn angle
  // > 60deg (ordinary right-angle-ish corners). acuteCornerCount: turn
  // angle > 150deg / interior angle < 30deg (near-reversal spike/notch
  // tips) — always a SUBSET of sharpCornerCount, not a separate bucket.
  // Undefined for CNC/mesh-inference parts, same as cutLengthBreakdown.
  sharpCornerCount?: number;
  acuteCornerCount?: number;
  // Count of holes under 2x sheet thickness in diameter — a laser/punch
  // must run a reduced feed rate piercing these (heat buildup relative to
  // hole size and taper/dross risk both increase below ~2x thickness).
  // Undefined for CNC/mesh-inference parts, same as cutLengthBreakdown.
  smallHoleCount?: number;
  // New in cad-engine geo_v38. extrudedFlangeCount: real, pierced/extruded
  // hole flanges (a raised collar formed around a hole on thin sheet to
  // gain thread-engagement depth before tapping) — a heuristic over coaxial
  // stepped-hole clustering, coarsely corrected for counterbore/countersink
  // overlap; see memory_optimizer.py's CACHE_VERSION changelog for the full
  // disclosed limitation. thinWebCount: holes whose true edge-to-edge gap
  // to a neighbouring hole is below 1.5x sheet thickness (excludes holes
  // already counted in smallHoleCount, so no double-count). internalProfileCount:
  // discrete count of internal cutout wires (slots/scalloped profiles/
  // keyholes — anything that isn't the outer boundary or a plain round
  // hole), alongside the existing cutLengthBreakdown.internalProfilesMm length.
  extrudedFlangeCount?: number;
  // Confident continuous-curvature (roll-bent) detections only — see
  // cad-engine/sheet_metal/features/rolled_form.py. Ambiguous candidates are
  // deliberately NOT counted here.
  rolledFormCount?: number;
  // Confident formed-feature (dimple/emboss) detections only — see
  // cad-engine/sheet_metal/features/formed_feature.py. A candidate is only
  // counted here when the sheet's opposite face has its own local void at
  // the same footprint (material worked from both faces, not just removed).
  // No costing engine consumes this yet — detection only, same as
  // thinWebCount/internalProfileCount below until a real forming cost model
  // is built.
  formedFeatureCount?: number;
  // Confident lance detections only — see cad-engine/sheet_metal/features/
  // lance.py. No costing engine consumes this yet.
  lanceCount?: number;
  // Real bend-to-bend/bend-to-flange geometric facts (flange_width_mm,
  // fold_relative_orientation) — see cad-engine/sheet_metal/bend_
  // relationships.py. NOT a hem/return-flange verdict; that decision belongs
  // to DFM scoring, which applies its own reconciled hemReturnFlangeLengthMin
  // threshold to these real facts. Not yet read by any consumer.
  bendFlangeRelationships?: Array<{
    bendAFaceIds: number[];
    bendBFaceIds: number[];
    sharedFlangeFaceId: number;
    flangeWidthMm: number | null;
    foldRelativeOrientation: number | null;
    recognitionStatus: 'recognized' | 'ambiguous';
  }>;
  thinWebCount?: number;
  internalProfileCount?: number;
  // Nesting/material-utilization metrics (bounding rectangle of the TRUE
  // unfolded flat pattern, via the cad-engine's 2D unfold solver — NOT the
  // 3D part's bbox, a completely different number for a bent part).
  // Undefined when the solver couldn't confidently walk this part's
  // panel/bend graph (e.g. non-manifold topology) — never guessed.
  boundingRectMm2?: number;
  // The two dimensions the cad-engine's unfold solver actually resolves
  // (boundingRectMm2 is just their product) -- the real unfolded flat
  // pattern's own length/width, as opposed to the folded 3D part's
  // maxLength/maxWidth (a different rectangle for any bent part). Same
  // undefined-when-unresolved rule as boundingRectMm2 above.
  flatPatternBoundingLengthMm?: number;
  flatPatternBoundingWidthMm?: number;
  // Real flat-pattern outline polygon (ordered [x,y] mm points, same
  // unfolded 2D frame as the bounding-length/width fields above) + hole
  // positions -- for true (non-rectangle) nesting visualization, NOT used
  // by costing. Undefined when the cad-engine's wire-walk/merge couldn't
  // resolve one for this part's topology (flatPatternOutlineSource then
  // reads 'unavailable') -- never a fabricated rectangle standing in.
  flatPatternOutlinePointsMm?: number[][];
  flatPatternHolesMm?: Array<{ cx_mm: number; cy_mm: number; diameter_mm: number }>;
  flatPatternOutlineSource?: 'wire_walk' | 'unavailable';
  materialUtilizationPct?: number;
  scrapAreaMm2?: number;
  sheetThicknessMm: number;
  pierceCount: number;
  // Non-cutting head-repositioning ("rapid traverse") time between real
  // pierce locations (nearest-neighbour tour over hole/slot centroids) —
  // additive on top of cutting+piercing time. Undefined when the cad
  // engine had no dominant-face reference point to anchor the tour on.
  rapidTraverseSec?: number;
  flatPatternAreaMm2: number;
  holeDiameters: number[];
  holeGroups: Array<{ diameter_mm: number; count: number }>;
  counterboreGroups: Array<{ diameter_mm: number; count: number }>;
  countersinkGroups: Array<{ diameter_mm: number; count: number }>;
  bendRadii: number[];
  // Real per-bend length/angle, aligned index-for-index with bendRadii (all
  // three come from the SAME cad-engine clustering pass — see
  // _collect_dedup_bends). Empty when that pass wasn't usable (mesh-
  // inference-only parts, or a sharp-fold/no-bend-radius part) — never
  // guessed or backfilled from a flat-pattern-dimension proxy.
  bendLengths: number[];
  bendAngles: number[];
  featureSource: 'step_topology' | 'mesh_inference';
}

@Injectable()
export class AutoFillService {
  private readonly logger = new Logger(AutoFillService.name);
  private readonly cadEngineUrl: string;
  private readonly cadEngineApiKey: string;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly stepConverterService: StepConverterService,
    private readonly sheetMetalExtractor: SheetMetalFeatureExtractorService,
    private readonly machiningLookup: MachiningLookupService,
  ) {
    this.cadEngineUrl = process.env.CAD_ENGINE_URL || 'http://localhost:5000';
    this.cadEngineApiKey = process.env.CAD_ENGINE_API_KEY || '';
  }

  // ── Background analysis jobs ─────────────────────────────────────────────────
  // Large/complex STEP files can spend several minutes in the CAD engine
  // (mostly OCC's own STEP transfer, unrelated to app code). Rather than hold
  // one HTTP request open that long, the controller starts a job here and
  // returns immediately; the frontend polls getJobStatus() for the result.
  // In-memory is sufficient — single dev instance, no queue infra needed.
  private readonly jobs = new Map<string, {
    status: 'processing' | 'ready' | 'error';
    result?: AutoFillResponseDto;
    error?: string;
    createdAt: number;
  }>();
  private static readonly JOB_TTL_MS = 30 * 60 * 1000; // 30 min

  startAnalysis(
    fileBuffer: Buffer,
    fileName: string,
    userId: string,
    accessToken: string,
    location?: string,
    familyHint?: string,
  ): string {
    // Sweep stale jobs on each new start — bounds Map growth without a background timer.
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (now - job.createdAt > AutoFillService.JOB_TTL_MS) this.jobs.delete(id);
    }

    const jobId = crypto.randomUUID();
    this.jobs.set(jobId, { status: 'processing', createdAt: now });

    this.analyzeAndSuggest(fileBuffer, fileName, userId, accessToken, location, false, familyHint)
      .then((result) => this.jobs.set(jobId, { status: 'ready', result, createdAt: now }))
      .catch((e: any) => {
        // Background job: nothing else ever sees this error, so log it with
        // its stack here -- the client only receives the message.
        this.logger.error(`[auto-fill] analysis of ${fileName} failed (job ${jobId}): ${e?.message ?? e}`, e?.stack);
        this.jobs.set(jobId, { status: 'error', error: e?.message ?? 'Analysis failed', createdAt: now });
      });

    return jobId;
  }

  getJobStatus(jobId: string) {
    return this.jobs.get(jobId);
  }

  async analyzeAndSuggest(
    fileBuffer: Buffer,
    fileName: string,
    userId: string,
    accessToken: string,
    location?: string,
    forceReanalysis = false,
    // Manual, disclosed family override (Create BOM Item's process dropdown) --
    // see cad-engine/main.py's family_hint. Passed through only when the
    // caller explicitly set one; absent, the real geometric classifier chain
    // runs exactly as it always has.
    familyHint?: string,
  ): Promise<AutoFillResponseDto> {
    // 1. The CAD engine is the only source of geometry and features. When it
    // cannot analyse the file there is nothing real to return, so the request
    // fails with the engine's own reason.
    //
    // It used to fall back instead: zeroed geometry (or an STL bounding box),
    // which the process heuristic below then labelled "Machining" at 0.6
    // confidence, plus a made-up make/buy, item type, cycle time and
    // confidence score, all returned as a normal 200. The upload form filled
    // itself from that, and Refresh Analysis wrote it over a real analysis.
    let cadResult: any;
    try {
      cadResult = await this.callCADEngineStateless(fileBuffer, fileName, forceReanalysis, familyHint);
    } catch (e) {
      const reason = (e.response?.data?.detail as string | undefined) || e.message;
      this.logger.warn(`CAD engine could not analyse ${fileName} (${reason})`);
      // No HTTP response at all = the engine is not reachable (not running,
      // wrong port, refused, timed out). A response means it ran and rejected
      // this file: a different problem with a different fix.
      if (!e.response) {
        throw new ServiceUnavailableException(
          `CAD engine is not reachable, so ${fileName} was not analysed and nothing was filled in. ` +
          `Start the CAD engine and try again (${reason}).`,
        );
      }
      throw new UnprocessableEntityException(`CAD engine could not analyse ${fileName}: ${reason}`);
    }
    const rawGeometry: RawGeometry = this.sanitizeGeometry(this.extractGeometryFromCADResult(cadResult));
    const cadFamilyClassification = this.extractFamilyClassification(cadResult);

    // 2. The part family is the CAD engine's own classification
    // (detect_part_family, cad-engine/shared/component_feature_analyzer.py),
    // used as is.
    //
    // A TypeScript rule set, classifyProcess(), used to run here as well:
    // bounding-box / fill-ratio / feature-count thresholds that returned a
    // fixed process string ("Machining" as the catch-all at 0.6 confidence,
    // "Die Casting" for any part over 500 cm3 with 8+ features), a fixed
    // cycle time (15 / 45 / 60 / 120 / 180 min), a fixed make/buy and an item
    // type by volume. Four more steps then let that rule override the engine
    // family or be overridden by it. None of it was derived from the part:
    // the engine already applies its own sheet-metal gates and vetoes, with
    // reasons, and the real route engines decide process, machine and time.
    const family = { family: cadFamilyClassification.family, confidence: cadFamilyClassification.confidence };

    // 3. Material is NOT suggested: the engineer chooses it. (suggestMaterial()
    // used to return the median-density ferrous row, a guess shown as an
    // extraction.) 4. Weight is therefore not known either: weight = volume x
    // density. 0 means "not known"; the client fills only a positive value.
    const geometry: AutoFillGeometryDto = {
      ...rawGeometry,
      weight: 0,
    };

    // No rate, cycle time or cost is estimated here. getMHR() read a table
    // no migration creates, getLHR() took whichever labour row was newest,
    // runMatchingCalculator() keyword-matched a calculator by the invented
    // process string, and the cycle time came from fixed speed tables with a
    // 2 mm / carbon-steel default. The quote is computed by the cost engine
    // once a material is chosen, from the real machine, rate and route.
    const suggestions: AutoFillSuggestionsDto = {
      name: this.inferName(fileName),
      partNumber: this.generatePartNumber(fileName),
      // The category selector's starting position, from the classified family;
      // null when the engine did not classify the part.
      materialCategory: family.family == null
        ? null
        : family.family === 'plastic_molded' ? 'PLASTIC_RUBBER' : 'FERROUS_NON_FERROUS',
      materialGrade: '',
      materialId: null,
      density: null,
      // The family's real process_taxonomy group, or null: never a guessed name.
      processType: family.family ? await this.resolveDbDrivenProcessLabel(family.family, accessToken) : null,
      suggestedMachine: null, // resolved from the feature graph below
      familyClassification: family.family,
      familyConfidence: family.confidence,
    };

    const featureGraph = this.buildFeatureGraph(rawGeometry, family, cadResult);
    suggestions.suggestedMachine = await this.resolveSuggestedMachine(family.family, featureGraph, accessToken);

    return { fileName, geometry, suggestions, featureGraph };
  }

  private buildFeatureGraph(
    geo: RawGeometry,
    family: { family: string | null; confidence: number | null },
    cadResult?: any,
  ): object {
    const signals: string[] = [];
    if (geo.sheetThicknessMm > 0) signals.push(`Uniform thickness ${geo.sheetThicknessMm} mm`);
    if (geo.bendCount > 0) signals.push(`${geo.bendCount} bends detected`);
    if (geo.flatPatternAreaMm2 > 0) signals.push('Flat pattern detected');
    if (geo.holeCount > 0) signals.push(`${geo.holeCount} holes detected`);

    // No process route is recommended here, and none is invented.
    //
    // This used to be a hardcoded processMap: a coarse process-type string in,
    // a fixed list of process names out. 'Sheet Metal Bending' always produced
    // ['Fiber Laser Cutting', 'CNC Press Brake', 'Deburring'] regardless of what
    // the CAD actually contained -- the same three steps for a flat blank with
    // no bends as for a 12-bend chassis, and never the burring, tapping or
    // inspection a real part might need. It was a generic sequence presented as
    // a recommendation.
    //
    // It was also load-bearing in a way that made it worse than cosmetic: the
    // list always contained 'CNC Press Brake', and cost-summary reads it
    // (`routeHasBending`) to estimate 1 bend whenever CAD and the drawing both
    // report zero. So a genuinely flat part was given a fabricated bend, sourced
    // from a map that had never looked at it.
    //
    // The real authority already exists and is the one that quotes: the
    // registered ManufacturingProcessEngine set, gated by real detected
    // features and real machine capability, assembled by getRouteComparison and
    // applied through apply-route. Emitting an empty list here means the Cost
    // Guide shows no operations until that authority has actually run, which is
    // exactly what its own Direct Process Costs panel already promises:
    // "Operations and costs are computed from the applied scenario against the
    // refreshed geometry -- never before it."
    const processRecommendations: Array<{ sequence: number; process: string; status: string }> = [];

    // Phase 1 aggregate cost drivers — typed for formula routing in Phase 2
    type CostDriverType =
      | 'laser_time' | 'press_brake_hits' | 'pierce_count'
      | 'material_usage' | 'drill_time' | 'setup_time';
    interface CostDriver { name: string; unit: string; value: number; driverType: CostDriverType; quantity: number; }
    const costDrivers: CostDriver[] = [];
    if (geo.flatPatternAreaMm2 > 0) {
      costDrivers.push({ name: 'Material Usage', driverType: 'material_usage', quantity: geo.flatPatternAreaMm2, unit: 'mm²', value: geo.flatPatternAreaMm2 });
    }
    if (geo.cutLengthMm > 0) {
      costDrivers.push({ name: 'Laser Cut Length', driverType: 'laser_time', quantity: geo.cutLengthMm, unit: 'mm', value: geo.cutLengthMm });
    }
    if (geo.pierceCount > 0) {
      costDrivers.push({ name: 'Pierce Points', driverType: 'pierce_count', quantity: geo.pierceCount, unit: 'pcs', value: geo.pierceCount });
    }
    if (geo.bendCount > 0) {
      costDrivers.push({ name: 'Press Brake Hits', driverType: 'press_brake_hits', quantity: geo.bendCount, unit: 'hits', value: geo.bendCount });
    }
    if (geo.holeCount > 0) {
      costDrivers.push({ name: 'Drill Points', driverType: 'drill_time', quantity: geo.holeCount, unit: 'pcs', value: geo.holeCount });
    }

    const isSheetMetal = family.family === 'sheet_metal';
    const isInjectionMolded = family.family === 'plastic_molded';
    // Casting (die / sand / investment): reached only via cad-engine's explicit
    // family_hint (the user's chosen process). The engine reports which
    // process catalog its features were validated against — read that, not a
    // second family->catalog table kept here.
    const castingDomain: string | null =
      cadResult?.geometry_features?.manufacturing_features
        ?.manufacturing_intelligence?.features?.casting_domain ?? null;
    const isCasting = castingDomain != null;

    const cadV2: any =
      cadResult?.geometry_features?.manufacturing_features
        ?.manufacturing_intelligence?.features?.feature_graph_v2
      ?? (cadResult as any)?.machining_features?.feature_graph_v2
      ?? null;
    const machiningFeatures: any = (cadResult as any)?.machining_features ?? null;
    const imHeatmapFeatures: any =
      cadResult?.geometry_features?.manufacturing_features
        ?.manufacturing_intelligence?.features?.heatmap_features
      ?? null;

    // STL ordering verification: compare face_map triangle total to STL header count.
    // STL header count is logged by /convert-step as X-STL-Triangle-Count.
    // face_map_tri_total is logged here. If they match, face_map ordinals are valid.
    if (cadV2?.metadata?.face_map?.length) {
      const faceMapTriTotal = (cadV2.metadata.face_map as any[]).reduce(
        (sum: number, e: any) => sum + (e.tri_count ?? 0), 0
      );
      this.logger.log(
        `feature_graph_v2 face_map: ${cadV2.metadata.face_map.length} faces, ` +
        `${faceMapTriTotal} triangles [verify == X-STL-Triangle-Count from /convert-step]`
      );
    }

    const cadMI = cadResult?.geometry_features?.manufacturing_features?.manufacturing_intelligence;
    const featureGraph = {
      extractedAt: new Date().toISOString(),
      classification: {
        // null when the CAD engine could not classify the part. Never a
        // default family: 'milled' at 0.65 here is what showed unclassified
        // parts as "Machining".
        family: family.family,
        confidence: family.confidence,
        signals,
        classificationSignals: cadMI?.classification_signals ?? undefined,
        classificationReasons: cadMI?.classification_reason ?? undefined,
      },
      features: isSheetMetal ? this.sheetMetalExtractor.extract(geo) : [],
      processRecommendations,
      summary: {
        bendCount:          geo.bendCount,
        cutLengthMm:        geo.cutLengthMm,
        holeCount:          geo.holeCount,
        sheetThicknessMm:   geo.sheetThicknessMm,
        slotCount:
          cadResult?.geometry_features?.manufacturing_features?.manufacturing_intelligence?.features?.slot_count
          ?? (cadResult as any)?.machining_features?.slots?.length
          ?? 0,
        pierceCount:        geo.pierceCount,
        flatPatternAreaMm2: geo.flatPatternAreaMm2,
        flatPatternBoundingLengthMm: geo.flatPatternBoundingLengthMm,
        flatPatternBoundingWidthMm: geo.flatPatternBoundingWidthMm,
        flatPatternOutlinePointsMm: geo.flatPatternOutlinePointsMm,
        flatPatternHolesMm: geo.flatPatternHolesMm,
        flatPatternOutlineSource: geo.flatPatternOutlineSource,
        costDrivers,
        holeDiameters:      geo.holeDiameters ?? [],
        holeGroups:         (geo.holeGroups ?? []).map((g) => ({
          ...g,
          id: `hole_d${g.diameter_mm.toFixed(1)}_c${g.count}`,
          geometry_refs: { faces: [], edges: [] },
        })),
        counterboreGroups: geo.counterboreGroups ?? [],
        countersinkGroups: geo.countersinkGroups ?? [],
        bendRadii:          geo.bendRadii ?? [],
        bendLengths:        geo.bendLengths ?? [],
        bendAngles:         geo.bendAngles ?? [],
        // Already computed on RawGeometry (see extractGeometryFromCADResult)
        // but never copied into summary before now — the "Detected" feature-
        // checklist panel (manufacturing-intelligence/page.tsx) needs these
        // at this top level, not nested under a feature's own recognition object.
        sharpCornerCount:     geo.sharpCornerCount,
        acuteCornerCount:     geo.acuteCornerCount,
        smallHoleCount:       geo.smallHoleCount,
        extrudedFlangeCount:  geo.extrudedFlangeCount,
        rolledFormCount:      geo.rolledFormCount,
        formedFeatureCount:   geo.formedFeatureCount,
        lanceCount:           geo.lanceCount,
        bendFlangeRelationships: geo.bendFlangeRelationships,
        thinWebCount:         geo.thinWebCount,
        internalProfileCount: geo.internalProfileCount,
        // Injection-molded features — promoted from InjectionMoldedFeatureExtractor
        // output (cadMI.features). Phase 1 fields are always present; Phase 2 fields
        // are present when extraction_version >= im_v2_phase2 and fall back to safe
        // defaults (0 / null) so older CAD engine responses keep working unchanged.
        ...(isInjectionMolded ? {
          // Phase 1 — wall thickness
          wallThicknessNominalMm: cadMI?.features?.wall_thickness_nominal_mm ?? 0,
          wallThicknessMinMm:     cadMI?.features?.wall_thickness_min_mm ?? 0,
          wallThicknessMaxMm:     cadMI?.features?.wall_thickness_max_mm ?? 0,
          // Phase 1 — cylindrical features (hole/boss lumped)
          holeOrBossCount:        cadMI?.features?.hole_or_boss_count ?? 0,
          filletCount:            cadMI?.features?.fillet_count ?? 0,
          // Phase 1 — rib proxy (pocket-floor count, kept for backward compat)
          ribCountProxy:          cadMI?.features?.rib_count_proxy ?? 0,
          // Phase 4 — real rib count (antiparallel wall-face pairs at rib separation)
          // Falls back to rib_count_proxy when CAD engine is pre-Phase 4.
          ribCount:               cadMI?.features?.rib_count ?? cadMI?.features?.rib_count_proxy ?? 0,
          // Phase 2 — wall uniformity (null when CAD engine is pre-Phase 2)
          wallThicknessStdDevMm:    cadMI?.features?.wall_thickness_std_dev_mm ?? null,
          thinWallViolationCount:   cadMI?.features?.thin_wall_violation_count ?? 0,
          thickWallViolationCount:  cadMI?.features?.thick_wall_violation_count ?? 0,
          wallUniformityRatio:      cadMI?.features?.wall_uniformity_ratio ?? null,
          // Phase 2 — blind feature split
          throughHoleCount:     cadMI?.features?.through_hole_count ?? 0,
          blindFeatureCount:    cadMI?.features?.blind_feature_count ?? 0,
          // Phase 3 — insert candidates (blind holes at standard insert OD sizes)
          insertCandidateCount: cadMI?.features?.insert_candidate_count ?? 0,
          // Phase 2 — draft angles
          undraftedFaceCount:   cadMI?.features?.undrafted_face_count ?? 0,
          draftedFaceCount:     cadMI?.features?.drafted_face_count ?? 0,
          undercutFaceCount:    cadMI?.features?.undercut_face_count ?? 0,
          partingComplexity:    cadMI?.features?.parting_complexity ?? null,
          avgDraftAngleDeg:     cadMI?.features?.avg_draft_angle_deg ?? null,
        } : {}),
        // Die Casting Phase 1 — promoted from DieCastingFeatureExtractor output
        // (cadMI.features). Detection + highlighting only; process routing and
        // costing are a later phase (see the Die Casting Phase 1 plan).
        ...(isCasting ? {
          castingDomain,
          castingSetupAxis:             cadMI?.features?.primary_setup_axis ?? null,
          castingPartingPlaneOffsetMm:  cadMI?.features?.parting_plane_offset_mm ?? null,
          // Measured from the solid (cad-engine shared/casting_geometry.py):
          // silhouette on the parting plane (clamp force) and local wall
          // thickness (solidification). null = not measured, never 0.
          castingProjectedAreaMm2:      cadMI?.features?.projected_area_mm2 ?? null,
          // Silhouette extents on the parting plane [a, b] mm (tie-bar fit).
          castingPartingFootprintMm:    cadMI?.features?.parting_footprint_mm ?? null,
          castingPullExtentMm:          cadMI?.features?.pull_extent_mm ?? null,
          // Outer boundary of the parting-plane silhouette: the parting line (mm).
          castingPartingPerimeterMm:    cadMI?.features?.parting_perimeter_mm ?? null,
          // Cores (shared/core_geometry.py): air no die half reaches by a straight
          // pull, each with volume, box and area. null = not measured.
          castingCores:                 cadMI?.features?.core_count == null ? null : (cadMI?.features?.cores ?? []),
          castingWallNominalMm:         cadMI?.features?.wall_thickness_nominal_mm ?? null,
          castingWallMinMm:             cadMI?.features?.wall_thickness_min_mm ?? null,
          castingWallMaxMm:             cadMI?.features?.wall_thickness_max_mm ?? null,
          castingSimpleHoleCount:       cadMI?.features?.simple_hole_count ?? 0,
          castingMultiStepHoleCount:    cadMI?.features?.multi_step_hole_count ?? 0,
          castingComboVoidCount:        cadMI?.features?.combo_void_count ?? 0,
          castingVoidCount:             cadMI?.features?.void_count ?? 0,
          castingSlideBundleCount:      cadMI?.features?.slide_bundle_count ?? 0,
          castingPlanarFaceCount:       cadMI?.features?.planar_face_count ?? 0,
          castingCurvedWallCount:       cadMI?.features?.curved_wall_count ?? 0,
          castingCurvedSurfaceCount:    cadMI?.features?.curved_surface_count ?? 0,
          castingSharpEdgeCount:        cadMI?.features?.sharp_edge_count ?? 0,
          castingNotSupportedFaceCount: (cadMI?.features?.not_supported_face_ids ?? []).length,
        } : {}),
      },
      dfmWarnings:            this.buildDFMWarnings(geo, cadResult),
      validationResults:      this.buildValidationChecks(geo, family.family, cadResult),
      manufacturabilityScore: this.extractManufacturabilityScore(cadResult),
      feature_graph_version:  parseInt(process.env.FEATURE_GRAPH_VERSION ?? '4', 10),
      cad_engine_version:     process.env.CAD_ENGINE_VERSION ?? 'geo_v5',
      analyzed_at:            new Date().toISOString(),
      ...(cadV2 ? { feature_graph_v2: this.attachCanonicalOperations(cadV2, family.family, castingDomain) } : {}),
      ...(machiningFeatures ? { machining_features: machiningFeatures } : {}),
      // Semantic GD&T from the STEP model itself (cad-engine shared/step_pmi.py).
      ...(cadResult?.pmi ? { pmi: cadResult.pmi } : {}),
      ...(imHeatmapFeatures ? { imHeatmapFeatures } : {}),
      ...(cadResult?.geometry_features?.manufacturing_features?.component_features
        ? { component_features: cadResult.geometry_features.manufacturing_features.component_features }
        : {}),
    };
    const _cf = (featureGraph as any).component_features;
    this.logger.log(
      `[component_features] ${_cf ? `stored in featureGraph (axes=${_cf.setup_axes_candidates?.length ?? 0})` : 'NOT stored — cadResult path returned nothing'}`,
    );
    return featureGraph;
  }

  /**
   * Attaches a real `canonical_operation` string (e.g. "Drilling // SimpleHole")
   * to each CNC feature_graph_v2 entry whose feature_type resolves via
   * canonical-operation.ts. Non-CNC families (sheet_metal, plastic_molded, ...)
   * and any feature_type not in that table are passed through unchanged — no
   * fabricated label is ever attached.
   */
  private attachCanonicalOperations(cadV2: any, cadFamily: string | null | undefined, castingDomain?: string | null): any {
    if (!cadV2?.features?.length) return cadV2;
    // Die casting: attach the real operations the catalog pairs with each
    // feature type (memory/Die Casting/Processes/operations.csv, via the
    // generated vocabulary). Which one applies to a given instance (As Cast
    // vs Insert Coring vs Unscrewing, ...) has no sourced selection rule yet,
    // so the full allowed list is attached and nothing is picked for it.
    if (castingDomain && castingDomain in REFERENCE_FEATURE_OPERATIONS) {
      const ops = REFERENCE_FEATURE_OPERATIONS[castingDomain as keyof typeof REFERENCE_FEATURE_OPERATIONS] as Readonly<Record<string, readonly string[]>>;
      return {
        ...cadV2,
        features: cadV2.features.map((f: any) => {
          const allowed = ops[f.feature_type];
          return allowed ? { ...f, catalog_operations: [...allowed] } : f;
        }),
      };
    }
    const family = machiningRouteFamilyOf(cadFamily);
    return {
      ...cadV2,
      features: cadV2.features.map((f: any) => {
        const canonicalOperation = resolveCanonicalOperation(f.feature_type, f.variant, family);
        return canonicalOperation ? { ...f, canonical_operation: canonicalOperation } : f;
      }),
    };
  }

  private extractManufacturabilityScore(cadResult?: any): number | undefined {
    if (!cadResult) return undefined;
    const normalize = (raw: any): number | undefined => {
      const n = parseFloat(raw);
      if (!isFinite(n)) return undefined;
      // CAD engines may return 0–1 float or 0–100 int; treat ≤ 1 as float
      return n <= 1 ? Math.round(n * 100) : Math.round(n);
    };
    const mi = cadResult?.geometry_features?.manufacturing_features?.manufacturing_intelligence;
    const miScore = normalize(mi?.manufacturability_score);
    if (miScore != null) return miScore;
    const dfmScore = normalize(
      cadResult?.dfm_analysis?.manufacturability_score
        ?? cadResult?.geometry_features?.dfm_analysis?.manufacturability_score,
    );
    return dfmScore;
  }

  private mapSeverity(raw: any): 'critical' | 'warning' | 'info' {
    const s = String(raw ?? '').toLowerCase();
    if (s === 'critical' || s === 'error' || s === 'high') return 'critical';
    if (s === 'warning' || s === 'medium' || s === 'warn') return 'warning';
    return 'info';
  }

  private buildDFMWarnings(geo: RawGeometry, cadResult?: any): object[] {
    const warnings: object[] = [];
    let id = 0;

    const cadMI = cadResult?.geometry_features?.manufacturing_features?.manufacturing_intelligence;
    const isIM = cadMI?.detected_family === 'plastic_molded';

    // ── Injection Molding DFM ──────────────────────────────────────────────────
    if (isIM && cadMI?.features) {
      const f = cadMI.features;
      const undrafted: number = f.undrafted_face_count ?? 0;
      const undercut: number = f.undercut_face_count ?? 0;
      const thinViolations: number = f.thin_wall_violation_count ?? 0;
      const wallNominal: number = f.wall_thickness_nominal_mm ?? 0;
      const uniformityRatio: number = f.wall_uniformity_ratio ?? 0;
      const partingComplexity: number = f.parting_complexity ?? 0;
      const ribCount: number = f.rib_count ?? f.rib_count_proxy ?? 0;
      const filletCount: number = f.fillet_count ?? 0;
      const insertCount: number = f.insert_candidate_count ?? 0;

      // 1. Draft angle — faces with < 0.3° are ejection risks
      if (undrafted > 0) {
        warnings.push({
          id: `dfm_im_draft_${id++}`,
          severity: undrafted > 5 ? 'critical' : 'warning',
          category: 'draft_angle',
          message: `${undrafted} face(s) have < 0.3° draft angle — ejection damage risk.`,
          recommendation:
            'Add ≥ 0.5° draft on all pull-axis surfaces. Textured finishes require ≥ 1.5°. ' +
            'Insufficient draft causes the part to stick to the core on ejection.',
        });
      }

      // 2. Undercuts — side-action or lifter required
      if (undercut > 0) {
        warnings.push({
          id: `dfm_im_undercut_${id++}`,
          severity: 'critical',
          category: 'undercut',
          message: `${undercut} undercut face(s) detected — side-action or lifter required.`,
          recommendation:
            'Redesign feature to eliminate undercut or budget for side-action tooling ' +
            '($2,000–$8,000 per direction). Side actions increase cycle time by ~10–15%.',
        });
      }

      // 3. Thin wall zones below 60% of nominal
      if (thinViolations > 0) {
        warnings.push({
          id: `dfm_im_thin_wall_${id++}`,
          severity: 'warning',
          category: 'thin_wall',
          message: `${thinViolations} zone(s) below 60% of nominal wall (${wallNominal > 0 ? wallNominal.toFixed(1) + ' mm' : 'unknown'}).`,
          recommendation:
            'Thin zones cause short shots, sink marks, and differential shrinkage. ' +
            'Maintain wall thickness within 40–60% of nominal for uniform fill and cooling.',
        });
      }

      // 4. Nominal wall below minimum fill threshold
      if (wallNominal > 0 && wallNominal < 1.0) {
        warnings.push({
          id: `dfm_im_wall_min_${id++}`,
          severity: 'critical',
          category: 'thin_wall',
          message: `Nominal wall ${wallNominal.toFixed(2)} mm is below 1.0 mm — incomplete fill likely.`,
          recommendation:
            'Increase wall to ≥ 1.0 mm (engineering resins: 1.5–3.5 mm optimal). ' +
            'Walls below 1 mm require high injection pressure and are prone to knit lines.',
        });
      }

      // 5. Nominal wall above sink mark threshold
      if (wallNominal > 6.0) {
        warnings.push({
          id: `dfm_im_wall_max_${id++}`,
          severity: 'warning',
          category: 'thin_wall',
          message: `Nominal wall ${wallNominal.toFixed(1)} mm exceeds 6.0 mm — sink marks and long cycle time expected.`,
          recommendation:
            'Core out thick sections. Target 2.5–4.0 mm for structural plastics. ' +
            'Each mm above 4 mm adds ~5 s cooling time. Consider hollow ribbed design.',
        });
      }

      // 6. High wall thickness variation → differential shrinkage → warpage
      if (wallNominal > 0 && uniformityRatio > 0.40) {
        warnings.push({
          id: `dfm_im_wall_variation_${id++}`,
          severity: 'warning',
          category: 'thin_wall',
          message: `Wall thickness variation ${(uniformityRatio * 100).toFixed(0)}% of nominal — warpage and differential shrinkage risk.`,
          recommendation:
            'Uniform wall thickness within ±20% of nominal minimises differential cooling, ' +
            'reduces weld lines, and balances cavity fill pressure.',
        });
      }

      // 7. Complex parting geometry — stepped shutoff / flash risk
      if (partingComplexity >= 0.50) {
        warnings.push({
          id: `dfm_im_parting_${id++}`,
          severity: partingComplexity >= 0.75 ? 'critical' : 'warning',
          category: 'general',
          message: `Complex parting geometry (score: ${(partingComplexity * 100).toFixed(0)}%) — stepped shutoff likely.`,
          recommendation:
            'Simplify parting to a single plane where possible. ' +
            'Stepped shutoffs require tight land tolerances (±0.02 mm) to prevent flash and increase mold cost by 20–40%.',
        });
      }

      // 8. Ribs without confirmed fillets — stress concentration + sink marks
      if (ribCount > 0 && filletCount === 0) {
        warnings.push({
          id: `dfm_im_rib_fillet_${id++}`,
          severity: 'warning',
          category: 'fillet',
          message: `${ribCount} rib(s) detected — base fillets not confirmed.`,
          recommendation:
            'Add R ≥ 0.3× wall thickness fillet at all rib roots. ' +
            'Sharp rib bases concentrate stress and cause sink marks on the opposite face.',
        });
      }

      // 9. Threaded insert candidates — flag for procurement and drawing callout
      if (insertCount > 0) {
        warnings.push({
          id: `dfm_im_inserts_${id++}`,
          severity: 'info',
          category: 'general',
          message: `${insertCount} threaded insert location(s) detected.`,
          recommendation:
            'Confirm insert type (Helicoil / Spiralform / ultrasonic press-in) and specify ' +
            'pull-out torque on drawing. Boss OD should be 2× insert OD.',
        });
      }

      // 10. All checks passed — confirm with gate / venting reminder
      if (warnings.length === 0) {
        warnings.push({
          id: `dfm_im_pass_${id++}`,
          severity: 'info',
          category: 'general',
          message: 'No critical DFM issues detected for injection molding.',
          recommendation:
            'Confirm gate location (gate area ≥ 1 mm² per 10 cm³ part volume), ' +
            'venting at last-fill extremities (0.025 mm land), and ejector pin layout with toolmaker before cutting steel.',
        });
      }

      return warnings;
    }

    // ── Sheet Metal DFM ────────────────────────────────────────────────────────
    if (geo.sheetThicknessMm > 0 && geo.sheetThicknessMm < 1.0) {
      warnings.push({
        id: `dfm_thin_wall_${id++}`,
        severity: 'warning',
        category: 'thin_wall',
        message: `Sheet thickness ${geo.sheetThicknessMm.toFixed(1)} mm may cause distortion during forming.`,
        recommendation: 'Increase to ≥ 1.0 mm for structural frames.',
      });
    }

    if (geo.sheetThicknessMm > 0 && geo.bendRadii.length > 0) {
      const minBendRadius = geo.sheetThicknessMm * 0.8;
      const smallestRadius = Math.min(...geo.bendRadii);
      if (smallestRadius < minBendRadius) {
        warnings.push({
          id: `dfm_bend_radius_${id++}`,
          severity: 'warning',
          category: 'sharp_corner',
          message: `Minimum bend radius ${smallestRadius.toFixed(1)} mm is below 0.8× thickness (${minBendRadius.toFixed(1)} mm).`,
          recommendation: `Increase bend radius to ≥ ${minBendRadius.toFixed(1)} mm to prevent cracking.`,
        });
      }
    }

    if (geo.sheetThicknessMm > 0 && warnings.length === 0) {
      warnings.push({
        id: `dfm_general_${id++}`,
        severity: 'info',
        category: 'general',
        message: 'Consider adding edge breaks (0.3 mm × 45°) to all laser-cut edges.',
        recommendation: 'Reduces injury risk during assembly and handling.',
      });
    }

    return warnings;
  }

  private buildValidationChecks(geo: RawGeometry, family: string | null, cadResult?: any): object[] {
    const checks: object[] = [];

    const cadMI = cadResult?.geometry_features?.manufacturing_features?.manufacturing_intelligence;
    const isIM = family === 'plastic_molded';

    // ── Injection Molding validation checks ───────────────────────────────────
    if (isIM && cadMI?.features) {
      const f = cadMI.features;
      const undrafted: number = f.undrafted_face_count ?? 0;
      const undercut: number = f.undercut_face_count ?? 0;
      const wallNominal: number = f.wall_thickness_nominal_mm ?? 0;
      const uniformityRatio: number = f.wall_uniformity_ratio ?? 0;
      const thinViolations: number = f.thin_wall_violation_count ?? 0;
      const partingComplexity: number = f.parting_complexity ?? 0;

      checks.push({
        id: 'check_im_draft',
        check: 'Draft angles ≥ 0.5° on all faces',
        passed: undrafted === 0,
        severity: undrafted === 0 ? 'info' : undrafted > 5 ? 'critical' : 'warning',
        actualValue: undrafted === 0 ? 'All faces drafted' : `${undrafted} undrafted face(s)`,
        threshold: '0 undrafted faces',
        ...(undrafted > 0 ? { recommendation: 'Add ≥ 0.5° draft on all pull-axis surfaces.' } : {}),
      });

      checks.push({
        id: 'check_im_undercut',
        check: 'No undercuts (single-action pull)',
        passed: undercut === 0,
        severity: undercut === 0 ? 'info' : 'critical',
        actualValue: undercut === 0 ? 'Clear' : `${undercut} undercut face(s)`,
        threshold: '0 undercut faces',
        ...(undercut > 0 ? { recommendation: 'Eliminate undercuts or design in side-action tooling.' } : {}),
      });

      if (wallNominal > 0) {
        const wallOk = wallNominal >= 1.0 && wallNominal <= 6.0;
        checks.push({
          id: 'check_im_wall_range',
          check: 'Wall thickness in moldable range (1.0–6.0 mm)',
          passed: wallOk,
          severity: wallOk ? 'info' : wallNominal < 1.0 ? 'critical' : 'warning',
          actualValue: `${wallNominal.toFixed(1)} mm`,
          threshold: '1.0–6.0 mm',
          ...(wallOk ? {} : {
            recommendation: wallNominal < 1.0
              ? 'Increase wall to ≥ 1.0 mm to ensure complete fill.'
              : 'Core out thick sections to < 6.0 mm to prevent sink marks.',
          }),
        });
      }

      const uniformityOk = uniformityRatio <= 0.40;
      checks.push({
        id: 'check_im_wall_uniformity',
        check: 'Wall uniformity (variation ≤ 40% of nominal)',
        passed: uniformityOk,
        severity: uniformityOk ? 'info' : 'warning',
        actualValue: `${(uniformityRatio * 100).toFixed(0)}% variation`,
        threshold: '≤ 40% of nominal',
        ...(uniformityOk ? {} : { recommendation: 'Uniform walls minimise warpage and differential shrinkage.' }),
      });

      const thinOk = thinViolations === 0;
      checks.push({
        id: 'check_im_thin_zones',
        check: 'No zones below 60% of nominal wall',
        passed: thinOk,
        severity: thinOk ? 'info' : 'warning',
        actualValue: thinOk ? 'None detected' : `${thinViolations} zone(s)`,
        threshold: '0 thin zones',
        ...(thinOk ? {} : { recommendation: 'Increase thin zones to ≥ 60% of nominal wall thickness.' }),
      });

      const partingOk = partingComplexity < 0.50;
      checks.push({
        id: 'check_im_parting',
        check: 'Parting line complexity acceptable (< 50%)',
        passed: partingOk,
        severity: partingOk ? 'info' : partingComplexity >= 0.75 ? 'critical' : 'warning',
        actualValue: `${(partingComplexity * 100).toFixed(0)}%`,
        threshold: '< 50%',
        ...(partingOk ? {} : { recommendation: 'Simplify parting plane to reduce flash risk and tooling cost.' }),
      });

      // Common manufacturability score check
      const score = this.extractManufacturabilityScore(cadResult);
      if (score != null) {
        const passed = score >= 60;
        checks.push({
          id: 'check_mfr_score',
          check: 'Manufacturability score',
          passed,
          severity: passed ? (score >= 80 ? 'info' : 'warning') : 'critical',
          actualValue: `${score}/100`,
          threshold: '≥ 60',
          ...(passed ? {} : { recommendation: 'Review DFM warnings and redesign flagged features.' }),
        });
      }

      return checks;
    }

    // ── Sheet Metal / CNC validation checks ───────────────────────────────────
    const isSheetMetal = family === 'sheet_metal';

    if (geo.sheetThicknessMm > 0) {
      const minThickness = isSheetMetal ? 0.8 : 1.0;
      const passed = geo.sheetThicknessMm >= minThickness;
      checks.push({
        id: 'check_wall_thickness',
        check: 'Wall thickness adequate',
        passed,
        severity: passed ? 'info' : 'warning',
        actualValue: `${geo.sheetThicknessMm.toFixed(1)} mm`,
        threshold: `≥ ${minThickness} mm`,
        ...(passed ? {} : { recommendation: 'Increase wall thickness to prevent distortion.' }),
      });
    }

    if (geo.bendCount > 0 && geo.sheetThicknessMm > 0 && geo.bendRadii.length > 0) {
      const minBendRadius = geo.sheetThicknessMm * 0.8;
      const smallestRadius = Math.min(...geo.bendRadii);
      const passed = smallestRadius >= minBendRadius;
      checks.push({
        id: 'check_bend_radius',
        check: 'Bend radius adequate',
        passed,
        severity: passed ? 'info' : 'warning',
        actualValue: `${smallestRadius.toFixed(1)} mm`,
        threshold: `≥ ${minBendRadius.toFixed(1)} mm`,
        ...(passed ? {} : { recommendation: `Increase minimum bend radius to ${minBendRadius.toFixed(1)} mm.` }),
      });
    }

    // Only validate hole count from OCC topology — STL mesh artifacts produce false positives
    if (geo.holeCount > 0 && geo.featureSource === 'step_topology') {
      const passed = geo.holeCount < 200;
      checks.push({
        id: 'check_hole_count',
        check: 'Hole count in range',
        passed,
        severity: passed ? 'info' : 'warning',
        actualValue: String(geo.holeCount),
        threshold: '≤ 200',
        ...(passed ? {} : { recommendation: 'Consider splitting into sub-assemblies.' }),
      });
    }

    const score = this.extractManufacturabilityScore(cadResult);
    if (score != null) {
      const passed = score >= 60;
      checks.push({
        id: 'check_mfr_score',
        check: 'Manufacturability score',
        passed,
        severity: passed ? (score >= 80 ? 'info' : 'warning') : 'critical',
        actualValue: `${score}/100`,
        threshold: '≥ 60',
        ...(passed ? {} : { recommendation: 'Review DFM warnings and improve feature design.' }),
      });
    }

    return checks;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // CAD ENGINE (STATELESS)
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * The process-independent fields of a dropped model, before its process is
   * known: Name and Part Number from the file name (the same rules as the full
   * analysis) and volume, surface area and the sorted bounding box from
   * cad-engine POST /measure/geometry (shared/solid_measures.py -- the same
   * measurement the full analysis reports). No family classification and no
   * feature extraction: those run once the process is chosen. Weight needs
   * the material's density and is not returned.
   */
  async measureForAutoFill(fileBuffer: Buffer, fileName: string): Promise<{
    suggestions: { name: string; partNumber: string };
    geometry: { volume: number; surfaceArea: number; boundingBox: { length: number; width: number; height: number } };
  }> {
    const ext = path.extname(fileName).toLowerCase().replace('.', '') || 'step';
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', fileBuffer, { filename: `model.${ext}`, contentType: 'application/octet-stream' });
    const response = await axios.post(`${this.cadEngineUrl}/measure/geometry`, form, {
      headers: { ...form.getHeaders(), ...(this.cadEngineApiKey && { 'X-API-Key': this.cadEngineApiKey }) },
      // OCC's STEP transfer dominates and can take minutes on large files (see callCADEngineStateless).
      timeout: 600_000,
      maxContentLength: 150 * 1024 * 1024,
    });
    const d = response.data ?? {};
    const bb = d.bounding_box ?? {};
    return {
      suggestions: { name: this.inferName(fileName), partNumber: this.generatePartNumber(fileName) },
      geometry: {
        volume: Number(d.volume_mm3) || 0,
        surfaceArea: Number(d.surface_area_mm2) || 0,
        boundingBox: { length: Number(bb.length) || 0, width: Number(bb.width) || 0, height: Number(bb.height) || 0 },
      },
    };
  }

  private async callCADEngineStateless(
    fileBuffer: Buffer,
    fileName: string,
    forceReanalysis = false,
    familyHint?: string,
  ): Promise<any> {
    const ext = path.extname(fileName).toLowerCase().replace('.', '') || 'step';
    const contentTypeMap: Record<string, string> = {
      step: 'application/step',
      stp: 'application/step',
      iges: 'application/iges',
      igs: 'application/iges',
      stl: 'model/stl',
      obj: 'application/octet-stream',
    };

    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', fileBuffer, {
      filename: `model.${ext}`,
      contentType: contentTypeMap[ext] ?? 'application/octet-stream',
    });
    form.append('strategy', 'balanced');
    form.append('bypass_format_check', 'true');
    form.append('force_reanalysis', String(forceReanalysis));
    // Real, disclosed manual override only -- main.py's family_hint short-
    // circuits detect_part_family's result. Never sent when unset, so the
    // real geometric classifier chain is what runs by default.
    if (familyHint) {
      form.append('family_hint', familyHint);
    }

    const response = await axios.post(
      `${this.cadEngineUrl}/analyze/geometry`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          ...(this.cadEngineApiKey && { 'X-API-Key': this.cadEngineApiKey }),
        },
        // Large/complex STEP files can spend several minutes inside OCC's
        // STEPControl_Reader.TransferRoots() alone (a raw OCC call, not
        // anything in this codebase) — 180s was too tight for real production
        // parts (e.g. a 48MB single-part STEP timed out here with TransferRoots
        // still running). 10 min gives large files a real chance to finish.
        timeout: 600_000,
        maxContentLength: 150 * 1024 * 1024,
      },
    );

    if (!response.data?.success) {
      throw new Error('CAD engine returned unsuccessful result');
    }
    return response.data;
  }

  private extractGeometryFromCADResult(cadResult: any): RawGeometry {
    const gf = cadResult?.geometry_features ?? {};
    const bbox = gf?.bounding_box ?? {};
    const mf = gf?.manufacturing_features ?? {};
    // Correct path: manufacturing_intelligence.features (only present for sheet_metal family)
    const smf = mf?.manufacturing_intelligence?.features ?? {};

    this.logger.debug(
      `[smf] family=${mf?.manufacturing_intelligence?.detected_family ?? 'n/a'} ` +
      `holes=${smf?.hole_count ?? 'null'} groups=${Array.isArray(smf?.hole_groups) ? smf.hole_groups.length : 0} ` +
      `bends=${smf?.bend_count ?? 'null'} thickness=${smf?.sheet_thickness_mm ?? 'null'} ` +
      `cut_length=${smf?.cut_length_mm ?? 'null'}`,
    );

    const safe = (v: any, fallback = 0): number => {
      const n = parseFloat(v);
      return isFinite(n) ? n : fallback;
    };

    // Fix 1: For CNC parts, use the feature recognizer's breakdown (through + blind holes)
    // instead of manufacturing_features.holes.count which counts every cylindrical face
    // (OD steps, groove IDs, etc.) — not just drilled/bored holes.
    const cncSummary = machiningFeatureCounts(cadResult?.machining_features);
    const resolvedHoleCount = cncSummary
      ? cncSummary.drilledHoles
      : safe(smf?.hole_count ?? mf?.holes?.count ?? gf?.feature_detection?.holes_detected, 0);

    return {
      volume: safe(gf.volume_mm3 ?? gf.estimated_volume_mm3, 0),
      surfaceArea: safe(gf.surface_area_mm2 ?? gf.surface_area_estimation, 0),
      boundingBox: {
        length: safe(bbox.length ?? bbox.x, 0),
        width: safe(bbox.width ?? bbox.y, 0),
        height: safe(bbox.height ?? bbox.z, 0),
      },
      holeCount: resolvedHoleCount,
      pocketCount: safe(cncSummary?.pockets ?? mf?.pockets?.count, 0),
      thinWallCount: (mf?.thin_walls ?? 0) > 0 || gf?.feature_detection?.thin_walls ? 1 : 0,
      bendCount: safe(smf?.bend_count, 0),
      cutLengthMm: safe(smf?.cut_length_mm, 0),
      cutLengthBreakdown: smf?.cut_length_breakdown ? {
        outerProfileMm: safe(smf.cut_length_breakdown.outer_profile_mm, 0),
        circularHolesMm: safe(smf.cut_length_breakdown.circular_holes_mm, 0),
        internalProfilesMm: safe(smf.cut_length_breakdown.internal_profiles_mm, 0),
      } : undefined,
      longestContinuousCutMm: smf?.longest_continuous_cut_mm != null ? safe(smf.longest_continuous_cut_mm, 0) : undefined,
      sharpCornerCount: smf?.sharp_corner_count != null ? safe(smf.sharp_corner_count, 0) : undefined,
      acuteCornerCount: smf?.acute_corner_count != null ? safe(smf.acute_corner_count, 0) : undefined,
      smallHoleCount: smf?.small_hole_count != null ? safe(smf.small_hole_count, 0) : undefined,
      extrudedFlangeCount: smf?.extruded_flange_count != null ? safe(smf.extruded_flange_count, 0) : undefined,
      rolledFormCount: smf?.rolled_form_count != null ? safe(smf.rolled_form_count, 0) : undefined,
      formedFeatureCount: smf?.formed_feature_count != null ? safe(smf.formed_feature_count, 0) : undefined,
      lanceCount: smf?.lance_count != null ? safe(smf.lance_count, 0) : undefined,
      bendFlangeRelationships: Array.isArray(smf?.bend_flange_relationships)
        ? smf.bend_flange_relationships.map((r: any) => ({
            bendAFaceIds: r.bend_a_face_ids ?? [],
            bendBFaceIds: r.bend_b_face_ids ?? [],
            sharedFlangeFaceId: r.shared_flange_face_id,
            flangeWidthMm: r.flange_width_mm ?? null,
            foldRelativeOrientation: r.fold_relative_orientation ?? null,
            recognitionStatus: r.recognition_status,
          }))
        : undefined,
      thinWebCount: smf?.thin_web_count != null ? safe(smf.thin_web_count, 0) : undefined,
      internalProfileCount: smf?.internal_profile_count != null ? safe(smf.internal_profile_count, 0) : undefined,
      boundingRectMm2: smf?.flat_pattern_bounding_rect_mm2 ? safe(smf.flat_pattern_bounding_rect_mm2, 0) : undefined,
      flatPatternBoundingLengthMm: smf?.flat_pattern_bounding_length_mm != null ? safe(smf.flat_pattern_bounding_length_mm, 0) : undefined,
      flatPatternBoundingWidthMm: smf?.flat_pattern_bounding_width_mm != null ? safe(smf.flat_pattern_bounding_width_mm, 0) : undefined,
      flatPatternOutlinePointsMm: Array.isArray(smf?.flat_pattern_outline_points_mm) && smf.flat_pattern_outline_points_mm.length > 0
        ? smf.flat_pattern_outline_points_mm
        : undefined,
      flatPatternHolesMm: Array.isArray(smf?.flat_pattern_holes_mm) ? smf.flat_pattern_holes_mm : undefined,
      flatPatternOutlineSource: smf?.flat_pattern_outline_source === 'wire_walk' ? 'wire_walk' : 'unavailable',
      materialUtilizationPct: smf?.material_utilization_pct != null ? safe(smf.material_utilization_pct, 0) : undefined,
      scrapAreaMm2: smf?.scrap_area_mm2 != null ? safe(smf.scrap_area_mm2, 0) : undefined,
      sheetThicknessMm: safe(smf?.sheet_thickness_mm, 0),
      pierceCount: safe(smf?.pierce_count, 0),
      rapidTraverseSec: smf?.rapid_traverse_sec != null ? safe(smf.rapid_traverse_sec, 0) : undefined,
      flatPatternAreaMm2: safe(smf?.flat_pattern_area_mm2, 0),
      // Prefer SheetMetalExtractor full-per-hole list → OCC _detect_holes_real all_diameters → unique fallback
      holeDiameters: Array.isArray(smf?.hole_diameters_mm) && smf.hole_diameters_mm.length > 0
        ? smf.hole_diameters_mm
        : Array.isArray(mf?.holes?.all_diameters) && mf.holes.all_diameters.length > 0
          ? mf.holes.all_diameters
          : [],
      // holeGroups: prefer SMF data for sheet metal; synthesize from CNC feature_graph_v2
      // for milled/turned parts where smf.hole_groups is always empty.
      holeGroups: (() => {
        if (Array.isArray(smf?.hole_groups) && smf.hole_groups.length > 0) {
          return (smf.hole_groups as Array<{ diameter_mm: number; count: number }>).filter(
            (g) => typeof g.diameter_mm === 'number' && g.diameter_mm > 0 && g.count > 0,
          );
        }
        // Synthesize from feature_graph_v2 when available (CNC parts)
        const fgv2Features = cadResult?.machining_features?.feature_graph_v2?.features;
        if (Array.isArray(fgv2Features) && fgv2Features.length > 0) {
          const map = new Map<number, number>();
          for (const f of fgv2Features as any[]) {
            const isHole =
              (f.feature_type === 'SimpleHole' && ['through', 'blind', 'threaded'].includes(f.variant))
              || (f.feature_type === 'MultiStepHole' && f.variant === 'counterbore');
            if (!isHole) continue;
            const diam = f.diameter_mm as number | undefined;
            if (!diam || diam <= 0) continue;
            const rounded = Math.round(diam * 10) / 10; // group by 0.1mm
            map.set(rounded, (map.get(rounded) ?? 0) + ((f.occurrences as any[])?.length ?? 1));
          }
          return Array.from(map.entries()).map(([diameter_mm, count]) => ({ diameter_mm, count }));
        }
        return [];
      })(),
      // Counterbore/countersink: sheet-metal-only signal (see feature_extractors.py
      // SheetMetalFeatureExtractor._detect_counterbore_countersink) — always empty
      // for CNC/other families, and empty on the STL mesh-inference fallback since
      // coaxial face pairs require real STEP topology.
      counterboreGroups: Array.isArray(smf?.counterbore_groups)
        ? smf.counterbore_groups.filter((g: any) => typeof g.diameter_mm === 'number' && g.diameter_mm > 0 && g.count > 0)
        : [],
      countersinkGroups: Array.isArray(smf?.countersink_groups)
        ? smf.countersink_groups.filter((g: any) => typeof g.diameter_mm === 'number' && g.diameter_mm > 0 && g.count > 0)
        : [],
      bendRadii: Array.isArray(smf?.bend_radii_mm) ? smf.bend_radii_mm : [],
      bendLengths: Array.isArray(smf?.bend_lengths_mm) ? smf.bend_lengths_mm : [],
      bendAngles: Array.isArray(smf?.bend_angles_deg) ? smf.bend_angles_deg : [],
      featureSource: (cncSummary != null || smf?.hole_count != null) ? 'step_topology' : 'mesh_inference',
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // FAMILY CLASSIFICATION EXTRACTION
  // ────────────────────────────────────────────────────────────────────────────

  private extractFamilyClassification(
    cadResult: any,
  ): { family: string | null; confidence: number | null; sheetMetalVetoed: boolean } {
    try {
      const mi = cadResult?.geometry_features?.manufacturing_features?.manufacturing_intelligence;
      if (!mi || mi.error) return { family: null, confidence: null, sheetMetalVetoed: false };
      // The CAD engine emits the platform's own family names
      // (cad-engine/shared/part_family.py), so the value is used as-is.
      const family: string | null = typeof mi.detected_family === 'string' ? mi.detected_family : null;
      const rawConfidence = mi.family_confidence;
      const confidence = rawConfidence != null ? parseFloat(rawConfidence) : null;
      // Python's sheet-metal impossibility veto (min bbox between ~1.4× and
      // ~3.5× the gauge → stepped solid thickness) is a hard geometric proof,
      // not a low-confidence guess — it must survive the TS heuristic override.
      const reasons: unknown[] = Array.isArray(mi.classification_reason) ? mi.classification_reason : [];
      const sheetMetalVetoed = reasons.some(
        (r) => typeof r === 'string' && r.includes('Sheet-metal veto'),
      );
      return {
        family,
        confidence: confidence !== null && isFinite(confidence) ? confidence : null,
        sheetMetalVetoed,
      };
    } catch {
      return { family: null, confidence: null, sheetMetalVetoed: false };
    }
  }

  // A CAD-detected family (detect_part_family()'s literal output) is not a
  // process/route id anywhere else in this platform — it maps to the real
  // process_taxonomy.process_group it belongs to. Previously this went
  // through MANUFACTURING_PROCESS_REGISTRY's static engine-family machine-
  // class list (a second, independent hardcoded enumeration of the granular
  // CNC classes, redundant with MachineDiscoveryService's DB-driven
  // discovery already used by the real costing path) — removed in favor of
  // a direct real-process_group mapping, since that machine-class detour
  // never changed the actual returned value (every CNC family's machine
  // classes share the same real 'Machining' process_group; the query only
  // ever needed to confirm SOME real production row exists for that group).

  private static readonly CAD_FAMILY_TO_PROCESS_GROUP: Record<string, string> = {
    sheet_metal: 'Sheet Metal',
    plastic_molded: 'Plastic Molding',
    milled: 'Machining',
    turned: 'Machining',
    mill_turn: 'Machining',
    // Die Casting Phase 1 (2026-10): detection + highlighting only, no cost
    // engine yet — process_taxonomy's real "Die Casting" rows are all seeded
    // roadmap_status='not_modeled' (migration 844), so the query below still
    // correctly returns null until that catalog is promoted to production.
    // Mapped here now so this needs no further backend change on that day.
    die_cast: 'Die Casting',
    // Same casting extractor, validated against each process's own catalog
    // (cad-engine shared/part_family.py CASTING_FAMILY_DOMAIN).
    sand_cast: 'Sand Casting',
    investment_cast: 'Casting Investment',
  };

  /**
   * The cad-engine family_hint for a user-chosen process_group label — the
   * inverse of CAD_FAMILY_TO_PROCESS_GROUP, so the forward and reverse
   * mappings can never drift apart. Machining covers milled/turned/mill_turn;
   * the first entry (milled) is the general one. A group with no CAD family
   * (Sand Casting, Assembly, ...) returns undefined: there is no extractor to
   * force, so the real classifier chain runs.
   */
  familyHintForProcessGroup(processGroup: string | null | undefined): string | undefined {
    if (!processGroup) return undefined;
    const entry = Object.entries(AutoFillService.CAD_FAMILY_TO_PROCESS_GROUP)
      .find(([, group]) => group === processGroup);
    return entry?.[0];
  }

  /**
   * Resolves a CAD-detected family to a real, live process_taxonomy label —
   * never a hardcoded process-name string. Confirms process_taxonomy has a
   * real, currently-'production' row for that family's real process_group
   * and returns it. Returns null (a disclosed gap, not a guess) when no
   * real production row exists for the group — the caller must never
   * fabricate a label itself.
   */
  private async resolveDbDrivenProcessLabel(
    cadFamily: string,
    accessToken: string,
  ): Promise<string | null> {
    const processGroup = AutoFillService.CAD_FAMILY_TO_PROCESS_GROUP[cadFamily];
    if (!processGroup) return null;

    const client = this.supabaseService.getClient(accessToken);
    const { data, error } = await client
      .from('process_taxonomy')
      .select('process_group')
      .eq('process_group', processGroup)
      .eq('roadmap_status', 'production')
      .limit(1);
    if (error || !data || data.length === 0) return null;
    return (data[0] as { process_group: string }).process_group;
  }

  /**
   * The real catalog machine (memory/machining/processes.csv, mirrored in
   * process_taxonomy under process_group 'Machining') this part needs, for the
   * upload badge -- or null when it cannot be derived.
   *
   *  - milled:    the SAME minimum milling class the route comparison gates on
   *               (requiredMilledClassFromToolAxes over the features' tool
   *               axes), so the badge can never name a machine the quote
   *               would reject; null while the axes are not available.
   *  - turned:    '2 Axis Lathe' -- the engine only calls a part turned when it
   *               has no secondary milling features, which a 2-axis lathe covers.
   *  - mill_turn: 'MillTurn' -- turned with secondary milling features.
   *
   * The name is confirmed against a live, production process_taxonomy row;
   * a name the taxonomy does not carry yields null, never a fabricated label.
   */
  private async resolveSuggestedMachine(
    family: string | null,
    featureGraph: any,
    accessToken: string,
  ): Promise<string | null> {
    let processName: string | null = null;
    if (family === 'milled') {
      // Same setup-axis rule the route comparison gates on. When it cannot be
      // derived (no tool axes yet) there is no badge machine, not a guess.
      const { rule } = await this.machiningLookup.getSetupAxisRule();
      const { required } = requiredMilledClassFromToolAxes(featureGraph?.feature_graph_v2?.features, rule);
      if (!required) return null;
      processName = required
        .split('_')
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    } else if (family === 'turned') {
      processName = '2 Axis Lathe';
    } else if (family === 'mill_turn') {
      processName = 'MillTurn';
    }
    if (!processName) return null;

    const client = this.supabaseService.getClient(accessToken);
    const { data, error } = await client
      .from('process_taxonomy')
      .select('process_name')
      .eq('process_group', AutoFillService.CAD_FAMILY_TO_PROCESS_GROUP[family!])
      .eq('process_name', processName)
      .eq('roadmap_status', 'production')
      .limit(1);
    if (error || !data || data.length === 0) {
      this.logger.warn(`[classify] catalog machine "${processName}" has no production process_taxonomy row -- no badge machine`);
      return null;
    }
    return (data[0] as { process_name: string }).process_name;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ────────────────────────────────────────────────────────────────────────────

  private sanitizeGeometry(geo: RawGeometry): RawGeometry {
    const clamp = (v: number, max: number): number =>
      Number.isFinite(v) && v >= 0 && v <= max ? v : 0;
    return {
      volume:        clamp(geo.volume, 1e10),
      surfaceArea:   clamp(geo.surfaceArea, 1e8),
      boundingBox: {
        length: clamp(geo.boundingBox.length, 10_000),
        width:  clamp(geo.boundingBox.width,  10_000),
        height: clamp(geo.boundingBox.height, 10_000),
      },
      holeCount:        Math.min(Math.max(0, geo.holeCount        ?? 0), 1000),
      pocketCount:      Math.min(Math.max(0, geo.pocketCount      ?? 0), 500),
      thinWallCount:    Math.min(Math.max(0, geo.thinWallCount    ?? 0), 100),
      bendCount:        Math.min(Math.max(0, geo.bendCount        ?? 0), 100),
      cutLengthMm:      clamp(geo.cutLengthMm, 100_000),
      cutLengthBreakdown: geo.cutLengthBreakdown,
      longestContinuousCutMm: geo.longestContinuousCutMm,
      sharpCornerCount: geo.sharpCornerCount,
      acuteCornerCount: geo.acuteCornerCount,
      smallHoleCount: geo.smallHoleCount,
      extrudedFlangeCount: geo.extrudedFlangeCount,
      rolledFormCount: geo.rolledFormCount,
      formedFeatureCount: geo.formedFeatureCount,
      lanceCount: geo.lanceCount,
      bendFlangeRelationships: geo.bendFlangeRelationships,
      thinWebCount: geo.thinWebCount,
      internalProfileCount: geo.internalProfileCount,
      rapidTraverseSec: geo.rapidTraverseSec,
      boundingRectMm2: geo.boundingRectMm2,
      flatPatternBoundingLengthMm: geo.flatPatternBoundingLengthMm,
      flatPatternBoundingWidthMm: geo.flatPatternBoundingWidthMm,
      flatPatternOutlinePointsMm: Array.isArray(geo.flatPatternOutlinePointsMm) ? geo.flatPatternOutlinePointsMm : undefined,
      flatPatternHolesMm: Array.isArray(geo.flatPatternHolesMm) ? geo.flatPatternHolesMm : undefined,
      flatPatternOutlineSource: geo.flatPatternOutlineSource,
      materialUtilizationPct: geo.materialUtilizationPct,
      scrapAreaMm2: geo.scrapAreaMm2,
      sheetThicknessMm: clamp(geo.sheetThicknessMm, 50),
      pierceCount:      Math.min(Math.max(0, geo.pierceCount      ?? 0), 500),
      flatPatternAreaMm2: clamp(geo.flatPatternAreaMm2, 1e7),
      holeDiameters: Array.isArray(geo.holeDiameters) ? geo.holeDiameters : [],
      holeGroups:    Array.isArray(geo.holeGroups)    ? geo.holeGroups    : [],
      counterboreGroups: Array.isArray(geo.counterboreGroups) ? geo.counterboreGroups : [],
      countersinkGroups: Array.isArray(geo.countersinkGroups) ? geo.countersinkGroups : [],
      bendRadii:     Array.isArray(geo.bendRadii)     ? geo.bendRadii     : [],
      bendLengths:   Array.isArray(geo.bendLengths)   ? geo.bendLengths   : [],
      bendAngles:    Array.isArray(geo.bendAngles)    ? geo.bendAngles    : [],
      featureSource: geo.featureSource ?? 'mesh_inference',
    };
  }

  private inferName(fileName: string): string {
    const base = path.basename(fileName, path.extname(fileName));
    return base
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  }

  private generatePartNumber(fileName: string): string {
    const base = path.basename(fileName, path.extname(fileName))
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 12);
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(Math.random() * 900 + 100);
    return `${base}-${date}-${rand}`;
  }

  // Calls cad-engine/drawing_analyzer.py's real POST /drawing/analyze —
  // PyMuPDF text-block extraction of the 2D drawing's title block, thread
  // callouts, dimensions, etc. (see drawing-intelligence.dto.ts for the exact
  // shape this validates against). Vector PDFs only — the parser itself
  // returns a real, disclosed fallback (not an error) for image/scanned
  // drawings, since it does text extraction, not OCR.
  //
  // The parser is treated as authoritative: this method validates its
  // response shape (never persist something malformed) but does not
  // reinterpret or reshape its field values.
  async analyzeDrawing(pdfBuffer: Buffer, partNumber?: string): Promise<DrawingIntelligenceDto> {
    const imageBase64 = pdfBuffer.toString('base64');
    const response = await axios.post(
      `${this.cadEngineUrl}/drawing/analyze`,
      { imageBase64, mediaType: 'application/pdf', ...(partNumber ? { partNumber } : {}) },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(this.cadEngineApiKey && { 'X-API-Key': this.cadEngineApiKey }),
        },
        timeout: 60_000,
        maxContentLength: 150 * 1024 * 1024,
      },
    );

    const withVersion = { ...response.data, parserVersion: DRAWING_PARSER_VERSION };
    const instance = plainToInstance(DrawingIntelligenceDto, withVersion);
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: false });
    if (errors.length > 0) {
      throw new Error(
        `/drawing/analyze returned a response that doesn't match the expected shape: ${errors.map((e) => e.toString()).join('; ')}`,
      );
    }
    return instance;
  }
}

// Returns the value from a numeric-keyed Record for the largest key ≤ value.
// Same logic as in deterministic-planner.service.ts — kept local to avoid a
// shared-utility circular dependency between bom-items and process-plan-generator.
function lookupByThresholdLocal(table: Record<number, number>, value: number): number | undefined {
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  let result: number | undefined;
  for (const k of keys) {
    if (value >= k) result = table[k];
    else break;
  }
  return result;
}
