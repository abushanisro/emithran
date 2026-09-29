import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { CalculatorCatalogService } from './calculator-catalog.service';
import type { MHRRateInput } from '../costing/shared/core/cost-engine';
import {
  LOCATION_INFO, classifyInspectionResource, DEFAULT_COSTING_LOCATION,
} from '../costing/shared/core/default-rates.constants';
import type { MachineClass } from '../costing/shared/core/default-rates.constants';
import { fetchMachinePool, selectMachine } from '../costing/shared/capability/machine-selection/selector';
import type { MachineRequirement } from '../costing/shared/capability/machine-selection/physics';
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
 *   registered engine, not in this list  surface_treatment, costed by the
 *     reference surface-treatment engine (SecondaryProcessService, machine
 *     classes surface_<process>), not through this resolver.
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
  'gun_drill', 'deep_bore_machine', 'manual_deburr', 'cylindrical_grinder', 'jig_bore', 'jig_grind', 'internal_grinder', 'broach', 'machining_millturn', 'wire_edm', 'hob_machine', 'simultaneous_turning',
  'machining_inspection', 'special_inspection',
];

@Injectable()
export class RateResolutionService {
  private readonly logger = new Logger(RateResolutionService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly calculatorCatalogService: CalculatorCatalogService,
  ) {}

  async resolveMHRRates(
    accessToken: string,
    location: string,
    // Part-specific capability requirements and user machine overrides.
    // Omitted means generic requirements and no overrides — still the same
    // real machine pool, never a different lookup.
    physics: {
      requirements: Partial<Record<MachineClass, MachineRequirement>>;
      overrides: Map<string, string>;
    } | undefined,
    fxRates: RateSnapshot,
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
    surfaceGrinder: MHRRateInput;
    shaver: MHRRateInput;
    broach: MHRRateInput;
    // Wire EDM (memory/machining/machine/wire_edm_work_center_data.json) — same real,
    // registered-engine-and-MACHINE_REGISTRY-entry pattern as broach/gun_drill above.
    wireEdm: MHRRateInput;
    // Hob Machine — gear/spline tooth cutting (AxiGroove); see cost-machining-engine.ts Hobbing line.
    hobMachine: MHRRateInput;
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
    // Real, distinct multi-spindle automatic-lathe fleet (registered engine,
    // real rate — see its own MACHINE_REGISTRY entry). Not yet in
    // MachineDiscoveryService's discovered primary-candidate set, same
    // current state as machining_millturn below — resolvable/costable when
    // explicitly selected, not yet auto-offered as a route-comparison
    // candidate.
    simultaneousTurning: MHRRateInput;
    // Real 5-axis mill-turn fleet (migrations 737/738/753). Seeded as a
    // primary_turning route role by migration 780, so MachineDiscoveryService
    // offers it as a turning candidate — it needs its resolved rate here or the
    // candidate is silently filtered out of every turning route comparison.
    machiningMillturn: MHRRateInput;
    injectionMolding: MHRRateInput;
    compressionMolding: MHRRateInput;
    structuralFoamMolding: MHRRateInput;
    reactionInjectionMolding: MHRRateInput;
    /**
     * The blanket labour rate for lines whose machine carries none. Always
     * null: labour is each machine's own memory/ LHR (see get() below), and no
     * process-group, wage-grade or benchmark average stands in for it.
     */
    directLaborRate: number | null;
    /**
     * QA inspector labour rate: the selected inspection machine's own memory/
     * LHR (class cmm). null when no inspection machine exists for this location.
     */
    qaInspectorRate: number | null;
  }> {
    // ONE source for every machine and labour rate below: a real mhr_records
    // row, chosen by selectMachine() for this class and location. Since
    // migration 805 every mhr_records row is memory/-backed.
    //
    // There is deliberately no substitute of any kind — no mhr_benchmark_rates
    // median, no benchmark override of a real rate, no legacy commodity-code or
    // keyword lookup, no other country, no lhr_records / lhr_benchmark_rates /
    // wage-grade average. A class with no real machine here resolves to rate 0
    // with source 'no_db_rate', which every engine treats as "not costed" and
    // names in a warning; it is never shown or charged as a price.
    const pool = await fetchMachinePool(this.supabaseService.getClient(accessToken), location);
    const requirements = physics?.requirements ?? {};
    const overrides = physics?.overrides ?? new Map<string, string>();
    const localCurrencyCode = (LOCATION_INFO[location] ?? LOCATION_INFO['Other']).code;
    // mhr_records.total_machine_hour_rate is stored in the location own
    // currency; usd_lhr_total is USD. Labour is converted so the two can be
    // added on one line — they were previously summed unconverted, which is
    // only correct for USD locations.
    const usdToLocal = fxRates.convertStrict('USD', localCurrencyCode);

    const get = (cls: MachineClass): MHRRateInput => {
      const selection = selectMachine({
        pool,
        location,
        machineClass: cls,
        requirement: requirements[cls] ?? { kind: 'generic' },
        overrideMachineId: overrides.get(cls) ?? null,
      });
      const cand = selection.balanced.candidate;
      const real = cand.machineId != null;
      const labourUsd = real ? cand.laborRateUsdHr : null;
      const labourRate = labourUsd != null && labourUsd > 0 ? labourUsd * usdToLocal : null;
      return {
        rate: real ? cand.hourlyRate : 0,
        source: real ? 'mhr_database' : 'no_db_rate',
        machineClass: cls,
        machineName: cand.machineName,
        commodityCode: cand.commodityCode,
        selection,
        operators: cand.operators,
        machineLaborRateUsdHr: cand.laborRateUsdHr,
        labourRate,
        labourRateSource: labourRate != null ? 'mhr_machine_specific' : 'no_lhr_rate',
        pressCycleTimeS: cand.pressCycleTimeS,
        handlingConstS: cand.handlingConstS,
        handlingMassCoeffSPerKg: cand.handlingMassCoeffSPerKg,
        cutToLengthCycleConstS: cand.cutToLengthCycleConstS,
        cutToLengthCycleMassCoeffSPerKg: cand.cutToLengthCycleMassCoeffSPerKg,
        cutToLengthCutSpeedS: cand.cutToLengthCutSpeedS,
        numberSpindles: cand.numberSpindles,
        drumIndexTimeS: cand.drumIndexTimeS,
        transferTimeS: cand.transferTimeS,
        stockFeedTimeS: cand.stockFeedTimeS,
        speedSynchronizationTimeS: cand.speedSynchronizationTimeS,
        setupTimeHr: cand.setupTimeHr,
        directOverheadRate: cand.directOverheadRate,
        indirectOverheadRate: cand.indirectOverheadRate,
      };
    };

    // "Laser Cutting" is one process line regardless of which real laser
    // technology performs it — fiber and CO2 (co2_laser, e.g. AMADA Quattro)
    // are two separate machine classes/pools, but this part only has one laser
    // operation, so pick whichever class actually has a real machine for this
    // location. Prefer fiber_laser when both are real or neither is.
    const fiberLaser = get('fiber_laser');
    const co2Laser = get('co2_laser');
    const laser = co2Laser.source === 'mhr_database' && fiberLaser.source !== 'mhr_database' ? co2Laser : fiberLaser;
    const inspection = get('cmm');

    return {
      laser,
      // Published separately so BOTH laser routes can be offered — see the
      // return type doc comment.
      fiberLaser,
      co2Laser,
      laser3d:          get('laser_3d'),
      pressBrake:       get('press_brake'),
      deburring:        get('deburring'),
      tapping:          get('tapping'),
      inspection,
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
      surfaceGrinder:   get('reciprocating_surface_grinder'),
      shaver:           get('shaver'),
      broach:           get('broach'),
      wireEdm:          get('wire_edm'),
      hobMachine:       get('hob_machine'),
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
      simultaneousTurning: get('simultaneous_turning'),
      machiningMillturn: get('machining_millturn'),
      injectionMolding: get('injection_molding'),
      compressionMolding: get('compression_molding'),
      structuralFoamMolding: get('structural_foam_molding'),
      reactionInjectionMolding: get('reaction_injection_molding'),
      directLaborRate: null,
      qaInspectorRate: inspection.labourRate ?? null,
    };
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
    } catch (err: any) {
      this.logger.error(`resolveCmmSpecificRate: CMM machine read failed for ${location}: ${err?.message ?? err}`);
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
      `No CMM machine in HR Rates for ${location} — the CMM-tier inspection check is not costed. ` +
      `Add the machine to memory/ and seed it to quote it.`,
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
    } catch (err: any) {
      this.logger.error(`resolveGenericInspectionRate: inspection machine read failed for ${location}: ${err?.message ?? err}`);
    }

    warnings.push(
      `No inspection-bench machine in HR Rates for ${location} — visual/caliper/height_gauge inspection ` +
      `carries no machine cost. Add the machine to memory/ and seed it to cost it.`,
    );
    return gap;
  }
}
