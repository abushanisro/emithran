import {
  classifyLaserMaterial,
  laserRequirement,
  latheRequirement,
  pressBrakeRequirement,
  vmcRequirement,
  MATERIAL_K,
} from './physics';
import { classifyMachineRecord, fitScore, isCapable, selectMachine } from './selector';
import type { MachineCandidate } from '../../dto/machine-selection.dto';
import { EMPTY_CAPABILITY, lookupSeedCapability } from './seed-registry';
import type { MachineCapability } from './seed-registry';

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
    scheduledLoadPct: overrides.scheduledLoadPct ?? null,
    availabilityStatus: overrides.availabilityStatus ?? 'available',
    nextAvailableAt: null,
    maintenanceWindowStart: null,
    maintenanceWindowEnd: null,
    capability: { ...EMPTY_CAPABILITY, ...(overrides.capability ?? {}) },
    capabilitySource: 'imported',
    capabilityVersion: 1,
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

  it('computes air-bend tonnage near chart values (3mm MS, 1m bend ≈ 22t)', () => {
    const req = pressBrakeRequirement({ bendLengthMm: 1000, thicknessMm: 3, materialK: MATERIAL_K.MS });
    expect(req.tonnage).toBeGreaterThan(18);
    expect(req.tonnage).toBeLessThan(26);
  });

  it('scales tonnage with material K (SS > MS > AL)', () => {
    const base = { bendLengthMm: 1000, thicknessMm: 3 };
    const ms = pressBrakeRequirement({ ...base, materialK: MATERIAL_K.MS }).tonnage;
    const ss = pressBrakeRequirement({ ...base, materialK: MATERIAL_K.SS }).tonnage;
    const al = pressBrakeRequirement({ ...base, materialK: MATERIAL_K.AL }).tonnage;
    expect(ss).toBeGreaterThan(ms);
    expect(al).toBeLessThan(ms);
  });

  it('returns zero tonnage for zero thickness instead of dividing by zero', () => {
    const req = pressBrakeRequirement({ bendLengthMm: 1000, thicknessMm: 0, materialK: 1.42 });
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
    };
    const router3ax = {
      id: '2', machine_name: 'Multicam 7000 Series CNC Router, Model 103', machine_class: 'Router 3axis',
      process_group: 'Sheet metal', commodity_code: 'Sheet metal',
      total_machine_hour_rate: 8.14, manual_mhr_value: 8.14, fully_burdened_local_per_hr: 8.14,
      capacity_utilization_rate: 85,
    };
    const thermwood = {
      id: '3', machine_name: "Thermwood Multipurpose 67, 5' x 5'", machine_class: 'Router 5axis',
      process_group: 'Sheet metal', commodity_code: 'Sheet metal',
      total_machine_hour_rate: 11.42, manual_mhr_value: 11.42, fully_burdened_local_per_hr: 11.42,
      capacity_utilization_rate: 85,
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
    };
    const dmgMori5ax = {
      id: '5', machine_name: 'DMG MORI DMU 105 monoBLOCK', machine_class: 'Milling_Center 5axis',
      process_group: 'Machining', commodity_code: 'Machining',
      total_machine_hour_rate: 23.26, manual_mhr_value: 23.26, fully_burdened_local_per_hr: 23.26,
      capacity_utilization_rate: 85,
    };
    expect(classifyMachineRecord(makino)).toBe('cnc_3ax_vmc');
    expect(classifyMachineRecord(dmgMori5ax)).toBe('cnc_5ax_mc');
  });
});

describe('isCapable', () => {
  it('rejects a press brake with insufficient tonnage', () => {
    const req = pressBrakeRequirement({ bendLengthMm: 2000, thicknessMm: 6, materialK: MATERIAL_K.MS });
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
    const result = selectMachine({
      pool: [tiny],
      location,
      machineClass: 'press_brake',
      requirement: pressBrakeRequirement({ bendLengthMm: 2000, thicknessMm: 6, materialK: MATERIAL_K.MS }),
    });
    expect(result.balanced.candidate.machineId).toBeNull();
    expect(result.balanced.candidate.capabilitySource).toBe('default_class');
    expect(result.confidence).toBe(40);
    // India press brake default rate
    expect(result.balanced.candidate.hourlyRate).toBe(600);
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
