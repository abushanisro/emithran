import { validateAbstractPlan } from './abstract-plan.validator';
import type { CandidateSet } from '../dto/candidate-set.dto';

const candidates: CandidateSet = {
  rawMaterials: [
    { candidateId: 'rm-1', dbId: 'mat-abc', materialGroup: 'Ferrous & Non-Ferrous', material: 'Aluminium 6061', grade: '6061-T6', densityKgPerM3: 2700, unitCostInrPerKg: 342, location: 'India-Bangalore', score: 0.9 },
  ],
  machines: [
    { candidateId: 'mc-1', dbId: 'mhr-abc', machineName: 'ASC Lathe 320', commodityCode: 'LATHE', description: 'CNC Lathe', rateInrPerHour: 540, location: 'India-Bangalore', processFamily: 'cnc_turned', score: 0.9 },
  ],
  labour: [
    { candidateId: 'lb-1', dbId: 'lhr-abc', labourType: 'Skilled', labourCode: 'SKL-01', lhrInrPerHour: 62, location: 'India-Bangalore', score: 0.9 },
  ],
  processes: [
    { candidateId: 'op-1', dbId: 'proc-abc', processGroup: 'CNC Machining', processRoute: 'Turning', operation: 'Turning', calculatorId: null, score: 0.9, referenceTables: [] },
  ],
  calculators: [
    { candidateId: 'cl-1', dbId: 'calc-abc', name: 'Machining Cost', calcCategory: 'process', description: null, score: 0.7, fields: [], formulas: [] },
  ],
  tooling: [],
};

const validPlan = {
  partFamily: 'cnc_turned',
  rawMaterials: [{
    candidateId: 'rm-1',
    grossUsageKg: 0.0033,
    netUsageKg: 0.0027,
    scrapPct: 22,
    overheadPct: 5,
    reason: 'Pin in 6061-T6, 1000/yr → standard wrought al.',
  }],
  processes: [{
    opNbr: 10,
    candidateId: 'op-1',
    machineCandidateId: 'mc-1',
    labourCandidateId: 'lb-1',
    calculatorCandidateId: 'cl-1',
    setupMin: 20,
    setupManning: 1,
    batchSize: 250,
    heads: 1,
    cycleSec: 35,
    partsPerCycle: 1,
    scrapPct: 3,
    reason: 'Primary turning on mc-1; cycle from 515mm³ + DFM.',
  }],
  tooling: [],
  logistics: [],
  procuredParts: [],
  proposedMasters: [],
};

describe('validateAbstractPlan', () => {
  it('accepts a valid plan', () => {
    const r = validateAbstractPlan(validPlan, candidates);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.partFamily).toBe('cnc_turned');
  });

  it('rejects unknown rm candidateId', () => {
    const bad = { ...validPlan, rawMaterials: [{ ...validPlan.rawMaterials[0], candidateId: 'rm-99' }] };
    const r = validateAbstractPlan(bad, candidates);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/rm-99/);
  });

  it('rejects when both candidateId and proposedMasterId are set on the same line', () => {
    const bad = {
      ...validPlan,
      rawMaterials: [{
        ...validPlan.rawMaterials[0],
        candidateId: 'rm-1',
        proposedMasterId: 'pm-1',
      }],
    };
    const r = validateAbstractPlan(bad, candidates);
    expect(r.ok).toBe(false);
  });

  it('rejects when gross < net (impossible)', () => {
    const bad = { ...validPlan, rawMaterials: [{ ...validPlan.rawMaterials[0], grossUsageKg: 0.001, netUsageKg: 0.005 }] };
    const r = validateAbstractPlan(bad, candidates);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/grossUsageKg.*netUsageKg/i);
  });

  it('rejects scrapPct out of range', () => {
    const bad = { ...validPlan, processes: [{ ...validPlan.processes[0], scrapPct: 150 }] };
    const r = validateAbstractPlan(bad, candidates);
    expect(r.ok).toBe(false);
  });

  it('rejects unknown machineCandidateId', () => {
    const bad = { ...validPlan, processes: [{ ...validPlan.processes[0], machineCandidateId: 'mc-99' }] };
    const r = validateAbstractPlan(bad, candidates);
    expect(r.ok).toBe(false);
  });

  it('requires at least one process op', () => {
    const bad = { ...validPlan, processes: [] };
    const r = validateAbstractPlan(bad, candidates);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/at least 1/i);
  });

  it('caps reason at 240 chars', () => {
    const bad = { ...validPlan, rawMaterials: [{ ...validPlan.rawMaterials[0], reason: 'x'.repeat(300) }] };
    const r = validateAbstractPlan(bad, candidates);
    expect(r.ok).toBe(false);
  });

  it('accepts a proposedMaster referenced from a line', () => {
    const planWithProposed = {
      ...validPlan,
      processes: [{
        ...validPlan.processes[0],
        candidateId: undefined,
        proposedMasterId: 'pm-grind',
      }],
      proposedMasters: [{
        kind: 'process',
        proposedMasterId: 'pm-grind',
        processGroup: 'CNC Machining',
        processRoute: 'Grinding',
        operation: 'Centerless Grinding',
        reason: 'IT8 tolerance + Ra 3.2 implies grinding.',
      }],
    };
    const r = validateAbstractPlan(planWithProposed, candidates);
    expect(r.ok).toBe(true);
  });

  it('rejects a line referencing a non-declared proposedMasterId', () => {
    const planWithDangling = {
      ...validPlan,
      processes: [{
        ...validPlan.processes[0],
        candidateId: undefined,
        proposedMasterId: 'pm-ghost',
      }],
    };
    const r = validateAbstractPlan(planWithDangling, candidates);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/pm-ghost/);
  });
});
