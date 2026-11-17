import { convertSelectionRates, mhrRateFromCandidate } from '../../../../../../../modules/bom-items/costing/shared/capability/machine-selection/rate-from-candidate';
import type { MachineCandidate, MachineSelectionResult } from '../../../../../../../modules/bom-items/dto/machine-selection.dto';

const press = {
  machineId: 'm1', machineName: 'Kawaguchi KM80', commodityCode: null, hourlyRate: 22.69, operators: 2, laborRateUsdHr: 34.48,
  setupTimeHr: 2, directOverheadRate: null, indirectOverheadRate: null,
} as unknown as MachineCandidate;

describe('mhrRateFromCandidate', () => {
  it('carries what the engines charge: the machine rate, its setup time, its operators, and its labour rate, both in the factory currency', () => {
    const rate = mhrRateFromCandidate(press, 'injection_molding', 1.5);
    expect(rate).toMatchObject({
      rate: 22.69 * 1.5, source: 'mhr_database', machineClass: 'injection_molding', machineName: 'Kawaguchi KM80',
      setupTimeHr: 2, operators: 2, labourRate: 34.48 * 1.5, machineLaborRateUsdHr: 34.48, labourRateSource: 'mhr_machine_specific',
    });
  });

  it('a fraction of an operator reaches the engine as it is stored: 0.5 is not rounded to 1', () => {
    expect(mhrRateFromCandidate({ ...press, operators: 0.5 }, 'injection_molding', 1).operators).toBe(0.5);
  });

  it('a machine with no labour rate on file has none: it is not turned into a zero', () => {
    const rate = mhrRateFromCandidate({ ...press, laborRateUsdHr: null }, 'injection_molding', 1);
    expect(rate.labourRate).toBeNull();
    expect(rate.labourRateSource).toBe('no_lhr_rate');
  });

  it('a candidate with no real machine is a rate of 0 the engines name as not costed', () => {
    const rate = mhrRateFromCandidate({ ...press, machineId: null } as MachineCandidate, 'injection_molding', 1);
    expect(rate).toMatchObject({ rate: 0, source: 'no_db_rate', labourRate: null });
  });

  it('an India machine (HR Rates holds it in USD, as every location) is in rupees with its labour: not its USD number read as rupees', () => {
    // Makino V22, India: 9.69 USD/hr machine, 2.75 USD/hr labour; 1 USD = 64.3455 INR.
    const rate = mhrRateFromCandidate({ ...press, hourlyRate: 9.69, laborRateUsdHr: 2.75 }, '3_axis_mill', 64.3455);
    expect(rate.rate).toBeCloseTo(623.51, 2);
    expect(rate.labourRate).toBeCloseTo(176.95, 2);
  });

  it('the machine list the line carries is in the same currency as the line', () => {
    const cand = (id: string, hourlyRate: number) => ({ ...press, machineId: id, hourlyRate }) as MachineCandidate;
    const pick = (c: MachineCandidate) => ({ candidate: c, reasons: [] });
    const selection = {
      balanced: pick(cand('a', 10)), cheapest: pick(cand('a', 10)), fastest: pick(cand('b', 12)),
      alternatives: [cand('b', 12)], ranking: [{ machineId: 'a', hourlyRate: 10 }],
    } as unknown as MachineSelectionResult;
    const rate = mhrRateFromCandidate(cand('a', 10), 'injection_molding', 2, selection);
    expect(rate.selection!.balanced.candidate.hourlyRate).toBe(20);
    expect(rate.selection!.fastest.candidate.hourlyRate).toBe(24);
    expect(rate.selection!.alternatives[0]!.hourlyRate).toBe(24);
    expect(rate.selection!.ranking![0]!.hourlyRate).toBe(20);
    expect(selection.balanced.candidate.hourlyRate).toBe(10); // the selection given is not changed
    expect(mhrRateFromCandidate(cand('a', 10), 'injection_molding', 1, selection).selection).toBe(selection);
    expect(convertSelectionRates(undefined, (v) => v * 2)).toBeUndefined();
  });
});
