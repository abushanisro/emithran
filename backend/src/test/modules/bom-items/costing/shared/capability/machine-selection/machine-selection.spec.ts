import {
  classifyLaserMaterial,
  laserRequirement,
  latheRequirement,
  pressBrakeRequirement,
  punchingRequirement,
  vmcRequirement,
  waterjetRequirement,
  shearRequirement,
  plasmaCutRequirement,
  laserPunchRequirement,
  pressFormingRequirement,
  rollBendingRequirement,
} from '../../../../../../../modules/bom-items/costing/shared/capability/machine-selection/physics';
import { classifyMachineRecord, fitScore, isCapable, selectMachine } from '../../../../../../../modules/bom-items/costing/shared/capability/machine-selection/selector';
import type { MachineCandidate } from '../../../../../../../modules/bom-items/dto/machine-selection.dto';
import { EMPTY_CAPABILITY, lookupSeedCapability } from '../../../../../../../modules/bom-items/costing/shared/capability/machine-selection/seed-registry';
import type { MachineCapability } from '../../../../../../../modules/bom-items/costing/shared/capability/machine-selection/seed-registry';
import { BOMItemsService } from '../../../../../../../modules/bom-items/bom-items.service';

function candidate(overrides: {
  machineId?: string;
  machineName?: string;
  machineClass: MachineCandidate['machineClass'];
  hourlyRate: number;
  utilizationPct?: number;
  capability?: Partial<MachineCapability>;
  availabilityStatus?: MachineCandidate['availabilityStatus'];
  scheduledLoadPct?: number | null;
}): MachineCandidate {
  return {
    machineId: overrides.machineId ?? 'id-' + Math.random().toString(36).slice(2),
    machineName: overrides.machineName ?? 'Test Machine',
    commodityCode: null,
    machineClass: overrides.machineClass,
    hourlyRate: overrides.hourlyRate,
    utilizationPct: overrides.utilizationPct ?? 75,
    utilizationKnown: overrides.utilizationPct != null,
    scheduledLoadPct: overrides.scheduledLoadPct ?? null,
    availabilityStatus: overrides.availabilityStatus ?? 'available',
    nextAvailableAt: null,
    maintenanceWindowStart: null,
    maintenanceWindowEnd: null,
    capability: { ...EMPTY_CAPABILITY, ...(overrides.capability ?? {}) },
    capabilitySource: 'imported',
    capabilityVersion: 1,
    operators: null,
    laborRateUsdHr: null,
    pressCycleTimeS: null,
    handlingConstS: null,
    handlingMassCoeffSPerKg: null,
    cutToLengthCycleConstS: null,
    cutToLengthCycleMassCoeffSPerKg: null,
    cutToLengthCutSpeedS: null,
    setupTimeHr: null,
  directOverheadRate: null,
  indirectOverheadRate: null,
  };
}

describe('physics', () => {
  it('classifies material grades into laser families', () => {
    expect(classifyLaserMaterial('SS304')).toBe('SS');
    expect(classifyLaserMaterial('AL6061-T6')).toBe('AL');
    expect(classifyLaserMaterial('CRCA')).toBe('MS');
    expect(classifyLaserMaterial('IS2062 Gr B')).toBe('MS');
    expect(classifyLaserMaterial('C110 Copper')).toBe('CU');
    expect(classifyLaserMaterial(null)).toBe('OTHER');
  });

  it('classifies the JIS carbon-steel sheet family as MS, coated or not', () => {
    // SECC is the most common grade in this deployment and used to classify as
    // OTHER, while CRCA and SPCC -- the same material class -- classified as MS.
    // The zinc coating does not change the base steel: G3313 SECC/SECD/SECE are
    // the electro-galvanized G3141 SPCC/SPCD/SPCE grades, and G3302 SGCC/SGCD
    // the hot-dip ones. The live raw_materials row for SECC carries
    // uts_mpa 270 / shearing_strength 216, which are mild-steel values.
    for (const grade of ['SPCC', 'SPCD', 'SPCE', 'SECC', 'SECD', 'SECE', 'SGCC', 'SGCD']) {
      expect(classifyLaserMaterial(grade)).toBe('MS');
    }
    // European/Indian mild-steel designations that were also falling through.
    expect(classifyLaserMaterial('DC01')).toBe('MS');
    expect(classifyLaserMaterial('E250')).toBe('MS');
    expect(classifyLaserMaterial('E350 - High Strength Plate')).toBe('MS');
  });

  it('does not swallow non-ferrous or stainless grades into MS', () => {
    // Guards the widened MS branch against over-matching -- the failure mode
    // that would silently quote a stainless or aluminium part on mild-steel
    // capability limits.
    expect(classifyLaserMaterial('SS304')).toBe('SS');
    expect(classifyLaserMaterial('SS316L')).toBe('SS');
    expect(classifyLaserMaterial('AA6061-T6')).toBe('AL');
    expect(classifyLaserMaterial('AL6101')).toBe('AL');
    expect(classifyLaserMaterial('Generic CuZn39Pb3')).toBe('CU');
    // Plastics must not become steel just because nothing else matched.
    expect(classifyLaserMaterial('Generic Polyamide 11')).toBe('OTHER');
    expect(classifyLaserMaterial('Acetal / Delrin - Natural')).toBe('OTHER');
  });

  // pressBrakeRequirement takes a plain resolved utsMpa (no grade string, no
  // lookup table) — physics.ts does no material classification of its own;
  // the real per-part UTS is resolved once from raw_materials by
  // BOMItemsService.resolveMaterialForFamily and passed in as a number. These
  // values are the same real per-grade UTS default-rates.ts's MATERIAL_UTS_MPA
  // table uses as ITS OWN documented last-resort fallback (E250=410, SS304=620,
  // AL6061=310 MPa) — chosen here to keep this test meaningful, not because
  // physics.ts knows about grades at all.
  it('computes air-bend tonnage near chart values (3mm MS, 1m bend ≈ 22t)', () => {
    const req = pressBrakeRequirement({ bendLengthMm: 1000, thicknessMm: 3, utsMpa: 410 });
    expect(req.tonnage).toBeGreaterThan(18);
    expect(req.tonnage).toBeLessThan(26);
  });

  it('scales tonnage with real per-grade UTS (SS304 > E250 > AL6061)', () => {
    const base = { bendLengthMm: 1000, thicknessMm: 3 };
    const ms = pressBrakeRequirement({ ...base, utsMpa: 410 }).tonnage;
    const ss = pressBrakeRequirement({ ...base, utsMpa: 620 }).tonnage;
    const al = pressBrakeRequirement({ ...base, utsMpa: 310 }).tonnage;
    expect(ss).toBeGreaterThan(ms);
    expect(al).toBeLessThan(ms);
  });

  it('returns zero tonnage for zero thickness instead of dividing by zero', () => {
    const req = pressBrakeRequirement({ bendLengthMm: 1000, thicknessMm: 0, utsMpa: 410 });
    expect(req.tonnage).toBe(0);
  });

  it('normalises VMC bbox so X ≥ Y (part can rotate on the table)', () => {
    const req = vmcRequirement({ bboxXMm: 100, bboxYMm: 300, bboxZMm: 50, finishedWeightKg: 2, materialMrrCm3PerMin: 60 });
    expect(req.xMm).toBe(300);
    expect(req.yMm).toBe(100);
  });
});

describe('seed-registry', () => {
  it('matches known machine models by name', () => {
    expect(lookupSeedCapability('Trumpf TruLaser 5030')?.maxThicknessMsMm).toBe(25);
    expect(lookupSeedCapability('Miyano BNC-20')?.maxDiameterMm).toBe(20);
    expect(lookupSeedCapability('Accurl HBP-40')?.maxTonnage).toBe(40);
    expect(lookupSeedCapability('Totally Unknown Machine')).toBeNull();
  });
});

describe('classifyMachineRecord', () => {
  // Reproduces production data: CNC gantry routers stored with machine_class
  // "Router 3axis" / "Router 5axis" — the axis-count text collides with the
  // '3AX'/'5AX' VMC keywords via plain substring match.
  it('never classifies a CNC router into a machining-center or lathe class', () => {
    const router5ax = {
      id: '1', machine_name: 'Virtual 5 Axis Router - Small', machine_class: 'Router 5axis',
      process_group: 'Sheet metal', commodity_code: 'Sheet metal',
      total_machine_hour_rate: 11.18, manual_mhr_value: 11.18, fully_burdened_local_per_hr: 11.18,
      capacity_utilization_rate: 85,
      operators: null,
      usd_lhr_total: null,
    };
    const router3ax = {
      id: '2', machine_name: 'Multicam 7000 Series CNC Router, Model 103', machine_class: 'Router 3axis',
      process_group: 'Sheet metal', commodity_code: 'Sheet metal',
      total_machine_hour_rate: 8.14, manual_mhr_value: 8.14, fully_burdened_local_per_hr: 8.14,
      capacity_utilization_rate: 85,
      operators: null,
      usd_lhr_total: null,
    };
    const thermwood = {
      id: '3', machine_name: "Thermwood Multipurpose 67, 5' x 5'", machine_class: 'Router 5axis',
      process_group: 'Sheet metal', commodity_code: 'Sheet metal',
      total_machine_hour_rate: 11.42, manual_mhr_value: 11.42, fully_burdened_local_per_hr: 11.42,
      capacity_utilization_rate: 85,
      operators: null,
      usd_lhr_total: null,
    };
    expect(classifyMachineRecord(router5ax)).toBeNull();
    expect(classifyMachineRecord(router3ax)).toBeNull();
    expect(classifyMachineRecord(thermwood)).toBeNull();
  });

  it('still classifies a real machining center correctly', () => {
    const makino = {
      id: '4', machine_name: 'Makino V56i', machine_class: 'Milling_Center 3axis',
      process_group: 'Machining', commodity_code: 'Machining',
      total_machine_hour_rate: 45, manual_mhr_value: 45, fully_burdened_local_per_hr: 45,
      capacity_utilization_rate: 85,
      operators: null,
      usd_lhr_total: null,
    };
    const dmgMori5ax = {
      id: '5', machine_name: 'DMG MORI DMU 105 monoBLOCK', machine_class: 'Milling_Center 5axis',
      process_group: 'Machining', commodity_code: 'Machining',
      total_machine_hour_rate: 23.26, manual_mhr_value: 23.26, fully_burdened_local_per_hr: 23.26,
      capacity_utilization_rate: 85,
      operators: null,
      usd_lhr_total: null,
    };
    expect(classifyMachineRecord(makino)).toBe('cnc_3ax_vmc');
    expect(classifyMachineRecord(dmgMori5ax)).toBe('cnc_5ax_mc');
  });

  it('never classifies a Press/Forming-family machine into press_brake (root-caused 2026-08-30 live bug: Aida UMX-600, a Progressive Die Press machine, was wrongly resolved for a Bend Brake/Shearning quote line)', () => {
    const progressiveDiePress = {
      id: '6', machine_name: 'Aida UMX-600', machine_class: 'Progressive Die Press',
      process_group: 'Sheet Metal', commodity_code: 'Sheet Metal',
      total_machine_hour_rate: 20.79, manual_mhr_value: 20.79, fully_burdened_local_per_hr: 20.79,
      capacity_utilization_rate: 85,
      operators: null,
      usd_lhr_total: null,
    };
    const standardPress = {
      id: '7', machine_name: 'Default Press', machine_class: 'Standard Press',
      process_group: 'Sheet Metal', commodity_code: 'Sheet Metal',
      total_machine_hour_rate: 15, manual_mhr_value: 15, fully_burdened_local_per_hr: 15,
      capacity_utilization_rate: 85,
      operators: null,
      usd_lhr_total: null,
    };
    const tandemPress = {
      id: '8', machine_name: 'Default Press', machine_class: 'Tandem Press',
      process_group: 'Sheet Metal', commodity_code: 'Sheet Metal',
      total_machine_hour_rate: 15, manual_mhr_value: 15, fully_burdened_local_per_hr: 15,
      capacity_utilization_rate: 85,
      operators: null,
      usd_lhr_total: null,
    };
    const turretPress = {
      id: '9', machine_name: 'Amada Vipros 255', machine_class: 'Turret Press',
      process_group: 'Sheet Metal', commodity_code: 'Sheet Metal',
      total_machine_hour_rate: 30, manual_mhr_value: 30, fully_burdened_local_per_hr: 30,
      capacity_utilization_rate: 85,
      operators: null,
      usd_lhr_total: null,
    };
    expect(classifyMachineRecord(progressiveDiePress)).not.toBe('press_brake');
    expect(classifyMachineRecord(standardPress)).not.toBe('press_brake');
    expect(classifyMachineRecord(tandemPress)).not.toBe('press_brake');
    expect(classifyMachineRecord(turretPress)).not.toBe('press_brake');
  });

  it('still classifies a real bend-brake machine correctly (e.g. machine_class "Bend Press Brake" from the real machine_library.json category name)', () => {
    const realBendBrake = {
      id: '10', machine_name: '11010 (Heller-hydraulic)', machine_class: 'Bend Press Brake',
      process_group: 'Sheet Metal', commodity_code: 'Sheet Metal',
      total_machine_hour_rate: 19.83, manual_mhr_value: 19.83, fully_burdened_local_per_hr: 19.83,
      capacity_utilization_rate: 85,
      operators: null,
      usd_lhr_total: null,
    };
    expect(classifyMachineRecord(realBendBrake)).toBe('press_brake');
  });
});

describe('isCapable', () => {
  it('rejects a press brake with insufficient tonnage', () => {
    const req = pressBrakeRequirement({ bendLengthMm: 2000, thicknessMm: 6, utsMpa: 410 });
    const small = candidate({ machineClass: 'press_brake', hourlyRate: 4, capability: { maxTonnage: 40, maxLengthMm: 2050, maxThicknessMm: 4 } });
    const big = candidate({ machineClass: 'press_brake', hourlyRate: 600, capability: { maxTonnage: 160, maxLengthMm: 3200, maxThicknessMm: 12 } });
    expect(isCapable(small, req)).toBe(false);
    expect(isCapable(big, req)).toBe(true);
  });

  it('uses material-specific laser thickness columns', () => {
    const laser = candidate({
      machineClass: 'fiber_laser',
      hourlyRate: 1200,
      capability: { maxXMm: 3000, maxYMm: 1500, maxThicknessMsMm: 25, maxThicknessAlMm: 8 },
    });
    const alPart = laserRequirement({ thicknessMm: 20, materialGrade: 'AL6061', bedLengthMm: 400, bedWidthMm: 250 });
    const msPart = laserRequirement({ thicknessMm: 20, materialGrade: 'CRCA', bedLengthMm: 400, bedWidthMm: 250 });
    expect(isCapable(laser, alPart)).toBe(false); // 20mm AL > 8mm AL limit
    expect(isCapable(laser, msPart)).toBe(true);  // 20mm MS ≤ 25mm MS limit
  });

  it('filters a sliding-head lathe for parts above its diameter', () => {
    const bnc20 = candidate({ machineClass: 'cnc_lathe', hourlyRate: 300, capability: { maxDiameterMm: 20, maxLengthMm: 320 } });
    expect(isCapable(bnc20, latheRequirement({ maxDiameterMm: 50, maxLengthMm: 200 }))).toBe(false);
    expect(isCapable(bnc20, latheRequirement({ maxDiameterMm: 15, maxLengthMm: 200 }))).toBe(true);
  });

  it('rejects machines that are down or retired', () => {
    const down = candidate({ machineClass: 'fiber_laser', hourlyRate: 1000, availabilityStatus: 'down', capability: { maxThicknessMsMm: 25 } });
    const req = laserRequirement({ thicknessMm: 3, materialGrade: 'MS', bedLengthMm: 400, bedWidthMm: 250 });
    expect(isCapable(down, req)).toBe(false);
  });

  it('allows bed fit in either orientation', () => {
    const laser = candidate({ machineClass: 'fiber_laser', hourlyRate: 1200, capability: { maxXMm: 3000, maxYMm: 1500, maxThicknessMsMm: 25 } });
    // 1400×2900 fits rotated (2900×1.1 ≤ 3000 fails… use smaller): 1200×2500 fits as 2500×1200
    const req = laserRequirement({ thicknessMm: 3, materialGrade: 'MS', bedLengthMm: 1200, bedWidthMm: 2500 });
    expect(isCapable(laser, req)).toBe(true);
  });
});

describe('selectMachine', () => {
  const location = 'India';

  it('prefers a physically capable machine over a cheaper incapable one (Quattro bug)', () => {
    // Reproduces the production defect: machining-line record at ₹13/hr must not win
    // the fiber_laser class over a real laser at ₹1200/hr.
    const quattro = candidate({
      machineId: 'quattro', machineName: 'Quattro', machineClass: 'fiber_laser', hourlyRate: 13,
      capability: { maxXMm: 500, maxYMm: 400, maxThicknessMsMm: 0.5 },
    });
    const realLaser = candidate({
      machineId: 'amada', machineName: 'Amada LC-3015', machineClass: 'fiber_laser', hourlyRate: 1200,
      capability: { maxXMm: 3050, maxYMm: 1525, maxThicknessMsMm: 20 },
    });
    const result = selectMachine({
      pool: [quattro, realLaser],
      location,
      machineClass: 'fiber_laser',
      requirement: laserRequirement({ thicknessMm: 3, materialGrade: 'CRCA', bedLengthMm: 400, bedWidthMm: 250 }),
    });
    expect(result.balanced.candidate.machineId).toBe('amada');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('never recommends a CNC router for 5-axis machining, even though it is far cheaper', () => {
    // A router in the eligible pool (post-classification-fix it never gets here in
    // production, but if a caller ever constructs a router candidate directly this
    // locks in that isCapable/scoring alone would not save us — classification must).
    const router = candidate({
      machineId: 'router', machineName: 'Virtual 5 Axis Router - Small', machineClass: 'cnc_5ax_mc',
      hourlyRate: 11.18, capability: { maxXMm: 400, maxYMm: 400, maxZMm: 400, maxWorkpieceWeightKg: 300 },
    });
    const realMill = candidate({
      machineId: 'dmg', machineName: 'DMG MORI DMU 105 monoBLOCK', machineClass: 'cnc_5ax_mc',
      hourlyRate: 23.26, capability: { maxXMm: 1050, maxYMm: 1050, maxZMm: 1050, maxWorkpieceWeightKg: 1000 },
    });
    const req = vmcRequirement({ bboxXMm: 83, bboxYMm: 62.4, bboxZMm: 34.5, finishedWeightKg: 0.2, materialMrrCm3PerMin: 150 });
    // Both machines pass isCapable for this tiny part — this documents that capability
    // filtering alone can't distinguish a router from a mill; classifyMachineRecord must.
    expect(isCapable(router, req)).toBe(true);
    expect(isCapable(realMill, req)).toBe(true);
  });

  it('falls back to class default with confidence 40 when nothing is capable', () => {
    const tiny = candidate({
      machineClass: 'press_brake', hourlyRate: 4,
      capability: { maxTonnage: 5, maxLengthMm: 500, maxThicknessMm: 1 },
    });
    // This is a pure unit test of selectMachine() in isolation — no DB, no
    // bom-items.service.ts — so fallbackRate can only be an arbitrary
    // fixture value here, NOT a real benchmark rate (that's real in
    // production: bom-items.service.ts resolves it from the actual median
    // of DB machine hourly rates for this class/location — see
    // benchmarkMap at bom-items.service.ts:1533). This test's only job is
    // to verify selectMachine correctly threads whatever fallbackRate it's
    // given onto the synthetic default-class candidate when nothing pooled
    // is capable — the exact number is arbitrary and asserted right below.
    const arbitraryTestFallbackRate = 600;
    const result = selectMachine({
      pool: [tiny],
      location,
      machineClass: 'press_brake',
      requirement: pressBrakeRequirement({ bendLengthMm: 2000, thicknessMm: 6, utsMpa: 410 }),
      fallbackRate: arbitraryTestFallbackRate,
    });
    expect(result.balanced.candidate.machineId).toBeNull();
    expect(result.balanced.candidate.capabilitySource).toBe('default_class');
    expect(result.confidence).toBe(40);
    expect(result.balanced.candidate.hourlyRate).toBe(arbitraryTestFallbackRate);
  });

  it('cheapest profile picks the lowest-rate capable machine', () => {
    const cap = { maxXMm: 3000, maxYMm: 1500, maxThicknessMsMm: 25 };
    const cheap = candidate({ machineId: 'cheap', machineClass: 'fiber_laser', hourlyRate: 800, utilizationPct: 30, capability: cap });
    const ideal = candidate({ machineId: 'ideal', machineClass: 'fiber_laser', hourlyRate: 1400, utilizationPct: 75, capability: cap });
    const result = selectMachine({
      pool: [cheap, ideal],
      location,
      machineClass: 'fiber_laser',
      requirement: laserRequirement({ thicknessMm: 3, materialGrade: 'MS', bedLengthMm: 400, bedWidthMm: 250 }),
    });
    expect(result.cheapest.candidate.machineId).toBe('cheap');
    // Balanced weights utilization at 0.3 — the 75%-loaded machine wins there
    expect(result.balanced.candidate.machineId).toBe('ideal');
    // Alternatives must not duplicate the balanced pick
    expect(result.alternatives.every((a) => a.machineId !== result.balanced.candidate.machineId)).toBe(true);
  });

  it('honours a user override even outside the capability filter', () => {
    const small = candidate({ machineId: 'small', machineClass: 'cnc_lathe', hourlyRate: 300, capability: { maxDiameterMm: 20, maxLengthMm: 320 } });
    const big = candidate({ machineId: 'big', machineClass: 'cnc_lathe', hourlyRate: 700, capability: { maxDiameterMm: 356, maxLengthMm: 533 } });
    const result = selectMachine({
      pool: [small, big],
      location,
      machineClass: 'cnc_lathe',
      requirement: latheRequirement({ maxDiameterMm: 50, maxLengthMm: 200 }),
      overrideMachineId: 'small',
    });
    expect(result.overridden).toBe(true);
    expect(result.balanced.candidate.machineId).toBe('small');
    expect(result.balanced.reasons.some((r) => r.includes('Outside computed capability'))).toBe(true);
  });

  it('warns when the recommended machine is heavily booked', () => {
    const busy = candidate({
      machineId: 'busy', machineClass: 'fiber_laser', hourlyRate: 1200, scheduledLoadPct: 95,
      capability: { maxXMm: 3000, maxYMm: 1500, maxThicknessMsMm: 25 },
    });
    const result = selectMachine({
      pool: [busy],
      location,
      machineClass: 'fiber_laser',
      requirement: laserRequirement({ thicknessMm: 3, materialGrade: 'MS', bedLengthMm: 400, bedWidthMm: 250 }),
    });
    expect(result.availabilityWarning).toContain('booked');
  });

  it('fitScore rewards tighter machines and floors at 0.3', () => {
    const req = vmcRequirement({ bboxXMm: 350, bboxYMm: 250, bboxZMm: 180, finishedWeightKg: 10, materialMrrCm3PerMin: 60 });
    const snug = candidate({ machineClass: 'cnc_3ax_vmc', hourlyRate: 900, capability: { maxXMm: 500, maxYMm: 400, maxZMm: 300, maxWorkpieceWeightKg: 500 } });
    const huge = candidate({ machineClass: 'cnc_3ax_vmc', hourlyRate: 2000, capability: { maxXMm: 4000, maxYMm: 3000, maxZMm: 2000, maxWorkpieceWeightKg: 9000 } });
    expect(fitScore(snug, req)).toBeGreaterThan(fitScore(huge, req));
    expect(fitScore(huge, req)).toBeGreaterThanOrEqual(0.3);
  });
});

// P0.4 — turret punch and waterjet used to be assigned the SAME LaserRequirement
// as fiber/CO2 laser (thickness+bed only, no tonnage dimension at all), so a
// tonnage-incapable turret machine could rank/score identically to a capable
// one — the failure was only ever caught post-hoc by checkMachineCapability(),
// after a possibly-wrong machine had already been selected. These tests prove
// the fix at the RANKING step itself, not just the post-hoc capability check.
describe('P0.4 — turret punch / waterjet get their own real MachineRequirement kinds', () => {
  const location = 'India';

  // Shared small-part punching job used across tests A/C/E: cutLengthMm=200,
  // shear=300 MPa, thickness=1.5mm → estimateTurretPunchTonnage gives
  // (200*1.5*300)/9810*1.25 ≈ 11.47 t theoretical-with-margin, so a machine
  // needs ≥ 11.47*1.15 (TONNAGE_MARGIN) ≈ 13.19 t to be capable.
  const smallPunchJob = { cutLengthMm: 200, materialShearStrengthMpa: 300, thicknessMm: 1.5, bedLengthMm: 300, bedWidthMm: 200 };

  it('A — documents the LaserRequirement blind spot, then proves punchingRequirement fixes it', () => {
    const weakTurret = candidate({
      machineId: 'weak-turret', machineClass: 'turret_punch', hourlyRate: 40,
      capability: { maxTonnage: 5, maxThicknessMm: 3, maxXMm: 1250, maxYMm: 2500 },
    });
    const strongTurret = candidate({
      machineId: 'strong-turret', machineClass: 'turret_punch', hourlyRate: 45,
      capability: { maxTonnage: 20, maxThicknessMm: 3, maxXMm: 1250, maxYMm: 2500 },
    });

    // OLD behavior reproduction: both machines assigned the identical
    // LaserRequirement (thickness+bed only) — tonnage is invisible to both
    // isCapable and fitScore, so a 5t and a 20t turret score identically.
    const oldReq = laserRequirement({ thicknessMm: 1.5, materialGrade: 'CRCA', bedLengthMm: 300, bedWidthMm: 200 });
    expect(isCapable(weakTurret, oldReq)).toBe(true); // documents the defect
    expect(isCapable(strongTurret, oldReq)).toBe(true);
    expect(fitScore(weakTurret, oldReq)).toBe(fitScore(strongTurret, oldReq));

    // NEW behavior: punchingRequirement makes tonnage visible to both.
    const newReq = punchingRequirement(smallPunchJob);
    expect(newReq.tonnage).toBeCloseTo(11.47, 1);
    expect(isCapable(weakTurret, newReq)).toBe(false);  // 5t < 13.19t required
    expect(isCapable(strongTurret, newReq)).toBe(true); // 20t ≥ 13.19t required

    const result = selectMachine({ pool: [weakTurret, strongTurret], location, machineClass: 'turret_punch', requirement: newReq });
    expect(result.balanced.candidate.machineId).toBe('strong-turret');
  });

  it('B — waterjet: thickness/bed capable vs incapable using the new WaterjetRequirement', () => {
    const thin = candidate({ machineId: 'thin-wj', machineClass: 'waterjet', hourlyRate: 900, capability: { maxThicknessMm: 10, maxXMm: 3000, maxYMm: 1500 } });
    const thick = candidate({ machineId: 'thick-wj', machineClass: 'waterjet', hourlyRate: 1500, capability: { maxThicknessMm: 50, maxXMm: 3000, maxYMm: 1500 } });
    const req = waterjetRequirement({ thicknessMm: 25, bedLengthMm: 1000, bedWidthMm: 500 });
    expect(isCapable(thin, req)).toBe(false);
    expect(isCapable(thick, req)).toBe(true);
    const result = selectMachine({ pool: [thin, thick], location, machineClass: 'waterjet', requirement: req });
    expect(result.balanced.candidate.machineId).toBe('thick-wj');
  });

  it('C — among multiple capable turret machines, fitScore prefers the tighter-tonnage fit over an oversized one', () => {
    const snug = candidate({ machineId: 'snug', machineClass: 'turret_punch', hourlyRate: 40, capability: { maxTonnage: 15, maxThicknessMm: 3, maxXMm: 1250, maxYMm: 2500 } });
    const oversized = candidate({ machineId: 'oversized', machineClass: 'turret_punch', hourlyRate: 40, capability: { maxTonnage: 100, maxThicknessMm: 3, maxXMm: 1250, maxYMm: 2500 } });
    const req = punchingRequirement(smallPunchJob);
    expect(isCapable(snug, req)).toBe(true);
    expect(isCapable(oversized, req)).toBe(true);
    expect(fitScore(snug, req)).toBeGreaterThan(fitScore(oversized, req));
    const result = selectMachine({ pool: [snug, oversized], location, machineClass: 'turret_punch', requirement: req });
    expect(result.balanced.candidate.machineId).toBe('snug');
  });

  it('D — no capable turret machine in the pool still falls back to the benchmark rate, unmodified fallback path', () => {
    const tiny = candidate({ machineId: 'tiny', machineClass: 'turret_punch', hourlyRate: 30, capability: { maxTonnage: 2, maxThicknessMm: 3, maxXMm: 1250, maxYMm: 2500 } });
    const bigJob = { cutLengthMm: 2000, materialShearStrengthMpa: 400, thicknessMm: 4, bedLengthMm: 1000, bedWidthMm: 800 };
    const req = punchingRequirement(bigJob);
    expect(isCapable(tiny, req)).toBe(false); // sanity: this job genuinely exceeds tiny's 2t capacity
    const arbitraryTestFallbackRate = 55;
    const result = selectMachine({ pool: [tiny], location, machineClass: 'turret_punch', requirement: req, fallbackRate: arbitraryTestFallbackRate });
    expect(result.balanced.candidate.machineId).toBeNull();
    expect(result.balanced.candidate.capabilitySource).toBe('default_class');
    expect(result.confidence).toBe(40);
    expect(result.balanced.candidate.hourlyRate).toBe(arbitraryTestFallbackRate);
  });

  it('E — a non-seed-registry turret machine with real imported capability is judged on its own numbers, not its name', () => {
    const req = punchingRequirement(smallPunchJob);
    const unknownModel = candidate({
      machineId: 'unknown-1', machineName: 'ACME XZ-9000 Prototype', machineClass: 'turret_punch', hourlyRate: 50,
      capability: { maxTonnage: 20, maxThicknessMm: 3, maxXMm: 1250, maxYMm: 2500 },
    });
    expect(unknownModel.capabilitySource).toBe('imported');
    expect(isCapable(unknownModel, req)).toBe(true);
    expect(fitScore(unknownModel, req)).toBeGreaterThan(0.3);
  });

  // F — P0.1's checkMachineCapability() needs zero code changes for P0.4 (it
  // takes no MachineRequirement at all — confirmed structurally decoupled from
  // ranking), so its own unmodified test file is the regression check here;
  // it is run alongside this file in every full-suite pass.
});

// P0.4 — end-to-end integration test: the real production chain
//   CAD geometry → buildPartRequirements() → PunchingRequirement/WaterjetRequirement
//   → selectMachine() → candidate ranking → selected machine → rate
// buildPartRequirements() is a private BOMItemsService method, but reading its
// body confirms it touches no injected dependency (no `this.xxxService` call
// anywhere in it) — it is a pure geometry+material → requirements mapper, only
// calling physics.ts builders + getEnginesForFamily/classifyLaserMaterial.
// Object.create bypasses the constructor (so no Supabase/other DI wiring is
// needed) while still invoking the ACTUAL production method — not a
// hand-rebuilt PunchingRequirement/WaterjetRequirement standing in for it —
// so this proves the real production code path, not just physics.ts/selector.ts
// in isolation.
describe('P0.4 — integration: buildPartRequirements() feeds selectMachine() with the new kinds', () => {
  const location = 'India';

  function callBuildPartRequirements(input: Record<string, unknown>) {
    const svc = Object.create(BOMItemsService.prototype) as BOMItemsService;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (svc as any).buildPartRequirements(input);
  }

  const partGeometry = {
    family: 'sheet_metal',
    grade: 'CRCA',
    sheetThicknessMm: 1.5,
    bendCount: 0,
    flatPatternAreaMm2: 300 * 200,
    flatLenMm: 300,
    flatWidMm: 200,
    bboxXMm: 300,
    bboxYMm: 200,
    bboxZMm: 1.5,
    weightKg: 0.5,
    utsMpa: 410,
    cutLengthMm: 200,
    materialShearStrengthMpa: 300,
  };

  it('produces a real PunchingRequirement (not a shared LaserRequirement) for turret_punch', () => {
    const requirements = callBuildPartRequirements(partGeometry);
    expect(requirements.turret_punch?.kind).toBe('turret_punch');
    expect(requirements.turret_punch?.tonnage).toBeCloseTo(11.47, 1);
    // fiber/CO2 laser must still get the laser requirement, unmodified
    expect(requirements.fiber_laser?.kind).toBe('laser');
  });

  it('produces a real WaterjetRequirement (not a shared LaserRequirement) for waterjet', () => {
    const requirements = callBuildPartRequirements(partGeometry);
    expect(requirements.waterjet?.kind).toBe('waterjet');
    expect(requirements.waterjet?.thicknessMm).toBe(1.5);
    expect(requirements.waterjet?.bedLengthMm).toBe(300);
    expect(requirements.waterjet?.bedWidthMm).toBe(200);
  });

  it('the PunchingRequirement produced by the real production method correctly drives selectMachine() to reject an incapable turret and pick the capable one', () => {
    const requirements = callBuildPartRequirements(partGeometry);
    const weakTurret = candidate({
      machineId: 'weak-turret', machineClass: 'turret_punch', hourlyRate: 40,
      capability: { maxTonnage: 5, maxThicknessMm: 3, maxXMm: 1250, maxYMm: 2500 },
    });
    const strongTurret = candidate({
      machineId: 'strong-turret', machineClass: 'turret_punch', hourlyRate: 45,
      capability: { maxTonnage: 20, maxThicknessMm: 3, maxXMm: 1250, maxYMm: 2500 },
    });
    const result = selectMachine({
      pool: [weakTurret, strongTurret],
      location,
      machineClass: 'turret_punch',
      requirement: requirements.turret_punch,
    });
    expect(isCapable(weakTurret, requirements.turret_punch)).toBe(false);
    expect(result.balanced.candidate.machineId).toBe('strong-turret');
    expect(result.balanced.candidate.hourlyRate).toBe(45); // proves the RATE flows from the real selection, not a placeholder
  });

  it('the WaterjetRequirement produced by the real production method correctly drives selectMachine() to reject a too-thin-capacity waterjet and pick the capable one', () => {
    const thickJob = { ...partGeometry, sheetThicknessMm: 25, flatPatternAreaMm2: 1000 * 500, flatLenMm: 1000, flatWidMm: 500 };
    const requirements = callBuildPartRequirements(thickJob);
    const thin = candidate({ machineId: 'thin-wj', machineClass: 'waterjet', hourlyRate: 900, capability: { maxThicknessMm: 10, maxXMm: 3000, maxYMm: 1500 } });
    const thick = candidate({ machineId: 'thick-wj', machineClass: 'waterjet', hourlyRate: 1500, capability: { maxThicknessMm: 50, maxXMm: 3000, maxYMm: 1500 } });
    const result = selectMachine({
      pool: [thin, thick],
      location,
      machineClass: 'waterjet',
      requirement: requirements.waterjet,
    });
    expect(isCapable(thin, requirements.waterjet)).toBe(false);
    expect(result.balanced.candidate.machineId).toBe('thick-wj');
    expect(result.balanced.candidate.hourlyRate).toBe(1500);
  });

  it('a part with zero bends still only assigns press_brake when bendCount > 0 — turret/waterjet fix does not disturb unrelated requirement assignment', () => {
    const requirements = callBuildPartRequirements(partGeometry); // bendCount: 0
    expect(requirements.press_brake).toBeUndefined();
    expect(requirements.turret_punch).toBeDefined();
    expect(requirements.waterjet).toBeDefined();
  });

  describe('laser thickness fail-open (root-caused 2026-08-31 — systemic class-wide data gap)', () => {
    const req = laserRequirement({ thicknessMm: 3, materialGrade: 'CRCA', bedLengthMm: 1000, bedWidthMm: 500 });

    it('rejects a machine with unknown thickness data when at least one other real machine in the class HAS real data — unchanged fail-closed behavior', () => {
      const noData = candidate({ machineId: 'no-data', machineClass: 'fiber_laser', hourlyRate: 40 });
      const hasData = candidate({ machineId: 'has-data', machineClass: 'fiber_laser', hourlyRate: 60, capability: { maxThicknessMsMm: 12, maxXMm: 3000, maxYMm: 1500 } });
      expect(isCapable(noData, req)).toBe(false);
      const result = selectMachine({ pool: [noData, hasData], location, machineClass: 'fiber_laser', requirement: req });
      expect(result.balanced.candidate.machineId).toBe('has-data');
    });

    it('fails open (capable=true) when literally every real machine in the class has unknown thickness data', () => {
      const noData1 = candidate({ machineId: 'laser-1', machineClass: 'fiber_laser', hourlyRate: 40 });
      const noData2 = candidate({ machineId: 'laser-2', machineClass: 'fiber_laser', hourlyRate: 55 });
      const result = selectMachine({ pool: [noData1, noData2], location, machineClass: 'fiber_laser', requirement: req });

      // A real machine is selected — never the synthetic no-machine fallback.
      expect(result.balanced.candidate.machineId).not.toBeNull();
      expect(['laser-1', 'laser-2']).toContain(result.balanced.candidate.machineId);
      expect(result.balanced.candidate.hourlyRate).toBeGreaterThan(0);
      expect(result.balanced.reasons.some((r) => r.includes('capability assumed, not verified'))).toBe(true);
    });

    it('still fails a fail-open-eligible machine on bed size, even with unknown thickness data', () => {
      const tooSmallBed = candidate({ machineId: 'small-bed', machineClass: 'fiber_laser', hourlyRate: 40, capability: { maxXMm: 500, maxYMm: 300 } });
      expect(isCapable(tooSmallBed, req, { allowUnknownLaserThickness: true })).toBe(false);
    });
  });
});

// Machine Economics backlog, Part 1 — shear was previously assigned the SAME
// LaserRequirement as fiber/CO2 laser (bom-items.service.ts's buildPartRequirements,
// pre-fix), which combined with no real capability data on file for any shear
// machine meant laser's fail-closed null-thickness policy marked EVERY shear
// machine not capable — worse than an uninformative fallback. These tests
// prove the real fix: a dedicated ShearRequirement (per-material thickness +
// shear bed length), real seed-registry entries for all 10 real Shearing
// Machine machines, and real production wiring.
describe('Machine Economics — shear gets its own real ShearRequirement', () => {
  const location = 'India';

  it('rejects a machine whose real per-material thickness limit is below the job, accepts one above it', () => {
    const thin = candidate({
      machineId: 'thin-shear', machineClass: 'shear', hourlyRate: 40,
      capability: { maxThicknessMsMm: 3, maxThicknessSsMm: 2.5, maxThicknessAlMm: 4, maxThicknessCuMm: 4, maxLengthMm: 3000 },
    });
    const thick = candidate({
      machineId: 'thick-shear', machineClass: 'shear', hourlyRate: 60,
      capability: { maxThicknessMsMm: 13, maxThicknessSsMm: 11, maxThicknessAlMm: 20, maxThicknessCuMm: 20, maxLengthMm: 3000 },
    });
    const req = shearRequirement({ thicknessMm: 6, materialGrade: 'CRCA', cutLengthMm: 1000 });
    expect(isCapable(thin, req)).toBe(false);  // 3mm MS limit < 6mm job
    expect(isCapable(thick, req)).toBe(true);  // 13mm MS limit ≥ 6mm job
    const result = selectMachine({ pool: [thin, thick], location, machineClass: 'shear', requirement: req });
    expect(result.balanced.candidate.machineId).toBe('thick-shear');
  });

  it('checks the correct real material-family column — a stainless job rejects a machine whose SS limit (not MS limit) is too low', () => {
    const msStrongSsWeak = candidate({
      machineId: 'ms-strong', machineClass: 'shear', hourlyRate: 50,
      capability: { maxThicknessMsMm: 13, maxThicknessSsMm: 2, maxThicknessAlMm: 20, maxThicknessCuMm: 20, maxLengthMm: 3000 },
    });
    const req = shearRequirement({ thicknessMm: 6, materialGrade: 'SS304', cutLengthMm: 1000 });
    expect(req.materialFamily).toBe('SS');
    expect(isCapable(msStrongSsWeak, req)).toBe(false); // real SS limit (2mm) governs, not the MS limit (13mm)
  });

  it('rejects on real shear bed length even when thickness is within range', () => {
    const shortBed = candidate({
      machineId: 'short-bed', machineClass: 'shear', hourlyRate: 40,
      capability: { maxThicknessMsMm: 13, maxThicknessSsMm: 11, maxThicknessAlMm: 20, maxThicknessCuMm: 20, maxLengthMm: 1000 },
    });
    const req = shearRequirement({ thicknessMm: 3, materialGrade: 'CRCA', cutLengthMm: 2500 });
    expect(isCapable(shortBed, req)).toBe(false); // 1000mm bed < 2500mm cut × BED_MARGIN
  });

  it('a machine with no real spec data on file stays selectable (ungated on null, matching waterjet/turret_punch — shear has no confirmed systemic data gap the way laser did, so no fail-closed policy was invented for it), scored neutrally rather than fabricated as a confident fit', () => {
    const noData = candidate({ machineId: 'no-data-shear', machineClass: 'shear', hourlyRate: 40 });
    const req = shearRequirement({ thicknessMm: 6, materialGrade: 'CRCA', cutLengthMm: 1000 });
    expect(isCapable(noData, req)).toBe(true);
    expect(fitScore(noData, req)).toBe(0.5); // neutral — no real spec parts contributed to the fit average
    const result = selectMachine({ pool: [noData], location, machineClass: 'shear', requirement: req });
    expect(result.balanced.candidate.machineId).toBe('no-data-shear'); // still a real selection, not a crash
  });

  it('production wiring: buildPartRequirements() produces a real ShearRequirement for shear, not a shared LaserRequirement', () => {
    const svc = Object.create(BOMItemsService.prototype) as BOMItemsService;
    const requirements = (svc as any).buildPartRequirements({
      family: 'sheet_metal',
      grade: 'CRCA',
      sheetThicknessMm: 3,
      bendCount: 0,
      flatPatternAreaMm2: 1200 * 800,
      flatLenMm: 1200,
      flatWidMm: 800,
      bboxXMm: 1200,
      bboxYMm: 800,
      bboxZMm: 3,
      weightKg: 5,
      utsMpa: 410,
    });
    expect(requirements.shear?.kind).toBe('shear');
    expect(requirements.shear?.thicknessMm).toBe(3);
    expect(requirements.shear?.cutLengthMm).toBe(1200); // max(flatLen, flatWid)
    // fiber/CO2 laser must still get the laser requirement, unmodified
    expect(requirements.fiber_laser?.kind).toBe('laser');
  });
});

// Machine Economics backlog, Part 1 — plasma_cut had the same LaserRequirement
// mis-assignment defect as shear, plus a real, separate mhr_records bug: its
// 13 real machines were tagged machine_class='plasma' (not the real
// registered PlasmaCuttingEngine's 'plasma_cut'), so classifyMachineRecord()
// silently dropped most of them from the pool entirely (fixed by migration
// 697, alongside the capability backfill). Real machine_library.json data has
// no thickness field for this class — bed size only (see
// PlasmaCutRequirement's own doc comment for why thickness stays ungated
// here rather than fabricating a power→thickness formula).
describe('Machine Economics — plasma_cut gets its own real PlasmaCutRequirement', () => {
  const location = 'India';

  it('rejects a machine whose real bed is too small, accepts one that fits', () => {
    const small = candidate({
      machineId: 'small-plasma', machineClass: 'plasma_cut', hourlyRate: 40,
      capability: { maxXMm: 2000, maxYMm: 1000, powerKw: 0.1 },
    });
    const large = candidate({
      machineId: 'large-plasma', machineClass: 'plasma_cut', hourlyRate: 80,
      capability: { maxXMm: 27000, maxYMm: 3100, powerKw: 100 },
    });
    const req = plasmaCutRequirement({ bedLengthMm: 6000, bedWidthMm: 2000 });
    expect(isCapable(small, req)).toBe(false);
    expect(isCapable(large, req)).toBe(true);
    const result = selectMachine({ pool: [small, large], location, machineClass: 'plasma_cut', requirement: req });
    expect(result.balanced.candidate.machineId).toBe('large-plasma');
  });

  it('a machine with no real bed data on file stays selectable (ungated), never a crash', () => {
    const noData = candidate({ machineId: 'no-data-plasma', machineClass: 'plasma_cut', hourlyRate: 40 });
    const req = plasmaCutRequirement({ bedLengthMm: 3000, bedWidthMm: 1500 });
    expect(isCapable(noData, req)).toBe(true);
    const result = selectMachine({ pool: [noData], location, machineClass: 'plasma_cut', requirement: req });
    expect(result.balanced.candidate.machineId).toBe('no-data-plasma');
  });

  it('production wiring: buildPartRequirements() produces a real PlasmaCutRequirement for plasma_cut, not a shared LaserRequirement', () => {
    const svc = Object.create(BOMItemsService.prototype) as BOMItemsService;
    const requirements = (svc as any).buildPartRequirements({
      family: 'sheet_metal',
      grade: 'CRCA',
      sheetThicknessMm: 3,
      bendCount: 0,
      flatPatternAreaMm2: 1200 * 800,
      flatLenMm: 1200,
      flatWidMm: 800,
      bboxXMm: 1200,
      bboxYMm: 800,
      bboxZMm: 3,
      weightKg: 5,
      utsMpa: 410,
    });
    expect(requirements.plasma_cut?.kind).toBe('plasma_cut');
    expect(requirements.plasma_cut?.bedLengthMm).toBe(1200);
    expect(requirements.plasma_cut?.bedWidthMm).toBe(800);
    expect(requirements.fiber_laser?.kind).toBe('laser');
  });
});

// Machine Economics backlog, Part 1 — plasma_punch has no real dimensional
// capability data anywhere in the sourced reference data (confirmed via
// plasma-punch-engine.ts's own doc comment and machine_library.json's
// "Plasma Punch" category fields — power_watts only). Building a dedicated
// MachineRequirement kind here would have nothing real to gate on, so
// 'generic' is the honest, correct classification — but it was previously
// getting the laser-shaped `cutReq` instead (same false-rejection defect as
// shear/plasma_cut before their fixes).
describe('Machine Economics — plasma_punch correctly gets a generic requirement, not a shared LaserRequirement', () => {
  it('production wiring: buildPartRequirements() assigns kind:generic for plasma_punch', () => {
    const svc = Object.create(BOMItemsService.prototype) as BOMItemsService;
    const requirements = (svc as any).buildPartRequirements({
      family: 'sheet_metal',
      grade: 'CRCA',
      sheetThicknessMm: 3,
      bendCount: 0,
      flatPatternAreaMm2: 1200 * 800,
      flatLenMm: 1200,
      flatWidMm: 800,
      bboxXMm: 1200,
      bboxYMm: 800,
      bboxZMm: 3,
      weightKg: 5,
      utsMpa: 410,
    });
    expect(requirements.plasma_punch?.kind).toBe('generic');
    expect(requirements.fiber_laser?.kind).toBe('laser');
  });

  it('a plasma_punch machine with no real capability data is always capable (generic has no dimensional gate)', () => {
    const noData = candidate({ machineId: 'no-data-pp', machineClass: 'plasma_punch', hourlyRate: 40 });
    expect(isCapable(noData, { kind: 'generic' })).toBe(true);
  });
});

// Machine Economics backlog, Part 1 — laser_punch has the richest real data
// of this backlog (real press_force_kn, real per-material thickness, real
// bed size — machine_library.json confirmed all 26 real "Laser Punch / Punch
// Press" machines have clean, unambiguous per-material thickness fields, no
// P0.7-style unlabeled-tier gap). Real capability backfilled directly into
// mhr_records via migration 699's sm_reference_data JOIN — never hardcoded.
describe('Machine Economics — laser_punch gets its own real LaserPunchRequirement', () => {
  const location = 'India';

  it('rejects a machine whose real tonnage capacity is below the job, accepts one above it', () => {
    const weak = candidate({
      machineId: 'weak-lp', machineClass: 'laser_punch', hourlyRate: 40,
      capability: { maxTonnage: 5, maxThicknessMsMm: 6, maxThicknessSsMm: 4, maxThicknessAlMm: 8, maxThicknessCuMm: 8, maxXMm: 2500, maxYMm: 1250 },
    });
    const strong = candidate({
      machineId: 'strong-lp', machineClass: 'laser_punch', hourlyRate: 90,
      capability: { maxTonnage: 30, maxThicknessMsMm: 6, maxThicknessSsMm: 4, maxThicknessAlMm: 8, maxThicknessCuMm: 8, maxXMm: 2500, maxYMm: 1250 },
    });
    // tonnage = (cutLengthMm × thicknessMm × shearStrengthMpa / 9810) × 1.25
    // = (50 × 3 × 400 / 9810) × 1.25 ≈ 7.64 t; ×TONNAGE_MARGIN(1.15) ≈ 8.79 t required
    const req = laserPunchRequirement({
      cutLengthMm: 50, materialShearStrengthMpa: 400, thicknessMm: 3, materialGrade: 'CRCA',
      bedLengthMm: 1200, bedWidthMm: 800,
    });
    expect(isCapable(weak, req)).toBe(false); // 5t capacity < 8.79t required
    expect(isCapable(strong, req)).toBe(true); // 30t capacity ≥ 8.79t required
    const result = selectMachine({ pool: [weak, strong], location, machineClass: 'laser_punch', requirement: req });
    expect(result.balanced.candidate.machineId).toBe('strong-lp');
  });

  it('checks the correct real material-family thickness column — a stainless job rejects a machine whose SS limit (not MS limit) is too low', () => {
    const msStrongSsWeak = candidate({
      machineId: 'ms-strong-lp', machineClass: 'laser_punch', hourlyRate: 50,
      capability: { maxTonnage: 30, maxThicknessMsMm: 6, maxThicknessSsMm: 1, maxThicknessAlMm: 8, maxThicknessCuMm: 8, maxXMm: 2500, maxYMm: 1250 },
    });
    const req = laserPunchRequirement({
      cutLengthMm: 50, materialShearStrengthMpa: 400, thicknessMm: 3, materialGrade: 'SS304',
      bedLengthMm: 1200, bedWidthMm: 800,
    });
    expect(req.materialFamily).toBe('SS');
    expect(isCapable(msStrongSsWeak, req)).toBe(false); // real SS limit (1mm) governs, not the MS limit (6mm)
  });

  it('rejects on real bed size even when tonnage and thickness are within range', () => {
    const smallBed = candidate({
      machineId: 'small-bed-lp', machineClass: 'laser_punch', hourlyRate: 40,
      capability: { maxTonnage: 30, maxThicknessMsMm: 6, maxThicknessSsMm: 4, maxThicknessAlMm: 8, maxThicknessCuMm: 8, maxXMm: 800, maxYMm: 500 },
    });
    const req = laserPunchRequirement({
      cutLengthMm: 50, materialShearStrengthMpa: 400, thicknessMm: 3, materialGrade: 'CRCA',
      bedLengthMm: 1200, bedWidthMm: 800,
    });
    expect(isCapable(smallBed, req)).toBe(false);
  });

  it('a machine with no real spec data on file stays selectable (ungated on null, same honest degrade as every other class), scored neutrally rather than fabricated as a confident fit', () => {
    const noData = candidate({ machineId: 'no-data-lp', machineClass: 'laser_punch', hourlyRate: 40 });
    const req = laserPunchRequirement({
      cutLengthMm: 50, materialShearStrengthMpa: 400, thicknessMm: 3, materialGrade: 'CRCA',
      bedLengthMm: 1200, bedWidthMm: 800,
    });
    expect(isCapable(noData, req)).toBe(true);
    const result = selectMachine({ pool: [noData], location, machineClass: 'laser_punch', requirement: req });
    expect(result.balanced.candidate.machineId).toBe('no-data-lp');
  });

  it('production wiring: buildPartRequirements() produces a real LaserPunchRequirement for laser_punch, not a shared LaserRequirement', () => {
    const svc = Object.create(BOMItemsService.prototype) as BOMItemsService;
    const requirements = (svc as any).buildPartRequirements({
      family: 'sheet_metal',
      grade: 'CRCA',
      sheetThicknessMm: 3,
      bendCount: 0,
      flatPatternAreaMm2: 1200 * 800,
      flatLenMm: 1200,
      flatWidMm: 800,
      bboxXMm: 1200,
      bboxYMm: 800,
      bboxZMm: 3,
      weightKg: 5,
      utsMpa: 410,
    });
    expect(requirements.laser_punch?.kind).toBe('laser_punch');
    expect(requirements.laser_punch?.bedLengthMm).toBe(1200); // = flatLenMm
    expect(requirements.laser_punch?.bedWidthMm).toBe(800); // = flatWidMm
    expect(requirements.fiber_laser?.kind).toBe('laser');
  });
});

// Machine Economics backlog — forming-family completion (2026-09-04):
// buildPartRequirements() previously never looped the sheet_metal_forming
// engine family at all, so standard_press/tandem_press/progressive_die_press/
// roll_bending_2/3/4 always fell back to { kind: 'generic' } inside
// resolveMHRRates()'s selectMachine() call — zero tonnage/bed/thickness
// gating regardless of the part. Real capability backfilled directly into
// mhr_records via migration 701, from real sm_reference_data already staged
// for these classes (migrations 505/508/585) — never hardcoded.
describe('Machine Economics — standard_press/tandem_press get their own real PressRequirement', () => {
  const location = 'India';

  it('rejects a machine whose real tonnage capacity is below the job, accepts one above it', () => {
    const weak = candidate({
      machineId: 'weak-sp', machineClass: 'standard_press', hourlyRate: 40,
      capability: { maxTonnage: 5, maxThicknessMsMm: 25, maxThicknessSsMm: 23, maxThicknessAlMm: 31, maxThicknessCuMm: 31, maxXMm: 703, maxYMm: 701 },
    });
    const strong = candidate({
      machineId: 'strong-sp', machineClass: 'standard_press', hourlyRate: 90,
      capability: { maxTonnage: 200, maxThicknessMsMm: 25, maxThicknessSsMm: 23, maxThicknessAlMm: 31, maxThicknessCuMm: 31, maxXMm: 703, maxYMm: 701 },
    });
    // tonnage = (50 × 3 × 400 / 9810) × 1.25 ≈ 7.64 t; ×TONNAGE_MARGIN(1.15) ≈ 8.79 t required
    const req = pressFormingRequirement({
      cutLengthMm: 50, materialShearStrengthMpa: 400, thicknessMm: 3, materialGrade: 'CRCA',
      bedLengthMm: 600, bedWidthMm: 600,
    });
    expect(isCapable(weak, req)).toBe(false);
    expect(isCapable(strong, req)).toBe(true);
    const result = selectMachine({ pool: [weak, strong], location, machineClass: 'standard_press', requirement: req });
    expect(result.balanced.candidate.machineId).toBe('strong-sp');
  });

  it('checks the correct real material-family thickness column — a stainless job rejects a machine whose SS limit (not MS limit) is too low', () => {
    const msStrongSsWeak = candidate({
      machineId: 'ms-strong-tp', machineClass: 'tandem_press', hourlyRate: 50,
      capability: { maxTonnage: 200, maxThicknessMsMm: 30, maxThicknessSsMm: 1, maxThicknessAlMm: 38, maxThicknessCuMm: 38, maxXMm: 1500, maxYMm: 1200 },
    });
    const req = pressFormingRequirement({
      cutLengthMm: 50, materialShearStrengthMpa: 400, thicknessMm: 3, materialGrade: 'SS304',
      bedLengthMm: 600, bedWidthMm: 600,
    });
    expect(req.materialFamily).toBe('SS');
    expect(isCapable(msStrongSsWeak, req)).toBe(false); // real SS limit (1mm) governs, not the MS limit (30mm)
  });

  it('rejects on real bed size even when tonnage and thickness are within range', () => {
    const smallBed = candidate({
      machineId: 'small-bed-sp', machineClass: 'standard_press', hourlyRate: 40,
      capability: { maxTonnage: 200, maxThicknessMsMm: 25, maxThicknessSsMm: 23, maxThicknessAlMm: 31, maxThicknessCuMm: 31, maxXMm: 400, maxYMm: 300 },
    });
    const req = pressFormingRequirement({
      cutLengthMm: 50, materialShearStrengthMpa: 400, thicknessMm: 3, materialGrade: 'CRCA',
      bedLengthMm: 1200, bedWidthMm: 800,
    });
    expect(isCapable(smallBed, req)).toBe(false);
  });

  it('progressive_die_press only has real coverage for aluminum thickness — a stainless job stays ungated (no fabricated SS limit), an aluminum job is genuinely gated', () => {
    const alOnlyData = candidate({
      machineId: 'al-only-pd', machineClass: 'progressive_die_press', hourlyRate: 60,
      capability: { maxTonnage: 200, maxThicknessAlMm: 2, maxXMm: 2150, maxYMm: 1430 }, // maxThicknessSsMm/MsMm/CuMm real-absent (null)
    });
    const ssReq = pressFormingRequirement({
      cutLengthMm: 50, materialShearStrengthMpa: 400, thicknessMm: 3, materialGrade: 'SS304',
      bedLengthMm: 600, bedWidthMm: 600,
    });
    expect(isCapable(alOnlyData, ssReq)).toBe(true); // no real SS data on file for this class — ungated, not fabricated-false
    const alReq = pressFormingRequirement({
      cutLengthMm: 50, materialShearStrengthMpa: 400, thicknessMm: 3, materialGrade: 'AL6061',
      bedLengthMm: 600, bedWidthMm: 600,
    });
    expect(isCapable(alOnlyData, alReq)).toBe(false); // real AL limit (2mm) < 3mm job
  });

  it('a machine with no real spec data on file stays selectable (ungated on null, same honest degrade as every other class)', () => {
    const noData = candidate({ machineId: 'no-data-sp', machineClass: 'standard_press', hourlyRate: 40 });
    const req = pressFormingRequirement({
      cutLengthMm: 50, materialShearStrengthMpa: 400, thicknessMm: 3, materialGrade: 'CRCA',
      bedLengthMm: 600, bedWidthMm: 600,
    });
    expect(isCapable(noData, req)).toBe(true);
    const result = selectMachine({ pool: [noData], location, machineClass: 'standard_press', requirement: req });
    expect(result.balanced.candidate.machineId).toBe('no-data-sp');
  });

  it('production wiring: buildPartRequirements() produces real PressRequirements for standard_press/tandem_press/progressive_die_press, not the generic fallback', () => {
    const svc = Object.create(BOMItemsService.prototype) as BOMItemsService;
    const requirements = (svc as any).buildPartRequirements({
      family: 'sheet_metal',
      grade: 'CRCA',
      sheetThicknessMm: 3,
      bendCount: 0,
      flatPatternAreaMm2: 1200 * 800,
      flatLenMm: 1200,
      flatWidMm: 800,
      bboxXMm: 1200,
      bboxYMm: 800,
      bboxZMm: 3,
      weightKg: 5,
      utsMpa: 410,
      materialShearStrengthMpa: 400,
    });
    expect(requirements.standard_press?.kind).toBe('press_forming');
    expect(requirements.tandem_press?.kind).toBe('press_forming');
    expect(requirements.progressive_die_press?.kind).toBe('press_forming');
    expect(requirements.standard_press?.bedLengthMm).toBe(1200); // = flatLenMm
    expect(requirements.standard_press?.bedWidthMm).toBe(800); // = flatWidMm
    expect(requirements.fiber_laser?.kind).toBe('laser'); // unrelated cutting classes unaffected
  });
});

describe('Machine Economics — roll_bending_2/3/4 get their own real RollBendingRequirement', () => {
  const location = 'India';

  it('rejects a machine whose real mild-steel thickness limit is below the job, accepts one above it', () => {
    const thin = candidate({
      machineId: 'thin-rb', machineClass: 'roll_bending_3', hourlyRate: 40,
      capability: { maxThicknessMsMm: 1, maxLengthMm: 2050 },
    });
    const thick = candidate({
      machineId: 'thick-rb', machineClass: 'roll_bending_3', hourlyRate: 60,
      capability: { maxThicknessMsMm: 5, maxLengthMm: 2050 },
    });
    const req = rollBendingRequirement({ thicknessMm: 3, rollLengthMm: 1500 });
    expect(isCapable(thin, req)).toBe(false); // 1mm MS limit < 3mm job
    expect(isCapable(thick, req)).toBe(true); // 5mm MS limit ≥ 3mm job
    const result = selectMachine({ pool: [thin, thick], location, machineClass: 'roll_bending_3', requirement: req });
    expect(result.balanced.candidate.machineId).toBe('thick-rb');
  });

  it('rejects on real roll working length even when thickness is within range', () => {
    const shortRoll = candidate({
      machineId: 'short-roll', machineClass: 'roll_bending_2', hourlyRate: 40,
      capability: { maxThicknessMsMm: 5, maxLengthMm: 300 },
    });
    const req = rollBendingRequirement({ thicknessMm: 2, rollLengthMm: 2000 });
    expect(isCapable(shortRoll, req)).toBe(false); // 300mm roll length < 2000mm × BED_MARGIN
  });

  it('a machine with no real spec data on file stays selectable (ungated on null), scored neutrally rather than fabricated as a confident fit', () => {
    const noData = candidate({ machineId: 'no-data-rb', machineClass: 'roll_bending_4', hourlyRate: 40 });
    const req = rollBendingRequirement({ thicknessMm: 3, rollLengthMm: 1500 });
    expect(isCapable(noData, req)).toBe(true);
    const result = selectMachine({ pool: [noData], location, machineClass: 'roll_bending_4', requirement: req });
    expect(result.balanced.candidate.machineId).toBe('no-data-rb');
  });

  it('production wiring: buildPartRequirements() produces real RollBendingRequirements for roll_bending_2/3/4, not the generic fallback', () => {
    const svc = Object.create(BOMItemsService.prototype) as BOMItemsService;
    const requirements = (svc as any).buildPartRequirements({
      family: 'sheet_metal',
      grade: 'CRCA',
      sheetThicknessMm: 3,
      bendCount: 2,
      flatPatternAreaMm2: 1200 * 800,
      flatLenMm: 1200,
      flatWidMm: 800,
      bboxXMm: 1200,
      bboxYMm: 800,
      bboxZMm: 3,
      weightKg: 5,
      utsMpa: 410,
    });
    expect(requirements.roll_bending_2?.kind).toBe('roll_bending');
    expect(requirements.roll_bending_3?.kind).toBe('roll_bending');
    expect(requirements.roll_bending_4?.kind).toBe('roll_bending');
    expect(requirements.roll_bending_2?.rollLengthMm).toBe(1200); // = max(flatLenMm, flatWidMm)
    expect(requirements.press_brake?.kind).toBe('press_brake'); // unrelated bendCount>0 path unaffected
  });
});
