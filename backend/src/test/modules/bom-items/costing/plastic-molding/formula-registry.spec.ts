import * as fs from 'fs';
import * as path from 'path';

import { formulaById, PLASTIC_FORMULAS, weakestState, type FormulaEntry } from '../../../../../modules/bom-items/costing/plastic-molding/formula-registry';

const COSTING = path.resolve(__dirname, '../../../../../modules/bom-items/costing');
const implemented = PLASTIC_FORMULAS.filter((f) => f.state !== 'UNSUPPORTED');
const unsupported = PLASTIC_FORMULAS.filter((f) => f.state === 'UNSUPPORTED');

describe('plastic formula registry', () => {
  it('has a unique id per formula, F-nn when implemented and G-nn when not', () => {
    const ids = PLASTIC_FORMULAS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of implemented) expect(f.id).toMatch(/^F-\d\d$/);
    for (const f of unsupported) expect(f.id).toMatch(/^G-\d\d$/);
  });

  it('every implemented formula states its expression, unit, inputs with a source, reference source and a positive integer version', () => {
    for (const f of implemented) {
      expect(f.expression.length).toBeGreaterThan(5);
      expect(f.outputUnit).not.toBe('');
      expect(f.referenceSource).not.toBe('');
      expect(f.inputs.length).toBeGreaterThan(0);
      for (const i of f.inputs) { expect(i.name).not.toBe(''); expect(i.unit).not.toBe(''); expect(i.source).not.toBe(''); }
      expect(Number.isInteger(f.version) && f.version >= 1).toBe(true);
    }
  });

  it('VALIDATED has no assumption; ASSUMED states at least one (a silent assumption is the defect this registry exists to prevent)', () => {
    for (const f of PLASTIC_FORMULAS) {
      if (f.state === 'VALIDATED') expect({ id: f.id, assumptions: f.assumptions }).toEqual({ id: f.id, assumptions: [] });
      if (f.state === 'ASSUMED') expect(f.assumptions.length).toBeGreaterThan(0);
    }
  });

  it('UNSUPPORTED has no implementation and no expression: it gives a gap, never an amount', () => {
    for (const f of unsupported) {
      expect(f.implementedIn).toBeNull();
      expect(f.expression).toBe('');
      expect(f.stagedData).toBeTruthy();
    }
  });

  it('dependencies name registered formulas, none depends on an UNSUPPORTED one, and there is no cycle', () => {
    for (const f of PLASTIC_FORMULAS) {
      for (const d of f.dependsOn) {
        const dep = formulaById(d);
        expect({ id: f.id, dep: d, known: !!dep }).toEqual({ id: f.id, dep: d, known: true });
        expect(dep!.state).not.toBe('UNSUPPORTED');
      }
    }
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (f: FormulaEntry) => {
      if (done.has(f.id)) return;
      expect({ cycleAt: f.id, inCycle: visiting.has(f.id) }).toEqual({ cycleAt: f.id, inCycle: false });
      visiting.add(f.id);
      f.dependsOn.forEach((d) => visit(formulaById(d)!));
      visiting.delete(f.id);
      done.add(f.id);
    };
    PLASTIC_FORMULAS.forEach(visit);
  });

  it('every implemented formula names an existing file, and that file names the formula id: the code and the registry cannot drift apart silently', () => {
    for (const f of implemented) {
      expect(f.implementedIn).toBeTruthy();
      const file = path.join(COSTING, f.implementedIn!.startsWith('../') ? f.implementedIn!.replace('../', '') : `plastic-molding/${f.implementedIn}`);
      expect({ id: f.id, file, exists: fs.existsSync(file) }).toEqual({ id: f.id, file, exists: true });
      const text = fs.readFileSync(file, 'utf8');
      expect({ id: f.id, named: new RegExp(`\\b${f.id}\\b`).test(text) }).toEqual({ id: f.id, named: true });
    }
  });

  it('weakestState: a quote is as trustworthy as its weakest step', () => {
    expect(weakestState([])).toBe('VALIDATED');
    expect(weakestState(['VALIDATED', 'VALIDATED'])).toBe('VALIDATED');
    expect(weakestState(['VALIDATED', 'ASSUMED'])).toBe('ASSUMED');
    expect(weakestState(['ASSUMED', 'UNSUPPORTED', 'VALIDATED'])).toBe('UNSUPPORTED');
  });

  it('records what the model cannot yet compute (the register of README section 8): G-01 to G-11', () => {
    expect(unsupported.map((f) => f.id)).toEqual(['G-01', 'G-02', 'G-03', 'G-04', 'G-05', 'G-06', 'G-07', 'G-08', 'G-09', 'G-10', 'G-11']);
  });
});
