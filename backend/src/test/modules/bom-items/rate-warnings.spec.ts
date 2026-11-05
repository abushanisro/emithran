import { BOMItemsService } from '../../../modules/bom-items/bom-items.service';

// appendRateWarnings reads nothing from the service, so it is called on its prototype.
const append = (lines: Array<Record<string, unknown>>, location = 'USA') => {
  const result = { processLines: lines, warnings: [] as string[] } as never as { processLines: any[]; warnings: string[] };
  (BOMItemsService.prototype as any).appendRateWarnings.call({}, result, location);
  return result.warnings;
};

describe('appendRateWarnings', () => {
  it('does not claim a machine is missing when none passes the capability check, and says both possible causes', () => {
    const [warning] = append([{ rateSource: 'no_db_rate', machineClass: 'injection_molding' }]);
    expect(warning).toContain('No suitable machine in HR Rates for USA for: injection molding');
    expect(warning).toContain('Either no machine of that class is on file');
    expect(warning).toContain('or none passes the capability check for this part');
  });

  it('says nothing about a line whose gap is already explained, such as a material that cannot be molded', () => {
    expect(append([{ rateSource: 'no_db_rate', machineClass: 'injection_molding', physicsGap: { gapType: 'unsupported_operation', reason: 'x' } }])).toEqual([]);
  });

  it('says nothing when every machine has a rate', () => {
    expect(append([{ rateSource: 'mhr_database', machineClass: 'injection_molding' }])).toEqual([]);
  });
});
