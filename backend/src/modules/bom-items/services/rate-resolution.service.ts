import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { CalculatorCatalogService } from './calculator-catalog.service';
import { resolveLabourRate } from '../costing/shared/core/cost-engine';
import type { MHRRateInput, LhrRateSource } from '../costing/shared/core/cost-engine';
import {
  MACHINE_REGISTRY, LOCATION_INFO,
  type RateWarnThresholds, DEFAULT_RATE_WARN_THRESHOLDS,
  lhrRateWarning, classifyInspectionResource, DEFAULT_COSTING_LOCATION,
} from '../costing/shared/core/default-rates.constants';
import type { MachineClass } from '../costing/shared/core/default-rates.constants';
import { decideBenchmarkOverride } from '../costing/shared/core/engine-kernel';
import { fetchMachinePool, selectMachine } from '../costing/shared/capability/machine-selection/selector';
import { EMPTY_CAPABILITY, MACHINE_CLASS_DEFAULTS } from '../costing/shared/capability/machine-selection/seed-registry';
import type { MachineRequirement } from '../costing/shared/capability/machine-selection/physics';
import type { MachineCandidate, MachineRecommendation, MachineSelectionResult } from '../dto/machine-selection.dto';
import type { RateSnapshot } from '../../../common/exchange-rate/exchange-rate.service';
import { cachedRead } from '../costing/shared/core/request-cache';

/**
 * Every machine class an MHR (machine-hour rate) is resolved for, in one pass.
 *
 * NOT the engine registry and deliberately not derived from it — the two are
 * different questions and diverge in both directions on purpose:
 *
 *   in this list, no registered engine   compression_molding,
 *     structural_foam_molding, reaction_injection_molding — real machine
 *     classes with rates on file whose cost engines are not registered.
 *   registered engine, not in this list  surface_treatment, whose rate comes
 *     from the surface_treatment_rates table via resolveSurfaceTreatmentDbRate,
 *     not from mhr_records. Fetching it here would find nothing.
 *
 * What DOES have to hold is one direction: every registered sheet-metal
 * cutting/forming engine must appear here, because getRouteComparison() skips
 * any engine with no resolved rate (`if (!identity || !rate) continue`). A
 * route missing from this list is not reported as unpriceable — it silently
 * stops being offered at all. Locked by a test in
 * test/modules/bom-items/route-core-classes.spec.ts.
 */
export const MHR_RATE_MACHINE_CLASSES: readonly MachineClass[] = [
  'fiber_laser', 'co2_laser', 'laser_3d', 'press_brake', 'deburring', 'tapping', 'cmm', 'turret_punch', 'waterjet', 'router_2axis', 'oxyfuel_cut', 'shear', 'cut_to_length', 'laser_punch', 'plasma_cut', 'plasma_punch',
  'standard_press', 'tandem_press', 'progressive_die_press', 'roll_bending_2', 'roll_bending_3', 'roll_bending_4',
  // Real, granular primary CNC milling/turning classes — replaces the 6
  // deleted generic cnc_3ax_vmc/cnc_4ax_vmc/cnc_5ax_mc/cnc_lathe/
  // cnc_lathe_live/cnc_mill_turn buckets (Machining Engine Re-Architecture).
  '3_axis_mill', '4_axis_mill', '5_axis_mill',
  '2_axis_lathe', '3_axis_lathe', '2_axis_bar_feed_lathe_with_sub_spindle', '3_axis_bar_feed_lathe_with_sub_spindle',
  'injection_molding', 'compression_molding', 'structural_foam_molding', 'reaction_injection_molding', 'drill_press', 'pem_press', 'hole_forming',
  'gun_drill', 'deep_bore_machine', 'manual_deburr', 'cylindrical_grinder', 'jig_bore', 'jig_grind', 'internal_grinder', 'broach', 'machining_millturn', 'wire_edm',
  'machining_inspection', 'special_inspection',
];

@Injectable()
export class RateResolutionService {
  private readonly logger = new Logger(RateResolutionService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly calculatorCatalogService: CalculatorCatalogService,
  ) {}

  private physicsSelectionEnabled(): boolean {
    return process.env.ENABLE_PHYSICS_MACHINE_SELECTION !== 'false';
  }

  async resolveMHRRates(
    accessToken: string,
    // USD/USA is this app's default — never INR/India (see migration
    // 436_default_currency_usd_not_inr.sql's own doc comment for the full
    // trace of why INR ever became the fallback in this codebase). Every
    // real call site below always passes an explicit `location`, so this
    // default is a safety net for a future caller that omits it, not a
    // path any current request actually takes.
    location = 'USA',
    physics: {
      requirements: Partial<Record<MachineClass, MachineRequirement>>;
      overrides: Map<string, string>;
    } | undefined,
    family: string | undefined,
    fxRates: RateSnapshot,
    warnings: string[] = [],
    thresholds: RateWarnThresholds = DEFAULT_RATE_WARN_THRESHOLDS,
  ): Promise<{
    laser: MHRRateInput;
    /**
     * The two laser technologies, kept SEPARATE.
     *
     * `laser` above is the single Cost Guide process line -- one part has one
     * laser operation, and resolveLaserSlot picks whichever technology has a
     * real machine for the location. That collapse is correct for the summary
     * line but wrong for route comparison: fiber_laser and co2_laser are
     * distinct machine classes with distinct real fleets (204 and 120 rows
     * respectively, 41 and 24 of them in USA), and each is a genuinely
     * different way to cut the part.
     *
     * Because only the collapsed slot was published, mhrRatesByClass carried
     * one laser class, so the OTHER class had no resolved rate and its route
     * was dropped by `if (!identity || !rate) continue` -- silently, which is
     * exactly the failure MHR_RATE_MACHINE_CLASSES's doc comment warns about.
     * The registry has always defined the route (co2_laser -> 'sm-co2-laser',
     * 'CO2 Laser + Press Brake'); it simply never had a rate to be offered
     * with.
     */
    fiberLaser: MHRRateInput;
    co2Laser: MHRRateInput;
    // Root-caused 2026-09-10, confirmed directly by the user: "3D Laser
    // Cutting Machine" is a genuinely separate, separately-specced real
    // Digital Factory machine class — see default-rates.constants.ts's
    // laser_3d MACHINE_REGISTRY entry for the full history. Published the
    // same way fiberLaser/co2Laser are, for the same reason (route
    // comparison needs a rate per real machine class, not just the
    // collapsed single-line slot above). "Laser Cutting Machine" (24
    // machines) was briefly split into its own 'laser_cut' class the same
    // day before a cross-file reconciliation (machine_library.json vs
    // india_base.json) confirmed it's the same real pool as co2_laser — it
    // resolves through co2Laser above instead, no separate field needed.
    laser3d: MHRRateInput;
    pressBrake: MHRRateInput;
    deburring: MHRRateInput;
    tapping: MHRRateInput;
    inspection: MHRRateInput;
    drillPress: MHRRateInput;
    pemPress: MHRRateInput;
    holeForming: MHRRateInput;
    gunDrill: MHRRateInput;
    deepBoreMachine: MHRRateInput;
    manualDeburr: MHRRateInput;
    cylindricalGrinder: MHRRateInput;
    jigBore: MHRRateInput;
    jigGrind: MHRRateInput;
    internalGrinder: MHRRateInput;
    broach: MHRRateInput;
    // Wire EDM (memory/machining/machine/wire_edm_work_center_data.json) — same real,
    // registered-engine-and-MACHINE_REGISTRY-entry pattern as broach/gun_drill above.
    wireEdm: MHRRateInput;
    // Real, distinct Machining-domain inspection classes (memory/machining/
    // machine/inspection_usa.json, special_inspection_usa.json) — separate
    // from the shared 'cmm' class Sheet Metal/generic inspection resolves
    // through. Published so CNC-family inspectionRate: call sites can prefer
    // the real Machining-specific rate over the generic cmm fallback (same
    // preferRealRate() pattern already used for manualDeburr vs. deburring).
    machiningInspection: MHRRateInput;
    specialInspection: MHRRateInput;
    turret: MHRRateInput;
    waterjet: MHRRateInput;
    router: MHRRateInput;
    oxyfuelCut: MHRRateInput;
    shear: MHRRateInput;
    // Cut To Length Line (added 2026-09-10) — 8 real machines, a genuine
    // previously-unwired gap (migration 572/724). Published the same way
    // every other real cutting-family machine class is, for route comparison.
    cutToLength: MHRRateInput;
    laserPunch: MHRRateInput;
    plasmaCut: MHRRateInput;
    plasmaPunch: MHRRateInput;
    standardPress: MHRRateInput;
    tandemPress: MHRRateInput;
    progressiveDiePress: MHRRateInput;
    rollBending2: MHRRateInput;
    rollBending3: MHRRateInput;
    rollBending4: MHRRateInput;
    // Real, granular primary CNC milling/turning classes (Machining Engine
    // Re-Architecture) — replaces the deleted 6-member cnc3ax/cnc4ax/cnc5ax/
    // cncLathe/cncLatheLive/cncMillTurn field set. Each names one real
    // station category (migration 693); which of these are actually
    // eligible/offered for a given part is decided dynamically by
    // MachineDiscoveryService, not by which fields exist here.
    mill3ax: MHRRateInput;
    mill4ax: MHRRateInput;
    mill5ax: MHRRateInput;
    lathe2ax: MHRRateInput;
    lathe3ax: MHRRateInput;
    latheBarFeed2ax: MHRRateInput;
    latheBarFeed3ax: MHRRateInput;
    injectionMolding: MHRRateInput;
    compressionMolding: MHRRateInput;
    structuralFoamMolding: MHRRateInput;
    reactionInjectionMolding: MHRRateInput;
    benchmarkMap: Map<MachineClass, number>;
    directLaborRate: number | null;   // Sheet Metal DLR (lhr_records / lhr_benchmark_rates)
    qaInspectorRate: number | null;   // Quality inspector rate (Quality process group)
  }> {
    // Kick off LHR benchmark lookup immediately so it overlaps with the MHR DB round-trip
    const lhrRatesPromise = this.resolveLHRRates(accessToken, location, family, fxRates, warnings, thresholds);
    // Kick off the wage-grade fallback lookup the same way — independent of lhrRatesPromise.
    const wageGradeRatesPromise = this.resolveWageGradeBucketRates(accessToken, location);

    // Pass 4 placeholder — populated after the mhr_benchmark_rates query below.
    // benchmarkMap is used by both makeDefault() and applyBenchmarkOverrideIfNeeded().
    let benchmarkMap = new Map<MachineClass, number>();

    const makeDefault = (cls: MachineClass): MHRRateInput => ({
      rate: benchmarkMap.get(cls) ?? 0,
      source: (benchmarkMap.get(cls) ?? 0) > 0 ? 'default_rate' : 'no_db_rate',
      machineClass: cls,
      machineName: null,
      commodityCode: null,
    });

    // When the DB resolves a machine rate that is anomalously low (< 50% of benchmark)
    // or anomalously high (> 300% of benchmark) for the requested location, the rate
    // is almost certainly a data import error:
    //   - Too low:  a cross-location record stored in the wrong local currency
    //               (e.g. India's ₹3,200/hr Salvagnini surfacing in a USA run)
    //   - Too high: an INR rate treated as USD during Excel import and ×83.5 inflated
    //               (e.g. ₹1,138/hr laser read as $1,138 → stored as ₹95,023/hr)
    // Override to the location benchmark in both cases; mark the source so
    // appendRateWarnings() surfaces a single info note rather than per-line footnotes.
    const applyBenchmarkOverrideIfNeeded = (input: MHRRateInput, cls: MachineClass): MHRRateInput => {
      if (input.source !== 'mhr_database') return input;
      const benchmark = benchmarkMap.get(cls) ?? 0;
      if (benchmark <= 0) return input;

      const override = (reason: string): MHRRateInput => {
        this.logger.warn(
          `resolveMHRRates: ${input.machineName ?? cls} rate ${input.rate}/hr — ${reason}. ` +
          `Overriding to ${location} benchmark (${benchmark}/hr). Fix the MHR record to suppress this.`,
          'BOMItemsService',
        );
        // Preserve physics selection — machine choice stays; only the bad rate is replaced.
        return {
          rate: benchmark,
          source: 'benchmark_override',
          machineClass: cls,
          machineName: input.machineName,
          commodityCode: input.commodityCode,
          selection: input.selection,
        };
      };

      // Decision lives in engine-kernel.ts so it is directly testable — it
      // silently changes the billed rate on real quotes and had no test.
      //
      // Two fixes landed with that extraction (2026-09-05):
      //  1. A rate equal to this record's own Direct + Indirect overhead IS
      //     the canonical MHR by definition (migration 581) and can no longer
      //     be discarded. mhr_benchmark_rates holds ONE industry-average row
      //     per class for press_brake/turret_punch/waterjet (74/84/78,
      //     migration 345) while a real fleet spans a wide range by machine
      //     price, so a genuinely inexpensive machine can trip the low arm on
      //     nothing worse than being cheap. Hardening, NOT a confirmed live
      //     overcharge: a before/after capture of cost-summary (2026-09-05)
      //     showed the sheet-metal lines already resolving at their real
      //     mhr_database rate, so no billed rate was observed to change.
      //  2. The bands now come from `thresholds` (costing_settings, via
      //     loadRateWarnThresholds) instead of literal 0.50/3.0. They were
      //     already loaded and already warned about when absent — but this
      //     guard ignored them, so deploying migration 473 would have changed
      //     the warnings and not the rate actually billed.
      const decision = decideBenchmarkOverride({
        rate: input.rate,
        isDbRate: true, // early-returned above for every other source
        benchmark,
        directOverheadRate: input.directOverheadRate,
        indirectOverheadRate: input.indirectOverheadRate,
        thresholds,
      });
      return decision.override ? override(decision.reason) : input;
    };

    // When the physics path didn't run (or caught an exception and fell through),
    // synthesize a minimal MachineSelectionResult so MachineSelector always renders.
    // The candidate uses the actual resolved rate so the panel shows the right number.
    const ensureSelection = (rate: MHRRateInput, cls: MachineClass): MHRRateInput => {
      if (rate.selection) return rate;
      const cand: MachineCandidate = {
        machineId: null,
        machineName: rate.machineName,
        commodityCode: rate.commodityCode,
        machineClass: cls,
        hourlyRate: rate.rate,
        utilizationPct: 75, // ranking-only placeholder for this synthesized fallback candidate
        utilizationKnown: false,
        scheduledLoadPct: null,
        availabilityStatus: 'available',
        nextAvailableAt: null,
        maintenanceWindowStart: null,
        maintenanceWindowEnd: null,
        capability: { ...EMPTY_CAPABILITY, ...MACHINE_CLASS_DEFAULTS[cls] },
        capabilitySource: 'default_class',
        capabilityVersion: null,
        operators: rate.operators ?? null,
        laborRateUsdHr: rate.machineLaborRateUsdHr ?? null,
        pressCycleTimeS: rate.pressCycleTimeS ?? null,
        handlingConstS: rate.handlingConstS ?? null,
        handlingMassCoeffSPerKg: rate.handlingMassCoeffSPerKg ?? null,
        cutToLengthCycleConstS: rate.cutToLengthCycleConstS ?? null,
        cutToLengthCycleMassCoeffSPerKg: rate.cutToLengthCycleMassCoeffSPerKg ?? null,
        cutToLengthCutSpeedS: rate.cutToLengthCutSpeedS ?? null,
        setupTimeHr: rate.setupTimeHr ?? null,
        directOverheadRate: rate.directOverheadRate ?? null,
        indirectOverheadRate: rate.indirectOverheadRate ?? null,
      };
      const reason = rate.source === 'mhr_database'
        ? 'Selected by commodity-code lookup — import the MHR database for capability-based selection'
        : rate.source === 'benchmark_override'
        ? `DB rate for ${rate.machineName ?? 'this machine'} was anomalous for ${location} — using location benchmark rate`
        : rate.source === 'default_rate'
        ? `No machine on file for ${location} — using location benchmark rate`
        : `No machine or benchmark rate on file for ${location} — cost is $0; add an MHR record`;
      const rec: MachineRecommendation = { candidate: cand, score: 0.4, reasons: [reason] };
      const selection: MachineSelectionResult = {
        balanced: rec, cheapest: rec, fastest: rec,
        alternatives: [],
        confidence: 40,
        requirement: { kind: 'generic' },
        allowOverride: true,
        overridden: false,
      };
      return { ...rate, selection };
    };

    const allClasses: MachineClass[] = [...MHR_RATE_MACHINE_CLASSES];

    // Await LHR data — started at the top, runs concurrently with the synchronous setup above
    const lhrRates = await lhrRatesPromise.catch(() => new Map<string, { rate: number; source: LhrRateSource }>());
    const wageGradeRates = await wageGradeRatesPromise.catch(() => new Map<MachineClass, number>());

    // ── Pass 4: mhr_benchmark_rates — DB-backed location benchmarks ─────────
    // Used as: (a) final fallback rate when mhr_records has no match, and
    //          (b) guard benchmark in applyBenchmarkOverrideIfNeeded.
    // Replaces the removed LOCATION_MHR_DEFAULTS hardcoded constant.
    // mhr_benchmark_rates.mhr_usd is stored in USD; convert to local currency
    // via the caller's RateSnapshot (real FX, one read per request) — never a
    // hardcoded USD/INR pivot.
    try {
      const { data: benchData } = await this.supabaseService
        .getClient(accessToken)
        .from('mhr_benchmark_rates')
        .select('machine_name, mhr_usd, process_group')
        .eq('location', location);

      if (benchData?.length) {
        const localCurrencyCode = (LOCATION_INFO[location] ?? LOCATION_INFO['Other']).code;
        // Map mhr_benchmark_rates machine_name patterns to MachineClass via MACHINE_REGISTRY keywords
        // Collect all matching rates per class first, then compute the median.
        // The median is more representative than the minimum: for fiber_laser the DB
        // has entries from 2kW ($38/hr) to 10kW ($81/hr) — minimum would anchor
        // the fallback and sanity-check guard to the cheapest (2kW), causing the
        // 6kW selected machine to appear under-benchmarked and trigger false overrides.
        const tmpRatesPerClass = new Map<MachineClass, number[]>();
        for (const row of benchData as any[]) {
          const mhrUsd = Number(row.mhr_usd ?? 0);
          if (mhrUsd <= 0) continue;
          const machineName = ((row.machine_name as string | null) ?? '').toLowerCase();
          const processGroup = ((row.process_group as string | null) ?? '').toLowerCase();
          for (const [cls, reg] of Object.entries(MACHINE_REGISTRY) as [MachineClass, typeof MACHINE_REGISTRY[MachineClass]][]) {
            const nameKws = (reg as any).machineClassKeywords as readonly string[];
            const pgKws   = (reg as any).processGroupKeywords as readonly string[];
            // Require BOTH name and process-group to match — OR-logic pulled unrelated machines
            // (Surface Grinder, Drill Press) into every "Machining" class benchmark pool.
            const matches = nameKws.some((kw) => machineName.includes(kw.toLowerCase()))
                         && pgKws.some((kw) => processGroup.includes(kw.toLowerCase()));
            if (!matches) continue;
            const arr = tmpRatesPerClass.get(cls) ?? [];
            arr.push(mhrUsd);
            tmpRatesPerClass.set(cls, arr);
          }
        }
        // Median across power/tonnage variants — convert to local currency
        const medianOf = (arr: number[]): number => {
          const s = [...arr].sort((a, b) => a - b);
          const m = Math.floor(s.length / 2);
          return s.length % 2 === 0 ? ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2 : (s[m] ?? 0);
        };
        for (const [cls, classRates] of tmpRatesPerClass) {
          benchmarkMap.set(cls, medianOf(classRates) * fxRates.convertStrict('USD', localCurrencyCode));
        }
      }
    } catch {
      // Non-critical — no benchmarks means guard skips and fallback is rate: 0
    }

    const buildOutput = (resolved: Map<MachineClass, MHRRateInput>) => {
      const get = (cls: MachineClass) => {
        const raw = resolved.get(cls) ?? makeDefault(cls);
        const r = ensureSelection(applyBenchmarkOverrideIfNeeded(raw, cls), cls);
        // This exact machine's own usd_lhr_total (machine_library.json's
        // labor_rate_usd_hr for benchmarked rows) takes precedence over the
        // location+process_group lhr_records/lhr_benchmark_rates lookup —
        // explicit, approved exception (2026-08-27) to that being the sole
        // labor-rate source; falls back to it when this machine has none.
        // Between those two sits the wage-grade bucket average
        // (resolveWageGradeBucketRates, 2026-09-03) — only populated for
        // classes with a real, sourced wage_grade (today: Sheet Metal via
        // migration 643, Injection Molding via migration 645); every other
        // class (Machining, and any class with no real wage_grade data) has
        // no entry and falls straight through to the process-group rate,
        // unchanged.
        const lhr = lhrRates.get(cls);
        const perMachineLhr = r.machineLaborRateUsdHr;
        const wageGradeRate = wageGradeRates.get(cls);
        const labour = resolveLabourRate(perMachineLhr, wageGradeRate, lhr);
        return {
          ...r,
          labourRate: labour.rate,
          labourRateSource: labour.source,
        };
      };
      // "Laser Cutting" is one process line regardless of which real laser
      // technology performs it — fiber and CO2 (co2_laser, e.g. AMADA
      // Quattro) are two separate machine classes/pools, but this part only
      // has one laser operation, so pick whichever class actually has a real
      // machine on file (source: 'mhr_database') for this location. Prefer
      // fiber_laser when both are real (today's existing behavior,
      // unchanged) or neither is — this only changes behavior for a
      // location/part whose laser machine is genuinely CO2-classed.
      const resolveLaserSlot = () => {
        const fiber = get('fiber_laser');
        const co2 = get('co2_laser');
        if (co2.source === 'mhr_database' && fiber.source !== 'mhr_database') return co2;
        return fiber;
      };
      return {
        laser:            resolveLaserSlot(),
        // Published separately so BOTH laser routes can be offered — see the
        // return type's doc comment. resolveLaserSlot stays exactly as it was
        // for the single Cost Guide line.
        fiberLaser:       get('fiber_laser'),
        co2Laser:         get('co2_laser'),
        laser3d:          get('laser_3d'),
        pressBrake:       get('press_brake'),
        deburring:        get('deburring'),
        tapping:          get('tapping'),
        inspection:       get('cmm'),
        drillPress:       get('drill_press'),
        pemPress:         get('pem_press'),
        holeForming:      get('hole_forming'),
        gunDrill:         get('gun_drill'),
        deepBoreMachine:  get('deep_bore_machine'),
        manualDeburr:     get('manual_deburr'),
        cylindricalGrinder: get('cylindrical_grinder'),
        jigBore:          get('jig_bore'),
        jigGrind:         get('jig_grind'),
        internalGrinder:  get('internal_grinder'),
        broach:           get('broach'),
        wireEdm:          get('wire_edm'),
        machiningInspection: get('machining_inspection'),
        specialInspection:   get('special_inspection'),
        turret:           get('turret_punch'),
        waterjet:         get('waterjet'),
        router:           get('router_2axis'),
        oxyfuelCut:       get('oxyfuel_cut'),
        shear:            get('shear'),
        cutToLength:      get('cut_to_length'),
        laserPunch:       get('laser_punch'),
        plasmaCut:        get('plasma_cut'),
        plasmaPunch:      get('plasma_punch'),
        standardPress:    get('standard_press'),
        tandemPress:      get('tandem_press'),
        progressiveDiePress: get('progressive_die_press'),
        rollBending2:     get('roll_bending_2'),
        rollBending3:     get('roll_bending_3'),
        rollBending4:     get('roll_bending_4'),
        mill3ax:          get('3_axis_mill'),
        mill4ax:          get('4_axis_mill'),
        mill5ax:          get('5_axis_mill'),
        lathe2ax:         get('2_axis_lathe'),
        lathe3ax:         get('3_axis_lathe'),
        latheBarFeed2ax:  get('2_axis_bar_feed_lathe_with_sub_spindle'),
        latheBarFeed3ax:  get('3_axis_bar_feed_lathe_with_sub_spindle'),
        injectionMolding: get('injection_molding'),
        compressionMolding: get('compression_molding'),
        structuralFoamMolding: get('structural_foam_molding'),
        reactionInjectionMolding: get('reaction_injection_molding'),
        benchmarkMap, // exposed for appendRateWarnings benchmark guard
        // Direct labor and QA inspector rates surfaced for cost-engine input.
        // fiber_laser maps to 'Sheet Metal' process group → DLR for all SM ops.
        // cmm maps to 'Quality' process group → QA inspector rate.
        directLaborRate: lhrRates.get('fiber_laser')?.rate ?? null,
        qaInspectorRate: lhrRates.get('cmm')?.rate ?? null,
      };
    };

    // ── Physics-based capability selection (new engine) ───────────────────────
    // Selects by physical capability + fit/utilization/cost scoring instead of
    // lowest-rate string matching. Falls back to the legacy path on any failure.
    if (physics && this.physicsSelectionEnabled()) {
      try {
        const pool = await fetchMachinePool(
          this.supabaseService.getClient(accessToken),
          location,
        );
        const resolved = new Map<MachineClass, MHRRateInput>();
        for (const cls of allClasses) {
          const requirement: MachineRequirement =
            physics.requirements[cls] ?? { kind: 'generic' };
          const selection = selectMachine({
            pool,
            location,
            machineClass: cls,
            requirement,
            overrideMachineId: physics.overrides.get(cls) ?? null,
            fallbackRate: benchmarkMap.get(cls) ?? 0,
          });
          const cand = selection.balanced.candidate;
          // A real machine always means 'mhr_database'. Without one, selectMachine's
          // fallback candidate carries either the real benchmark rate (fallbackRate
          // above, > 0 → 'default_rate') or a genuine $0 when no benchmark exists
          // either ('no_db_rate') — never label a $0 fallback as if a default rate
          // were actually applied, that's exactly the silent-fallback mislabeling
          // this replaced.
          resolved.set(cls, {
            rate: cand.hourlyRate,
            source: cand.machineId ? 'mhr_database' : (cand.hourlyRate > 0 ? 'default_rate' : 'no_db_rate'),
            machineClass: cls,
            machineName: cand.machineName,
            commodityCode: cand.commodityCode,
            selection,
            operators: cand.operators,
            machineLaborRateUsdHr: cand.laborRateUsdHr,
            pressCycleTimeS: cand.pressCycleTimeS,
            handlingConstS: cand.handlingConstS,
            handlingMassCoeffSPerKg: cand.handlingMassCoeffSPerKg,
            cutToLengthCycleConstS: cand.cutToLengthCycleConstS,
            cutToLengthCycleMassCoeffSPerKg: cand.cutToLengthCycleMassCoeffSPerKg,
            cutToLengthCutSpeedS: cand.cutToLengthCutSpeedS,
            setupTimeHr: cand.setupTimeHr,
            // Carried so applyBenchmarkOverrideIfNeeded can recognise a rate
            // that IS the canonical Direct + Indirect sum (migration 581).
            directOverheadRate: cand.directOverheadRate,
            indirectOverheadRate: cand.indirectOverheadRate,
          });
        }
        return buildOutput(resolved);
      } catch (e) {
        // No silent zero-rates: log loudly, then fall through to the legacy lookup
        this.logger.error(
          `Physics machine selection failed — falling back to legacy rate lookup: ${e instanceof Error ? e.message : e}`,
          undefined,
          'BOMItemsService',
        );
      }
    }

    // Prefer fully_burdened_local_per_hr (machine + labour), fall back through
    // total_machine_hour_rate, then manual_mhr_value.
    // fully_burdened_local_per_hr is machine + labour combined — never prefer it here.
    // This legacy resolution feeds the same eMithranTerms() path (cost-engine.ts) as the
    // physics selector, which always separately adds its own direct-labour term; using
    // the burdened figure as "the machine rate" would double-count labour. See the
    // matching fix/comment on pickRate() in machine-selection/selector.ts.
    const pickRate = (row: any): number => {
      const mhr = Number(row.total_machine_hour_rate ?? 0);
      const man = Number(row.manual_mhr_value ?? 0);
      return mhr > 0 ? mhr : man;
    };

    try {
      // Pass 1 — exact commodity_code match (seeded / legacy records)
      const allCodes = allClasses.flatMap((cls) => [...MACHINE_REGISTRY[cls].commodityCodes]);

      const { data: primaryData, error } = await this.supabaseService
        .getClient(accessToken)
        .from('mhr_records')
        .select(
          'machine_name, commodity_code, process_group, machine_class, ' +
          'total_machine_hour_rate, manual_mhr_value, fully_burdened_local_per_hr',
        )
        .in('commodity_code', allCodes)
        .eq('location', location);

      const resolved = new Map<MachineClass, MHRRateInput>();

      if (!error && primaryData?.length) {
        // Build index: commodity_code → ALL records (keep all so name-based filtering
        // below can reject off-class records sharing the same commodity code, e.g.
        // "Default Deslag" tagged SM-LASER-2K must not win for the fiber_laser class)
        type Hit = { rate: number; machineName: string };
        const dbIndex = new Map<string, Hit[]>();
        for (const row of primaryData as any[]) {
          const rate = pickRate(row);
          if (rate <= 0) continue;
          const hits = dbIndex.get(row.commodity_code) ?? [];
          hits.push({ rate, machineName: row.machine_name ?? '' });
          dbIndex.set(row.commodity_code, hits);
        }

        for (const cls of allClasses) {
          // Collect every record across all commodity codes for this class
          const allCandidates: Array<{ code: string; hit: Hit }> = [];
          for (const code of MACHINE_REGISTRY[cls].commodityCodes as readonly string[]) {
            for (const hit of dbIndex.get(code) ?? []) {
              allCandidates.push({ code, hit });
            }
          }
          if (allCandidates.length === 0) continue;

          // Prefer records whose machine name contains a class keyword; fall back to
          // all commodity-code matches only if no named record exists.
          const nameKws = MACHINE_REGISTRY[cls].machineClassKeywords;
          const nameFiltered = allCandidates.filter((c) =>
            nameKws.some((kw) => c.hit.machineName.toLowerCase().includes(kw.toLowerCase())),
          );
          const pool = nameFiltered.length > 0 ? nameFiltered : allCandidates;
          const best = pool.reduce((a, b) => (a.hit.rate <= b.hit.rate ? a : b));

          resolved.set(cls, {
            rate: best.hit.rate,
            source: 'mhr_database',
            machineClass: cls,
            machineName: best.hit.machineName,
            commodityCode: best.code,
          });
        }
      }

      // Pass 2 — keyword fallback for imported records (commodity_code = processGroup text)
      const classesNeedingFallback = allClasses.filter((cls) => !resolved.has(cls));

      if (classesNeedingFallback.length > 0) {
        const orParts: string[] = [];
        for (const cls of classesNeedingFallback) {
          for (const kw of MACHINE_REGISTRY[cls].processGroupKeywords)
            orParts.push(`process_group.ilike.%${kw}%`);
          for (const kw of MACHINE_REGISTRY[cls].machineClassKeywords)
            orParts.push(`machine_class.ilike.%${kw}%`);
        }

        const { data: fbData } = await this.supabaseService
          .getClient(accessToken)
          .from('mhr_records')
          .select(
            'machine_name, commodity_code, process_group, machine_class, ' +
            'total_machine_hour_rate, manual_mhr_value, fully_burdened_local_per_hr',
          )
          .eq('location', location)
          .or(orParts.join(','));

        if (fbData?.length) {
          // For each fallback row, find which classes it best matches by keyword priority:
          // machine_class keyword match wins over process_group keyword match.
          type FbCandidate = { rate: number; machineName: string; commodityCode: string };
          const fbBest = new Map<MachineClass, FbCandidate>();

          for (const row of fbData as any[]) {
            const rate = pickRate(row);
            if (rate <= 0) continue;
            const mcLower = (row.machine_class ?? '').toLowerCase();
            const pgLower = (row.process_group ?? '').toLowerCase();

            for (const cls of classesNeedingFallback) {
              if (resolved.has(cls)) continue;

              const nameKws = MACHINE_REGISTRY[cls].machineClassKeywords;
              const mcMatch = nameKws.some((kw) => mcLower.includes(kw.toLowerCase()));
              const pgMatch = !mcMatch && MACHINE_REGISTRY[cls].processGroupKeywords.some((kw) =>
                pgLower.includes(kw.toLowerCase()),
              );

              if (!mcMatch && !pgMatch) continue;

              // Prevent cross-class contamination: lathes must not resolve milling classes
              // (real granular classes — 3_axis_mill/4_axis_mill/5_axis_mill — replacing
              // the deleted cnc_3ax_vmc/cnc_4ax_vmc/cnc_5ax_mc buckets).
              const isLatheRecord = /lathe|turning|sliding.head|sub.?spindle/i.test(mcLower + ' ' + pgLower);
              const isVMCClass = ['3_axis_mill', '4_axis_mill', '5_axis_mill'].includes(cls as string);
              if (isVMCClass && isLatheRecord) continue;

              // When only process_group matched (less specific), also require the machine_name
              // to contain a class keyword so "Default Deslag" (process_group=Laser) can't win
              // the fiber_laser class by lowest rate.
              if (pgMatch) {
                const mnLower = (row.machine_name ?? '').toLowerCase();
                const nameMatch = nameKws.some((kw) => mnLower.includes(kw.toLowerCase()));
                if (!nameMatch) continue;
              }

              const existing = fbBest.get(cls);
              if (!existing || rate < existing.rate) {
                fbBest.set(cls, { rate, machineName: row.machine_name, commodityCode: row.commodity_code ?? '' });
              }
            }
          }

          for (const [cls, hit] of fbBest) {
            resolved.set(cls, {
              rate: hit.rate,
              source: 'mhr_database',
              machineClass: cls,
              machineName: hit.machineName,
              commodityCode: hit.commodityCode,
            });
          }
        }
      }

      // Pass 3 — cross-location fallback: pick from ANY user mhr_records when the
      // factory location doesn't match the user's stored records (e.g. India records
      // shown for a USA factory). Uses mhr_usd_per_hour (USD-normalised) when available
      // so cross-currency rates don't produce 80× inflated numbers.
      const classesP3 = allClasses.filter((cls) => !resolved.has(cls));
      if (classesP3.length > 0) {
        try {
          const orPartsP3: string[] = [];
          for (const cls of classesP3) {
            for (const kw of MACHINE_REGISTRY[cls].machineClassKeywords) {
              orPartsP3.push(`machine_class.ilike.%${kw}%`);
              // Also search machine_name: catches "Injection Molding 100T" when machine_class is null/coded.
              orPartsP3.push(`machine_name.ilike.%${kw}%`);
            }
            for (const kw of MACHINE_REGISTRY[cls].processGroupKeywords) {
              orPartsP3.push(`process_group.ilike.%${kw}%`);
              orPartsP3.push(`machine_name.ilike.%${kw}%`);
            }
          }
          if (orPartsP3.length > 0) {
            const { data: p3Data } = await this.supabaseService
              .getClient(accessToken)
              .from('mhr_records')
              .select(
                'machine_name, commodity_code, process_group, machine_class, ' +
                'mhr_usd_per_hour, total_machine_hour_rate, fully_burdened_local_per_hr, manual_mhr_value',
              )
              .or(orPartsP3.join(','));

            if (p3Data?.length) {
              type P3Hit = { rate: number; machineName: string; commodityCode: string };
              const p3Best = new Map<MachineClass, P3Hit>();
              for (const row of p3Data as any[]) {
                // Prefer mhr_usd_per_hour for cross-location so INR rates aren't used raw as USD
                const usd  = Number(row.mhr_usd_per_hour ?? 0);
                const fb   = Number(row.fully_burdened_local_per_hr ?? 0);
                const mhr  = Number(row.total_machine_hour_rate ?? 0);
                const man  = Number(row.manual_mhr_value ?? 0);
                const rate = usd > 0 ? usd : fb > 0 ? fb : mhr > 0 ? mhr : man;
                if (rate <= 0) continue;
                const mcLower = (row.machine_class ?? '').toLowerCase();
                const mnLower = (row.machine_name ?? '').toLowerCase();
                const pgLower = (row.process_group ?? '').toLowerCase();
                for (const cls of classesP3) {
                  if (resolved.has(cls)) continue;
                  const nameKws = MACHINE_REGISTRY[cls].machineClassKeywords;
                  const mcMatch = nameKws.some((kw) => mcLower.includes(kw.toLowerCase()) || mnLower.includes(kw.toLowerCase()));
                  const pgMatch = !mcMatch && MACHINE_REGISTRY[cls].processGroupKeywords.some((kw) => pgLower.includes(kw.toLowerCase()));
                  if (!mcMatch && !pgMatch) continue;
                  const existing = p3Best.get(cls);
                  if (!existing || rate < existing.rate) {
                    p3Best.set(cls, { rate, machineName: row.machine_name, commodityCode: row.commodity_code ?? '' });
                  }
                }
              }
              for (const [cls, hit] of p3Best) {
                resolved.set(cls, {
                  rate: hit.rate,
                  source: 'mhr_database',
                  machineClass: cls,
                  machineName: hit.machineName,
                  commodityCode: hit.commodityCode,
                });
              }
            }
          }
        } catch { /* non-critical — hardcoded defaults remain as last resort */ }
      }

      return buildOutput(resolved);
    } catch {
      return buildOutput(new Map());
    }
  }

  /**
   * Resolves labour hour rates (local currency/hr) keyed by machine class.
   *
   * Priority:  user's imported `lhr_records` (avg per process_group) → `lhr_benchmark_rates`
   * This mirrors how MHR resolves: DB records first, benchmark/defaults as fallback.
   * Non-critical: any DB failure returns an empty map so cost totals are never blocked.
   *
   * Which lhr_records/lhr_benchmark_rates process_group each machine class
   * bills against comes from process_calculator_mappings.lhr_process_group
   * (migration 424), via resolveProcessIdentities — not a hardcoded table
   * here. Several classes bill at a genuinely different, more specific skill
   * tier than their hierarchy processGroup (turret_punch → 'Turret',
   * deburring → 'Deburr', cmm → 'Quality', the CNC classes → 'CNC Machining',
   * injection_molding → 'Plastic Molding' (migration 733 — migration 424 had
   * originally set this to 'Plastic & Rubber' and it was never updated when
   * migration 647 renamed lhr_benchmark_rates/lhr_records to 'Plastic Molding',
   * a real join-miss bug 733 also fixes) — see migration 424's own comment
   * for the real wage-data sources behind each). tapping's correct tier is
   * family-dependent (sheet-metal/milled/turned parts each tap on a different
   * real process_calculator_mappings row) — resolveProcessIdentities already
   * picks the row matching this part's family via applicable_families, so
   * its resolved processGroup is correct per-family with no special case
   * needed here.
   */
  async resolveLHRRates(
    accessToken: string,
    location: string,
    family: string | undefined,
    fxRates: RateSnapshot,
    warnings: string[] = [],
    thresholds: RateWarnThresholds = DEFAULT_RATE_WARN_THRESHOLDS,
  ): Promise<Map<string, { rate: number; source: LhrRateSource }>> {
    const identities = await this.resolveProcessIdentities(accessToken, undefined, family);
    const classGroups = new Map<string, string>();
    for (const [cls, identity] of Object.entries(identities)) {
      classGroups.set(cls, identity.lhrProcessGroup ?? identity.processGroup);
    }

    // P0.6 (Machine Economics, provenance-visibility phase): this function's 4
    // passes already resolve labor rate with real precedence (own-location
    // import > benchmark > cross-location import > plausibility guard) but
    // used to collapse to a bare number — the machine-rate side already had
    // this exact visibility via MHRRateInput.source/rateSource (surfaced in
    // Cost Summary as "MHR DB"/"Benchmark"/etc.); labor rate had none. Track
    // which pass actually won per PROCESS GROUP (the resolution unit), then
    // map to per-class source below — same shape, not a new mechanism.
    const result = new Map<string, { rate: number; source: LhrRateSource }>();
    const pgRate = new Map<string, number>();
    const pgSource = new Map<string, LhrRateSource>();

    try {
      const client = this.supabaseService.getClient(accessToken);

      // ── Pass 1: user-imported lhr_records (exact location match) ───────────
      // lhr column is local currency/hr — same unit as mhrRates so no FX needed.
      // Average across skill levels per process group; skip zero/null rows.
      const { data: userRows } = await client
        .from('lhr_records')
        .select('process_group, lhr')
        .eq('location', location)
        .gt('lhr', 0)
        .not('process_group', 'is', null);

      if (userRows?.length) {
        const pgSum = new Map<string, { sum: number; count: number }>();
        for (const row of userRows as any[]) {
          const rate = Number((row as any).lhr ?? 0);
          const pg = ((row as any).process_group as string | null)?.trim();
          if (rate <= 0 || !pg) continue;
          const acc = pgSum.get(pg) ?? { sum: 0, count: 0 };
          pgSum.set(pg, { sum: acc.sum + rate, count: acc.count + 1 });
        }
        for (const [pg, { sum, count }] of pgSum) {
          pgRate.set(pg, sum / count);
          pgSource.set(pg, 'lhr_database');
        }
      }

      // ── Pass 2: lhr_benchmark_rates fills any process group still missing ──
      // Reads lhr_usd_effective (real, researched USD/hr) and converts to
      // this location's local currency DYNAMICALLY via the live exchange
      // rate snapshot — mirrors resolveMHRRates' own Pass 4 exactly, and
      // deliberately does NOT read this table's own `lhr` (local-currency)
      // column. Confirmed live: migration 361 seeded `lhr` equal to
      // `lhr_usd_effective` for every non-USD location (e.g. India's Sheet
      // Metal row: lhr=1.73, lhr_usd_effective=1.73 — should have been
      // ~144 INR, not 1.73) — a real ₹1.73/$1.73 duplication bug, not a
      // researched local rate. Converting from the one correctly-researched
      // USD figure at read time avoids relying on that column at all, and
      // — like MHR's benchmark pass — never goes stale relative to
      // exchange_rates (a static local-currency seed column would).
      const allGroups = [...new Set(classGroups.values())];
      const missingGroups = allGroups.filter((pg) => !pgRate.has(pg));
      const localCurrencyCode = (LOCATION_INFO[location] ?? LOCATION_INFO['Other']).code;
      const usdToLocal = fxRates.convertStrict('USD', localCurrencyCode);

      if (missingGroups.length > 0) {
        const { data: benchRows } = await client
          .from('lhr_benchmark_rates')
          .select('process_group, lhr_usd_effective')
          .eq('location', location)
          .in('process_group', missingGroups);

        for (const row of (benchRows ?? []) as any[]) {
          const usdRate = Number((row as any).lhr_usd_effective ?? 0);
          const pg = ((row as any).process_group as string | null)?.trim();
          if (usdRate > 0 && pg) {
            pgRate.set(pg, usdRate * usdToLocal);
            pgSource.set(pg, 'lhr_benchmark');
          }
        }
      }

      // ── Pass 3: cross-location fallback from lhr_records (any location) ──
      // Triggered when user has LHR records for a different factory (e.g. India records
      // for a USA run). Uses lhr_usd_effective so cross-currency rates stay in USD.
      const missingGroupsP3 = allGroups.filter((pg) => !pgRate.has(pg));
      if (missingGroupsP3.length > 0) {
        const { data: p3Rows } = await client
          .from('lhr_records')
          .select('process_group, lhr, lhr_usd_effective')
          .in('process_group', missingGroupsP3)
          .gt('lhr', 0)
          .not('process_group', 'is', null);

        if (p3Rows?.length) {
          // Use separate accumulators for USD-effective vs local-currency rows.
          // Averaging across both would silently mix units (e.g. $5 USD with ₹95 INR).
          // Prefer the USD accumulator; fall back to local-currency only for process
          // groups that have no USD-effective rows at all.
          const p3UsdSum   = new Map<string, { sum: number; count: number }>();
          const p3LocalSum = new Map<string, { sum: number; count: number }>();
          for (const row of p3Rows as any[]) {
            const usdRate   = Number((row as any).lhr_usd_effective ?? 0);
            const localRate = Number((row as any).lhr ?? 0);
            const pg = ((row as any).process_group as string | null)?.trim();
            if (!pg) continue;
            if (usdRate > 0) {
              const acc = p3UsdSum.get(pg) ?? { sum: 0, count: 0 };
              p3UsdSum.set(pg, { sum: acc.sum + usdRate, count: acc.count + 1 });
            } else if (localRate > 0) {
              const acc = p3LocalSum.get(pg) ?? { sum: 0, count: 0 };
              p3LocalSum.set(pg, { sum: acc.sum + localRate, count: acc.count + 1 });
            }
          }
          for (const [pg, { sum, count }] of p3UsdSum) {
            if (!pgRate.has(pg)) { pgRate.set(pg, sum / count); pgSource.set(pg, 'lhr_cross_location'); }
          }
          for (const [pg, { sum, count }] of p3LocalSum) {
            if (!pgRate.has(pg) && !p3UsdSum.has(pg)) { pgRate.set(pg, sum / count); pgSource.set(pg, 'lhr_cross_location'); }
          }
        }
      }

      // ── Pass 4: plausibility guard — compare whatever won (Pass 1/2/3)
      // against this SAME location+group's real benchmark, regardless of
      // which pass actually resolved it. This is the check that would have
      // caught the ₹12,062/hr live bug: Pass 1 (lhr_records) can silently
      // win with a stale/corrupted import row, which short-circuits Pass 2
      // (benchmark) entirely since the group is no longer "missing" — so the
      // correct benchmark must be fetched here unconditionally, purely as a
      // comparison reference, never as a value that gets applied.
      const resolvedGroups = [...pgRate.keys()];
      if (resolvedGroups.length > 0) {
        const { data: allBenchRows } = await client
          .from('lhr_benchmark_rates')
          .select('process_group, lhr_usd_effective')
          .eq('location', location)
          .in('process_group', resolvedGroups);

        const benchmarkByGroup = new Map<string, number>();
        for (const row of (allBenchRows ?? []) as any[]) {
          const usdRate = Number((row as any).lhr_usd_effective ?? 0);
          const pg = ((row as any).process_group as string | null)?.trim();
          if (usdRate > 0 && pg) benchmarkByGroup.set(pg, usdRate * usdToLocal);
        }

        for (const pg of resolvedGroups) {
          const rate = pgRate.get(pg);
          if (rate == null) continue;
          const warning = lhrRateWarning(pg, location, rate, benchmarkByGroup.get(pg), thresholds);
          if (warning && !warnings.includes(warning)) warnings.push(warning);
        }
      }

      // ── Map machine classes to resolved process-group rates ──────────────
      for (const [cls, pg] of classGroups) {
        const rate = pgRate.get(pg);
        if (rate != null) result.set(cls, { rate, source: pgSource.get(pg) ?? 'lhr_database' });
      }
    } catch {
      // Non-critical — LHR display degrades gracefully; cost totals are unaffected
    }

    return result;
  }

  /**
   * Wage-grade labour fallback: when a machine class has no specific real
   * machine selected, average the real usd_lhr_total of every real
   * mhr_records row (this location) sharing that class's own real
   * wage_grade value, instead of falling straight to the coarser
   * process_group average. Sits between the per-machine-specific rate and
   * the existing process-group fallback — never above the per-machine
   * rate, never fabricates a value: a class with no real wage_grade data
   * simply gets no entry, and callers fall through to the unchanged
   * process-group fallback exactly as before.
   *
   * Real coverage today (data-driven, not hardcoded to a domain list —
   * grows automatically the moment a domain's mhr_records.wage_grade is
   * backfilled with real data, no code change needed):
   *   - Sheet Metal: 12 real machine classes (migration 643, replacing
   *     migration 577's fabricated Skilled/Semi-Skilled/Unskilled guesses
   *     with real "N - Metal" grades from memory/sheetmetal/wages.png).
   *   - Injection Molding: 4 real machine classes — injection_molding,
   *     compression_molding, structural_foam_molding,
   *     reaction_injection_molding (migration 645, real "N - Plastic"
   *     grades from memory/Injection/wagegrade.png).
   *   - Machining: none yet — mhr_records has no real per-machine data for
   *     any CNC class today (only 3 placeholder rows total), so there's
   *     nothing real to average regardless of wage-grade backfill.
   *
   * Grouping is by wage_grade VALUE (e.g. every real '3 - Metal' row,
   * regardless of which Sheet Metal category it belongs to; separately,
   * every real '3 - Plastic' row across Injection Molding's 4 classes) —
   * a real grade label reflects a real skill tier that several distinct
   * processes can share, and pooling within a tier gives each average a
   * real, multi-machine sample instead of averaging a single category's
   * often-small machine count. Sheet Metal's "N - Metal" and Injection
   * Molding's "N - Plastic" grade strings never collide, so this naturally
   * never pools rates across domains without needing an explicit domain
   * filter.
   */
  async resolveWageGradeBucketRates(
    accessToken: string,
    location: string,
  ): Promise<Map<MachineClass, number>> {
    const result = new Map<MachineClass, number>();
    try {
      const { data } = await this.supabaseService
        .getClient(accessToken)
        .from('mhr_records')
        .select('machine_class, wage_grade, usd_lhr_total')
        .eq('location', location)
        .not('wage_grade', 'is', null)
        .not('machine_class', 'is', null)
        .gt('usd_lhr_total', 0);

      if (!data?.length) return result;

      const gradeSum = new Map<string, { sum: number; count: number }>();
      for (const row of data as any[]) {
        const grade = row.wage_grade as string;
        const rate = Number(row.usd_lhr_total);
        const acc = gradeSum.get(grade) ?? { sum: 0, count: 0 };
        gradeSum.set(grade, { sum: acc.sum + rate, count: acc.count + 1 });
      }
      const gradeAvg = new Map<string, number>();
      for (const [grade, { sum, count }] of gradeSum) gradeAvg.set(grade, sum / count);

      const classGrade = new Map<string, string>();
      for (const row of data as any[]) {
        if (!classGrade.has(row.machine_class)) classGrade.set(row.machine_class, row.wage_grade);
      }
      for (const [cls, grade] of classGrade) {
        const avg = gradeAvg.get(grade);
        if (avg != null) result.set(cls as MachineClass, avg);
      }
    } catch {
      // Non-critical — empty map means every class falls through to the
      // existing process-group fallback, same as any other resolution miss.
    }
    return result;
  }

  /**
   * Resolves the real (process_group, process_route, operation) identity for a set
   * of machine classes, straight from process_calculator_mappings — the same table
   * ProcessCostDialog's hierarchy picker reads. Used so the cost engine's process
   * lines (e.g. "Laser Cutting") can carry a real, DB-backed operation instead of
   * reusing their cosmetic display label as a fake operation (that produced a real
   * bug: saved records where processRoute === operation === the display label,
   * which never matches a mapping row — see migration 372).
   *
   * One representative active row per machine class (lowest display_order) — a
   * machine class can legitimately map to several operations (e.g. fiber_laser →
   * 'Fiber Laser Cut' or 'Laser Cut'); this picks a stable default. Non-critical:
   * any DB failure or missing class is simply absent from the returned map, and
   * callers must treat that as "no known identity" rather than fabricating one.
   *
   * Also surfaces `lhrProcessGroup` — the real lhr_records/lhr_benchmark_rates
   * process_group this machine class is billed against (migration 424's
   * process_calculator_mappings.lhr_process_group column), null when the
   * class's real labour tier already equals its hierarchy processGroup.
   * resolveLHRRates is this field's only consumer today, but it's returned
   * for every caller since it's the same row already fetched, not an extra
   * query — see that method for why a per-class hardcoded group map was
   * replaced by this DB-driven lookup.
   *
   * machineClasses omitted (or undefined) fetches every active machine class
   * on file, keyed by whatever distinct machine_class values come back —
   * used by resolveLHRRates, which needs every class's billing group, not a
   * caller-enumerated subset.
   */
  async resolveProcessIdentities(
    accessToken: string,
    machineClasses?: string[],
    family?: string,
  ): Promise<Record<string, { processGroup: string; processRoute: string; operation: string; lhrProcessGroup: string | null }>> {
    const classes = machineClasses ? [...new Set(machineClasses.filter(Boolean))] : null;
    if (classes && classes.length === 0) return {};

    try {
      // Filtered from the one shared catalog fetch rather than querying per
      // class -- same predicates (active, machine_class present, optional
      // class filter, display_order order), one round trip for the request.
      const catalog = await this.calculatorCatalogService.loadCalculatorCatalog(accessToken);
      if (catalog.mappingsError) {
        this.logger.warn(`resolveProcessIdentities: ${catalog.mappingsError.message}`, 'BOMItemsService');
        return {};
      }
      const classFilter = classes ? new Set(classes) : null;
      const data = catalog.mappings.filter((row: any) =>
        row.machine_class != null && (!classFilter || classFilter.has(row.machine_class)),
      );

      const toIdentity = (row: any) => ({
        processGroup: row.process_group,
        processRoute: row.process_route,
        operation: row.operation,
        lhrProcessGroup: row.lhr_process_group ?? null,
      });

      const targetClasses = classes ?? [...new Set((data as any[]).map((r) => r.machine_class as string))];
      const result: Record<string, { processGroup: string; processRoute: string; operation: string; lhrProcessGroup: string | null }> = {};
      for (const cls of targetClasses) {
        const rows = (data as any[]).filter((r) => r.machine_class === cls); // already display_order-sorted
        if (rows.length === 0) continue;
        // A machine class can have several active routes (e.g. tapping is done
        // on sheet-metal, milled, AND turned parts, each a different real
        // process_route in the DB — applicable_families on that row is how the
        // catalog itself declares which part family it's for, set via the
        // Calculators/Process admin UI, not inferred in code). Prefer the row
        // whose applicable_families lists this part's family; fall back to the
        // lowest-display_order row (existing behaviour) when no row is scoped
        // to this family, e.g. the class has only one generic route on file.
        const familyMatch = family
          ? rows.find((r) => Array.isArray(r.applicable_families) && r.applicable_families.includes(family))
          : undefined;
        result[cls] = toIdentity(familyMatch ?? rows[0]);
      }
      return result;
    } catch (err: any) {
      this.logger.warn(`resolveProcessIdentities failed: ${err.message}`, 'BOMItemsService');
      return {};
    }
  }

  // User overrides: processKey (machine class) → forced mhr_records.id.
  // Scoped by Digital Factory location — an override recorded for India must
  // never force its machine (or its ₹ rate) into a USA/China/Germany costing.
  async fetchMachineOverrides(
    bomItemId: string,
    accessToken: string,
    location: string,
  ): Promise<Map<string, string>> {
    const overrides = new Map<string, string>();
    const client = this.supabaseService.getClient(accessToken);
    try {
      let { data, error } = await client
        .from('bom_item_machine_overrides')
        .select('process_key, mhr_record_id')
        .eq('bom_item_id', bomItemId)
        .eq('location', location);
      if (error && /column|schema cache/i.test(error.message)) {
        // Migration 329 pending — location column absent. Pre-329 overrides are
        // unscoped; only honour them for the default location rather than let a
        // stale pick leak into every country (the exact bug 329 fixes).
        if (location !== DEFAULT_COSTING_LOCATION) return overrides;
        ({ data, error } = await client
          .from('bom_item_machine_overrides')
          .select('process_key, mhr_record_id')
          .eq('bom_item_id', bomItemId));
      }
      if (error) return overrides;
      for (const row of data ?? []) {
        if (row.process_key && row.mhr_record_id) overrides.set(row.process_key, row.mhr_record_id);
      }
    } catch {
      // Table missing (migration 326 pending) — no overrides
    }
    return overrides;
  }

  // eMithran-style manual overrides: field_key = 'mat_rate' | '<process>::rate' |
  // '<process>::cycleMin'. Scoped by location for the same reason as machine
  // overrides — an India rate override must not silently apply after switching
  // the Digital Factory to USA.
  async fetchCostOverrides(
    bomItemId: string,
    accessToken: string,
    location: string,
  ): Promise<Map<string, number>> {
    const overrides = new Map<string, number>();
    try {
      const { data, error } = await this.supabaseService
        .getClient(accessToken)
        .from('bom_item_cost_overrides')
        .select('field_key, value')
        .eq('bom_item_id', bomItemId)
        .eq('location', location);
      if (error) return overrides;
      for (const row of data ?? []) {
        const v = Number(row.value);
        if (row.field_key && Number.isFinite(v)) overrides.set(row.field_key, v);
      }
    } catch {
      // Table missing (migration 330 pending) — no overrides
    }
    return overrides;
  }

  /**
   * Resolves a real, CMM-specific machine rate for inspection lines that
   * escalate to the 'cmm' InspectionMethod — separate from resolveMHRRates'
   * own `inspection` field (which resolves whatever single 'cmm'-class
   * machine the tenant's pool scores best, e.g. a cheap manual inspection
   * bench — correct for the visual/caliper/height_gauge tiers, but wrong for
   * an actual CMM-tier check, which needs a dedicated, meaningfully more
   * expensive CMM machine, not a bench charged at bench rates).
   *
   * Real → benchmark → generic-inspection-rate fallback, same 3-pass
   * convention as resolveMHRRates' own get(), just filtered to machine names
   * that actually indicate CMM equipment rather than every 'cmm'-class row
   * (which in this schema also covers inspection benches/gauges — see
   * default-rates.ts's cmm keyword registry).
   */
  async resolveCmmSpecificRate(
    accessToken: string,
    location: string,
    rates: RateSnapshot,
    warnings: string[],
  ): Promise<MHRRateInput> {
    const client = this.supabaseService.getClient(accessToken);

    try {
      // Shared with the sibling inspection-rate resolver, which reads the same
      // cmm pool and differs only in its in-memory CMM/non-CMM filter.
      const realRows = await cachedRead(`mhr:cmm:${location}`, async () => {
        const { data } = await client
          .from('mhr_records')
          .select('id, machine_name, machine_class, total_machine_hour_rate, manual_mhr_value, is_manual_entry, commodity_code, setup_time_hr')
          .eq('machine_class', 'cmm')
          .eq('location', location);
        return data;
      });
      const realCmm = (realRows ?? [])
        .filter((r: any) => classifyInspectionResource(r.machine_class, r.machine_name) === 'CMM')
        .map((r: any) => ({
          id: r.id as string,
          machineName: r.machine_name as string,
          rate: Number(r.is_manual_entry ? r.manual_mhr_value : r.total_machine_hour_rate) || 0,
          commodityCode: r.commodity_code ?? null,
          // Real per-CMM program/fixture/datum-alignment setup time, when
          // staged — was selected nowhere in this resolver before, so a real
          // CMM's own setup_time_hr was unreachable even when present. See
          // finalizeInspectionLine's CMM setup fix (inspection-engine.ts).
          setupTimeHr: r.setup_time_hr != null ? Number(r.setup_time_hr) || null : null,
        }))
        .filter((r) => r.rate > 0)
        .sort((a, b) => a.rate - b.rate)[0];
      if (realCmm) {
        return {
          rate: realCmm.rate, source: 'mhr_database', machineClass: 'cmm',
          machineName: realCmm.machineName, commodityCode: realCmm.commodityCode,
          mhrRecordId: realCmm.id, setupTimeHr: realCmm.setupTimeHr,
        };
      }

      const benchRows = await cachedRead(`mhr-benchmark:${location}`, async () => {
        const { data } = await client
          .from('mhr_benchmark_rates')
          .select('id, machine_name, mhr_usd, process_group, machine_class')
          .eq('location', location);
        return data;
      });
      const localCurrencyCode = (LOCATION_INFO[location] ?? LOCATION_INFO['Other']).code;
      const qualityPgKws = MACHINE_REGISTRY.cmm.processGroupKeywords;
      const cmmBench = (benchRows ?? [])
        .filter((r: any) =>
          classifyInspectionResource(r.machine_class, r.machine_name) === 'CMM' && Number(r.mhr_usd ?? 0) > 0 &&
          qualityPgKws.some((kw) => (r.process_group ?? '').toLowerCase().includes(kw.toLowerCase())))
        .sort((a: any, b: any) => Number(a.mhr_usd) - Number(b.mhr_usd))[0];
      if (cmmBench != null) {
        return {
          rate: Number(cmmBench.mhr_usd) * rates.convertStrict('USD', localCurrencyCode),
          source: 'benchmark_override', machineClass: 'cmm',
          machineName: 'CMM Machine (benchmark)', commodityCode: null,
          benchmarkMhrId: `bm-mhr-${cmmBench.id}`,
        };
      }
    } catch {
      // Non-critical — falls through to the generic inspection rate below
    }

    // Unresolved, not substituted. This used to return the caller's generic
    // inspection-bench rate, so a CMM-tier check acquired a machine cost from a
    // different, cheaper resource — and said so in the same breath ("likely
    // understates real CMM cost"), which means the number was known to be wrong
    // at the moment it was produced. A missing CMM resource is a data gap; the
    // engine already treats a rate-0 'no_db_rate' as exactly that and charges no
    // machine cost for it (see planInspection's own rate selection).
    //
    // Deliberately NOT downgraded to visual inspection either: the method stays
    // 'cmm' — the part still needs a CMM check — only its machine cost is
    // unresolved. Real QA labour is a separately resolved, real rate and is
    // unaffected.
    warnings.push(
      `No dedicated CMM machine on file for ${location} (real or benchmark) — the CMM-tier inspection ` +
      `check is unresolved and carries no machine cost. Add a CMM to mhr_records, or a ${location} ` +
      `CMM benchmark rate, to quote it.`,
    );
    return {
      rate: 0, source: 'no_db_rate', machineClass: 'cmm',
      machineName: null, commodityCode: null,
    };
  }

  /**
   * Resolves a real, non-CMM inspection-resource rate (manual bench/gauge
   * equipment) for the visual/caliper/height_gauge InspectionMethod tiers —
   * the mirror image of resolveCmmSpecificRate: same 'cmm'-class row pool
   * (this schema has no separate machine_class for bench-type inspection
   * equipment), same real → benchmark → gap fallback order, but EXCLUDING
   * CMM_NAME_PATTERN matches instead of requiring them, so a visual/caliper/
   * height_gauge line can never end up silently priced at real CMM
   * equipment's rate just because resolveMHRRates' cost/utilization scoring
   * happened to prefer it that request. Confirmed live (2026-08-09): every
   * tested location has a real, distinct, cheaper "Manual Inspection Bench"
   * row alongside its "CMM Machine" row (e.g. India: bench $5/hr vs CMM
   * $8/hr) — this filter is what makes using it deterministic rather than
   * an accident of scoring.
   */
  async resolveGenericInspectionRate(
    accessToken: string,
    location: string,
    rates: RateSnapshot,
    warnings: string[],
  ): Promise<MHRRateInput> {
    const client = this.supabaseService.getClient(accessToken);
    const gap: MHRRateInput = { rate: 0, source: 'no_db_rate', machineClass: 'cmm', machineName: null, commodityCode: null };

    try {
      // Shared with the sibling inspection-rate resolver, which reads the same
      // cmm pool and differs only in its in-memory CMM/non-CMM filter.
      // Column list must match resolveCmmSpecificRate's exactly -- both share
      // the `mhr:cmm:${location}` cache key/entry, so whichever of the two
      // resolvers runs first determines what's cached for the other.
      const realRows = await cachedRead(`mhr:cmm:${location}`, async () => {
        const { data } = await client
          .from('mhr_records')
          .select('id, machine_name, machine_class, total_machine_hour_rate, manual_mhr_value, is_manual_entry, commodity_code, setup_time_hr')
          .eq('machine_class', 'cmm')
          .eq('location', location);
        return data;
      });
      const realBench = (realRows ?? [])
        .filter((r: any) => classifyInspectionResource(r.machine_class, r.machine_name) !== 'CMM')
        .map((r: any) => ({
          id: r.id as string,
          machineName: r.machine_name as string,
          rate: Number(r.is_manual_entry ? r.manual_mhr_value : r.total_machine_hour_rate) || 0,
          commodityCode: r.commodity_code ?? null,
        }))
        .filter((r) => r.rate > 0)
        .sort((a, b) => a.rate - b.rate)[0];
      if (realBench) {
        return {
          rate: realBench.rate, source: 'mhr_database', machineClass: 'cmm',
          machineName: realBench.machineName, commodityCode: realBench.commodityCode,
          mhrRecordId: realBench.id,
        };
      }

      const benchRows = await cachedRead(`mhr-benchmark:${location}`, async () => {
        const { data } = await client
          .from('mhr_benchmark_rates')
          .select('id, machine_name, mhr_usd, process_group, machine_class')
          .eq('location', location);
        return data;
      });
      const localCurrencyCode = (LOCATION_INFO[location] ?? LOCATION_INFO['Other']).code;
      const qualityPgKws = MACHINE_REGISTRY.cmm.processGroupKeywords;
      const benchOnly = (benchRows ?? [])
        .filter((r: any) =>
          classifyInspectionResource(r.machine_class, r.machine_name) !== 'CMM' && Number(r.mhr_usd ?? 0) > 0 &&
          qualityPgKws.some((kw) => (r.process_group ?? '').toLowerCase().includes(kw.toLowerCase())))
        .sort((a: any, b: any) => Number(a.mhr_usd) - Number(b.mhr_usd))[0];
      if (benchOnly) {
        return {
          rate: Number(benchOnly.mhr_usd) * rates.convertStrict('USD', localCurrencyCode),
          source: 'benchmark_override', machineClass: 'cmm',
          machineName: `${benchOnly.machine_name} (benchmark)`, commodityCode: null,
          benchmarkMhrId: `bm-mhr-${benchOnly.id}`,
        };
      }
    } catch {
      // Non-critical — falls through to the genuine no_db_rate gap below
    }

    warnings.push(
      `No dedicated inspection-bench resource on file for ${location} (real or benchmark) — visual/caliper/` +
      `height_gauge inspection is costed at labor-only, machine cost is a genuine $0.`,
    );
    return gap;
  }

  // MHR/LHR plausibility-guard thresholds are business/costing POLICY, not an
  // algorithmic constant — read once per request from `costing_settings`
  // (migration 473), the SAME table/convention cost-aggregation.service.ts
  // and location-comparison.service.ts already use for sga_pct/profit_pct.
  // Falls back to DEFAULT_RATE_WARN_THRESHOLDS with a disclosed warning only
  // if the table is empty — identical convention to SGA/profit's own fallback.
  async loadRateWarnThresholds(accessToken: string, warnings: string[]): Promise<RateWarnThresholds> {
    try {
      const { data } = await this.supabaseService
        .getClient(accessToken)
        .from('costing_settings')
        .select('key, value')
        .in('key', ['rate_warn_low_fraction', 'rate_warn_high_fraction']);

      const settingsMap = new Map<string, number>();
      for (const row of data ?? []) settingsMap.set(row.key as string, Number(row.value));

      const lowFraction = settingsMap.get('rate_warn_low_fraction');
      const highFraction = settingsMap.get('rate_warn_high_fraction');
      if (lowFraction == null || highFraction == null) {
        warnings.push(
          'rate_warn_low_fraction/rate_warn_high_fraction not found in costing_settings — using built-in defaults (50%/300%); deploy migration 473 to make these configurable.',
        );
        return DEFAULT_RATE_WARN_THRESHOLDS;
      }
      return { lowFraction, highFraction };
    } catch {
      warnings.push('costing_settings unavailable — MHR/LHR plausibility thresholds using built-in defaults (50%/300%).');
      return DEFAULT_RATE_WARN_THRESHOLDS;
    }
  }
}
