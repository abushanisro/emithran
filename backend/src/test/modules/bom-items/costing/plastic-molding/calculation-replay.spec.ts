import { readFileSync } from 'fs';
import { join } from 'path';
import { canonicalReferenceRows, resolvePlasticReference } from '../../../../../modules/bom-items/costing/plastic-molding/plastic-reference';
import { replayPlasticLine } from '../../../../../modules/bom-items/costing/plastic-molding/calculation-replay';
import type { CalculationSnapshot } from '../../../../../modules/bom-items/costing/plastic-molding/calculation-snapshot';
import { computeInjectionMoldedCostSummary, type InjectionMoldingCostInput } from '../../../../../modules/bom-items/costing/plastic-molding/process/cost-injection-molding-engine';
import { fingerprintRows } from '../../../../../modules/bom-items/costing/plastic-molding/reference-fingerprint';
import { realMaterialClamp, realPlasticReference, realPress, realReferenceRows, realResinInputs } from './real-plastic-reference';

// A saved calculation is reconstructable from what is persisted alone: the snapshot JSON as the database returns it, and the stored reference rows.
// Nothing below touches the live reference object, the part or the press: it all goes through JSON, as it does through process_cost_records and
// reference_data_snapshots.

const REF = realPlasticReference();
const ROWS = canonicalReferenceRows(realReferenceRows());
const PRESS = realPress('Arburg Allrounder 420 C 1300 - 350');
const rate = (machineClass: string, usd: number, name: string | null) => ({ rate: usd, labourRate: 34.48, operators: 0.5, source: 'mhr_database' as const, machineClass, machineName: name, commodityCode: null });
const part = (over: Partial<InjectionMoldingCostInput> = {}): InjectionMoldingCostInput => ({
  volume: 50_000, surfaceArea: 40_000, wallThicknessNominalMm: 2, materialGrade: 'ABS', materialCostPerKg: 3.046, materialDensityKgM3: 1040, materialSource: 'db',
  batchSize: 250, family: 'plastic_molded', mhrRate: { ...rate('injection_molding', PRESS.mhrUsd, 'Arburg Allrounder 420 C 1300 - 350'), setupTimeHr: 2 },
  deburrRate: rate('deburring', 0, null), inspectionRate: rate('cmm', 0, null), machineClampTonnes: PRESS.maxTonnage, machineShotCapacityG: PRESS.shotCapacityGrams,
  pressTiming: PRESS.timing, goodPartYield: PRESS.goodPartYield, materialClamp: realMaterialClamp('ABS'), realResinInputs: realResinInputs('ABS'), materialType: 'ABS',
  plasticReference: REF, location: 'USA', annualVolume: 100_000, productionLifeYears: 3, signals: { projectedAreaMm2: 10_000, undercutCount: 2, partingComplexity: 0.4 },
  ...over,
});

/** What the database holds after an apply: the line's money and its snapshot, both as JSON. */
function saveLine(input: InjectionMoldingCostInput) {
  const line = computeInjectionMoldedCostSummary(input).processLines.find((l) => l.calculationSnapshot)!;
  const saved = JSON.parse(JSON.stringify({ setupCost: line.setupCost, runCost: line.runCost, totalCost: line.totalCost, machineCostPerPart: line.machineCostPerPart, laborCostPerPart: line.laborCostPerPart }));
  const snapshot = JSON.parse(JSON.stringify(line.calculationSnapshot)) as CalculationSnapshot;
  return { saved, snapshot };
}
const storedRows = () => JSON.parse(JSON.stringify(ROWS));

describe('replaying a saved plastic calculation from what is persisted', () => {
  it('the stored rows hash to the snapshot fingerprint: the store holds exactly what the calculation read', () => {
    expect(fingerprintRows(storedRows())).toBe(saveLine(part()).snapshot.referenceData.fingerprint);
  });

  it('recomputes the saved line exactly: every amount, from the snapshot JSON and the stored rows alone', () => {
    const { saved, snapshot } = saveLine(part());
    const r = replayPlasticLine(snapshot, storedRows(), saved);
    expect(r).toMatchObject({ reproduced: true, reasons: [] });
    expect(r.replayed!.totalCost).toBe(saved.totalCost);
  });

  it('reproduces different parts, presses and scenarios the same way (the snapshot carries what made them differ)', () => {
    for (const over of [
      { volume: 12_000, wallThicknessNominalMm: 1.5, batchSize: 1000 },
      { annualVolume: 2_000_000, productionLifeYears: 5, cavityCountOverride: 2 },
      { signals: { projectedAreaMm2: 6_000, undercutCount: 0, partingComplexity: 0.1 }, mhrRate: { ...rate('injection_molding', 40, 'x'), setupTimeHr: 1, operators: 1 } },
    ]) {
      const { saved, snapshot } = saveLine(part(over));
      expect(replayPlasticLine(snapshot, storedRows(), saved).reproduced).toBe(true);
    }
  });

  it('still reproduces the OLD number after the live reference data and the engine inputs have moved on (what identifying by fingerprint alone could not do)', () => {
    const { saved, snapshot } = saveLine(part());
    // today's data differs: a changed clamp-model variable gives a different fingerprint and, run live, a different cost
    const moved = { ...ROWS, variables: ROWS.variables.map((v) => (v.key === 'cycleTimeAdjustmentFactor' ? { ...v, value: Number(v.value) * 1.5 } : v)) };
    expect(fingerprintRows(moved)).not.toBe(snapshot.referenceData.fingerprint);
    const movedReference = resolvePlasticReference({ variables: moved.variables, lookups: moved.lookups, ...(moved.gppsMaterial ? { gppsMaterial: moved.gppsMaterial } : {}) }).reference!;
    const nowLive = computeInjectionMoldedCostSummary(part({ plasticReference: movedReference }));
    expect(nowLive.processLines.find((l) => l.calculationSnapshot)!.totalCost).not.toBe(saved.totalCost);
    // the replay uses the stored rows, not today's: the saved number comes back
    expect(replayPlasticLine(snapshot, storedRows(), saved).reproduced).toBe(true);
  });

  it('refuses, and says why, when the reference rows were not stored', () => {
    const { saved, snapshot } = saveLine(part());
    const r = replayPlasticLine(snapshot, null, saved);
    expect(r.reproduced).toBe(false);
    expect(r.reasons[0]).toContain(`reference rows for fingerprint ${snapshot.referenceData.fingerprint} are not stored`);
  });

  it('refuses when the stored rows were altered (they no longer match the fingerprint), instead of replaying altered data', () => {
    const { saved, snapshot } = saveLine(part());
    const altered = storedRows();
    altered.variables[0].value = 12345;
    const r = replayPlasticLine(snapshot, altered, saved);
    expect(r.reproduced).toBe(false);
    expect(r.reasons[0]).toContain('altered');
  });

  it('refuses when a formula it used has changed version: today\'s code is not the code that made the number', () => {
    const { saved, snapshot } = saveLine(part());
    const old = { ...snapshot, formulas: snapshot.formulas.map((f) => (f.id === 'F-04' ? { ...f, version: 0 } : f)) };
    const r = replayPlasticLine(old, storedRows(), saved);
    expect(r.reproduced).toBe(false);
    expect(r.reasons[0]).toContain('F-04 is now version 1 (calculated with version 0)');
    expect(r.reasons[0]).toContain('not available to replay');
  });

  it('refuses a calculation saved before inputs were recorded', () => {
    const { saved, snapshot } = saveLine(part());
    const r = replayPlasticLine({ ...snapshot, inputs: {} }, storedRows(), saved);
    expect(r).toMatchObject({ reproduced: false, reasons: ['the inputs were not recorded with this calculation'] });
  });

  it('reports a difference when the saved amounts are not what the stored inputs give (a row edited after it was saved)', () => {
    const { saved, snapshot } = saveLine(part());
    const r = replayPlasticLine(snapshot, storedRows(), { ...saved, totalCost: saved.totalCost + 0.01 });
    expect(r.reproduced).toBe(false);
    expect(r.reasons[0]).toMatch(/^totalCost: saved .*, recomputed /);
  });

  it('the snapshot stays small enough to store on every row (inputs included, without the reference or the machine selection log)', () => {
    expect(JSON.stringify(saveLine(part()).snapshot).length).toBeLessThan(6000);
  });

  describe('auditable: the evidence a replay stands on, and no way to the live data', () => {
    it('a reproduction names every check it made, in order, and what it stood on', () => {
      const { saved, snapshot } = saveLine(part());
      const r = replayPlasticLine(snapshot, storedRows(), saved);
      expect(r.audit.map((a) => a.split(':')[0])).toEqual(['inputs', 'engine contract', 'formulas', 'reference rows', 'recomputed', 'compared']);
      expect(r.audit[3]).toContain('the stored copy (not the live data)');
      expect(r.audit[3]).toContain(snapshot.referenceData.fingerprint);
      expect(r.audit[2]).toContain('F-04 v1');
      expect(r.audit[5]).toMatch(/5 amounts, all equal/);
      expect(r.evidence).toEqual({
        referenceSource: 'stored', snapshotFingerprint: snapshot.referenceData.fingerprint, storedRowsFingerprint: snapshot.referenceData.fingerprint,
        fingerprintVerified: true, formulaVersionsMatch: true, engineVersionRecorded: 'emithran-cost-1', engineVersionNow: 'emithran-cost-1', inputsRecorded: true,
      });
    });

    it('a refusal is on the audit trail too, after the checks that passed, and the evidence shows which did not', () => {
      const { saved, snapshot } = saveLine(part());
      const r = replayPlasticLine(snapshot, null, saved);
      expect(r.audit[r.audit.length - 1]).toMatch(/^REFUSED: the reference rows for fingerprint .* are not stored$/);
      expect(r.evidence).toMatchObject({ referenceSource: 'unavailable', storedRowsFingerprint: null, fingerprintVerified: false, formulaVersionsMatch: true });
      expect(r.replayed).toBeNull();
    });

    it('altered rows are named as such in the evidence: the stored fingerprint no longer equals the recorded one', () => {
      const { saved, snapshot } = saveLine(part());
      const altered = storedRows();
      altered.variables[0].value = 999;
      const r = replayPlasticLine(snapshot, altered, saved);
      expect(r.evidence.fingerprintVerified).toBe(false);
      expect(r.evidence.storedRowsFingerprint).not.toBe(r.evidence.snapshotFingerprint);
    });

    it('never uses the live reference data, even if the snapshot\'s own inputs try to carry one: the stored rows always win', () => {
      const { saved, snapshot } = saveLine(part());
      const moved = { ...ROWS, variables: ROWS.variables.map((v) => (v.key === 'cycleTimeAdjustmentFactor' ? { ...v, value: Number(v.value) * 2 } : v)) };
      const liveMoved = resolvePlasticReference({ variables: moved.variables, lookups: moved.lookups, ...(moved.gppsMaterial ? { gppsMaterial: moved.gppsMaterial } : {}) }).reference!;
      const smuggled = { ...snapshot, inputs: { ...snapshot.inputs, plasticReference: liveMoved, plasticReferenceMissing: ['x'] } };
      expect(replayPlasticLine(smuggled as unknown as CalculationSnapshot, storedRows(), saved).reproduced).toBe(true);
    });

    it('the replay module has no way to reach live data: it imports no database, no service and no reference loader (a structural guarantee, not a convention)', () => {
      const source = readFileSync(join(__dirname, '../../../../../modules/bom-items/costing/plastic-molding/calculation-replay.ts'), 'utf8');
      const imports = [...source.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]!);
      expect(imports.filter((i) => /database|service|nestjs|postgrest|db\//i.test(i))).toEqual([]);
    });

    it('with no stored rows it does not fall back to anything: it refuses', () => {
      const { saved, snapshot } = saveLine(part());
      expect(replayPlasticLine(snapshot, null, saved)).toMatchObject({ reproduced: false, replayed: null });
    });

    it('refuses when the engine contract has changed: the code outside the registered formulas is not the code that made the number', () => {
      const { saved, snapshot } = saveLine(part());
      const r = replayPlasticLine({ ...snapshot, engineVersion: 'emithran-cost-0' }, storedRows(), saved);
      expect(r.reproduced).toBe(false);
      expect(r.reasons[0]).toContain('emithran-cost-1 (calculated with emithran-cost-0)');
      expect(r.evidence.engineVersionRecorded).toBe('emithran-cost-0');
    });
  });
});
