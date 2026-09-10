import { describe, it, expect } from 'vitest';

import { groupMachineLibraryDetail } from '@/lib/utils/machineLibraryDetail';

// Real payload, captured verbatim from this deployment via
// GET /v1/api/mhr/:id/reference-detail for the press brake that appears on the
// reported quote. Nothing here is invented — it is the machine library record
// the cost engine actually costs "Bend Brake" against.
const PRESS_BRAKE_RAW = {
  annualMaintenanceFactorPct: 5,
  avgUtilization: 1,
  bendCycleTimeS: 3.5,
  directOverheadRateUsdHr: 4.25,
  footprintAllowanceFactor: 5,
  goodPartYield: 1,
  indirectOverheadRateUsdHr: 15.58,
  installationFactorPct: 20,
  isPreferred: false,
  laborRateUsdHr: 36.3,
  laborTimeStandard: 1.3,
  machineCategory: 'Bend Press Brake',
  machineLengthMm: 3149.6,
  machineLifeYr: 10,
  machineManufacturerLocation: 'USA',
  machinePowerKw: 7.99,
  machinePriceUsd: 50290,
  machineUptimePct: 80,
  machineWidthMm: 1295.4,
  maxBendLengthMm: 3048,
  maxRadiusToThicknessRatio: 6,
  maxSheetWidthMm: 2540,
  maxThicknessAluminumMm: 27.8,
  maxThicknessBrassMm: 25.3,
  maxThicknessCopperMm: 27.8,
  maxThicknessStainlessSteelMm: 14.5,
  maxThicknessSteelMm: 15.9,
  name: '11010 (Heller-hydraulic)',
  numberOfOperators: 1,
  overheadMultiplier: 0,
  pressForceKn: 1096,
  salvageValueFactorPct: 0,
  setupTimeHr: 0.75,
  suppliesCostUsdYr: 0,
  trimStripWidthMm: 0,
  workCenterLaborRateFactor: 1,
};

function findEntry(groups: ReturnType<typeof groupMachineLibraryDetail>, key: string) {
  for (const g of groups) {
    const e = g.entries.find((x) => x.key === key);
    if (e) return { group: g.title, ...e };
  }
  return null;
}

describe('groupMachineLibraryDetail — cost surface (includeCoreFields)', () => {
  const groups = groupMachineLibraryDetail(PRESS_BRAKE_RAW, undefined, { includeCoreFields: true });

  it('surfaces the rate and labour factors a quote is actually built from', () => {
    // The MHR admin form suppresses these because it renders them as editable
    // inputs; on the cost page nothing else shows them at all.
    for (const key of ['laborRateUsdHr', 'directOverheadRateUsdHr', 'indirectOverheadRateUsdHr',
      'numberOfOperators', 'laborTimeStandard', 'workCenterLaborRateFactor', 'setupTimeHr']) {
      expect(findEntry(groups, key), `expected ${key} to be shown`).not.toBeNull();
      expect(findEntry(groups, key)!.group).toBe('Rates & Labour');
    }
  });

  it('surfaces the machine ownership economics', () => {
    for (const key of ['machinePriceUsd', 'machineLifeYr', 'machineUptimePct', 'avgUtilization',
      'goodPartYield', 'annualMaintenanceFactorPct', 'installationFactorPct',
      'salvageValueFactorPct', 'suppliesCostUsdYr', 'footprintAllowanceFactor', 'machinePowerKw']) {
      expect(findEntry(groups, key), `expected ${key} to be shown`).not.toBeNull();
      expect(findEntry(groups, key)!.group).toBe('Ownership & Economics');
    }
  });

  it('shows the real per-machine setup time that drives the setup charge', () => {
    const setup = findEntry(groups, 'setupTimeHr');
    expect(setup!.value).toBe('0.75');
    expect(setup!.label).toBe('Setup Time (hr)');
  });

  it('keeps the real capability limits in their own engineering groups', () => {
    expect(findEntry(groups, 'pressForceKn')!.group).toBe('Press Process');
    expect(findEntry(groups, 'maxThicknessSteelMm')!.group).toBe('Thickness & Material Limits');
    expect(findEntry(groups, 'maxBendLengthMm')!.group).toBe('Bend / Form Process');
    expect(findEntry(groups, 'maxSheetWidthMm')!.group).toBe('Geometry & Envelope');
  });

  it('never repeats the machine name the panel already titles itself with', () => {
    expect(findEntry(groups, 'name')).toBeNull();
  });

  it('drops fields the caller already shows on the process row', () => {
    const deduped = groupMachineLibraryDetail(PRESS_BRAKE_RAW, { setupTimeHr: 45, numberOfOperators: 1 }, { includeCoreFields: true });
    expect(findEntry(deduped, 'setupTimeHr')).toBeNull();
    expect(findEntry(deduped, 'numberOfOperators')).toBeNull();
    // ...without collateral damage to the rest of the group.
    expect(findEntry(deduped, 'laborRateUsdHr')).not.toBeNull();
  });

  it('accounts for every real field, so nothing is silently dropped', () => {
    const shown = new Set(groups.flatMap((g) => g.entries.map((e) => e.key)));
    // Only the machine's own name is suppressed; every other real field appears.
    const expected = Object.keys(PRESS_BRAKE_RAW).filter((k) => k !== 'name');
    for (const k of expected) expect(shown.has(k), `${k} missing from panel`).toBe(true);
    expect(shown.size).toBe(expected.length);
  });
});

describe('groupMachineLibraryDetail — default (MHR admin form) behaviour is unchanged', () => {
  const groups = groupMachineLibraryDetail(PRESS_BRAKE_RAW);

  it('still suppresses the fields that form renders as its own editable inputs', () => {
    for (const key of ['laborRateUsdHr', 'directOverheadRateUsdHr', 'indirectOverheadRateUsdHr',
      'numberOfOperators', 'machinePriceUsd', 'setupTimeHr', 'machineCategory', 'name']) {
      expect(findEntry(groups, key), `${key} should stay hidden by default`).toBeNull();
    }
  });

  it('still shows the process/capability fields it always did', () => {
    expect(findEntry(groups, 'pressForceKn')).not.toBeNull();
    expect(findEntry(groups, 'maxThicknessSteelMm')).not.toBeNull();
    expect(findEntry(groups, 'bendCycleTimeS')).not.toBeNull();
  });
});

describe('groupMachineLibraryDetail — edge cases', () => {
  it('returns nothing for a machine with no staged record', () => {
    expect(groupMachineLibraryDetail(null, undefined, { includeCoreFields: true })).toEqual([]);
    expect(groupMachineLibraryDetail(undefined)).toEqual([]);
  });

  it('omits empty groups rather than rendering an empty heading', () => {
    const groups = groupMachineLibraryDetail({ pressForceKn: 500 }, undefined, { includeCoreFields: true });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.title).toBe('Press Process');
  });

  it('keeps a real zero, which is a measured value, not a missing one', () => {
    // suppliesCostUsdYr: 0 and salvageValueFactorPct: 0 are real recorded values.
    const zeroes = groupMachineLibraryDetail(PRESS_BRAKE_RAW, undefined, { includeCoreFields: true });
    expect(findEntry(zeroes, 'suppliesCostUsdYr')!.value).toBe('0');
    expect(findEntry(zeroes, 'salvageValueFactorPct')!.value).toBe('0');
  });
});
