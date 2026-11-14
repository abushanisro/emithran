import { SAND_CASTING_ROUTE_ID, sandCastingRoute } from '../../../../../modules/bom-items/costing/casting/sand/sand-route-comparison';
import type { CostSummaryResponseDto, ProcessLineCost } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';

// A sand-cast part's route in the route comparison is its cost summary as quoted (the same lines, the same total), so the Workflow Builder lists it
// and Apply saves its steps as the item's process records (replacing whatever another process left there).
const line = (process: string, machine: string, cost: number): ProcessLineCost =>
  ({ process, machineClass: process, machineName: machine, totalCost: cost, cycleTimeMin: 0.1, costStatus: 'costed' }) as unknown as ProcessLineCost;

const summary = (over: Partial<CostSummaryResponseDto> = {}): CostSummaryResponseDto => ({
  processLines: [line('Melting', 'Induction', 0.01), line('No Bake coremaking', 'Core shooter', 0.26), line('Horizontal Automatic', 'Hunter HMP10-H', 0.21)],
  materialCost: 0.23,
  totalProcessCost: 0.48,
  totalCost: 0.71,
  cycleTimes: { totalMin: 0.3 },
  warnings: ['Measured by the cad-engine'],
  ratesSource: 'HR Rates',
  sandCasting: { mouldingProcess: 'Horizontal Automatic', complete: true },
  ...over,
}) as unknown as CostSummaryResponseDto;

describe('sandCastingRoute', () => {
  it('is the quoted summary: its lines, material, process and total cost, named by its moulding process', () => {
    const r = sandCastingRoute(summary());
    expect(r.routeId).toBe(SAND_CASTING_ROUTE_ID);
    expect(r.routeLabel).toBe('Sand casting · Horizontal Automatic');
    expect(r.processLines.map((l) => l.process)).toEqual(['Melting', 'No Bake coremaking', 'Horizontal Automatic']);
    expect(r).toMatchObject({ materialCost: 0.23, totalProcessCost: 0.48, totalCost: 0.71, isFeasible: true });
    expect(r.cycleTimes.totalMin).toBe(0.3);
    expect(r.warnings).toContain('Measured by the cad-engine');
  });

  it('is not feasible when the summary could not cost the part (no total), and says why', () => {
    const r = sandCastingRoute(summary({ totalCost: null as unknown as number, sandCasting: { mouldingProcess: 'Horizontal Automatic', complete: false } as never }));
    expect(r.isFeasible).toBe(false);
    expect(r.totalCost).toBeNull();
    expect(r.capability.warnings.join(' ')).toMatch(/incomplete/);
  });

  it('is named plainly when the moulding process is not known yet', () => {
    expect(sandCastingRoute(summary({ sandCasting: undefined })).routeLabel).toBe('Sand casting');
  });
});
