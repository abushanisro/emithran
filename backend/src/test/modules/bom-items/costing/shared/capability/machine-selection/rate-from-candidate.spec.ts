import { mhrRateFromCandidate } from '../../../../../../../modules/bom-items/costing/shared/capability/machine-selection/rate-from-candidate';
import type { MachineCandidate } from '../../../../../../../modules/bom-items/dto/machine-selection.dto';

const press = {
  machineId: 'm1', machineName: 'Kawaguchi KM80', commodityCode: null, hourlyRate: 22.69, operators: 2, laborRateUsdHr: 34.48,
  setupTimeHr: 2, directOverheadRate: null, indirectOverheadRate: null,
} as unknown as MachineCandidate;

describe('mhrRateFromCandidate', () => {
  it('carries what the engines charge: the machine rate, its setup time, its operators, and its labour rate in the factory currency', () => {
    const rate = mhrRateFromCandidate(press, 'injection_molding', 1.5);
    expect(rate).toMatchObject({
      rate: 22.69, source: 'mhr_database', machineClass: 'injection_molding', machineName: 'Kawaguchi KM80',
      setupTimeHr: 2, operators: 2, labourRate: 34.48 * 1.5, machineLaborRateUsdHr: 34.48, labourRateSource: 'mhr_machine_specific',
    });
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
});
