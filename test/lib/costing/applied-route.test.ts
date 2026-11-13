import { describe, expect, it } from 'vitest';

import { routeMachineDrift } from '@/lib/costing/applied-route';

// The applied route is named by its id (a press tier), and the comparison recomputes which press that tier picks. When it now picks another press
// than the one the saved line was costed on, the header must say so instead of naming a press that was not costed.
const line = (process: string, machineClass: string, machineName: string | null) => ({ process, machineClass, machineName });
const saved = (operation: string, machineClass: string, machineName: string | null) => ({ operation, machineClass, machineName });

describe('routeMachineDrift', () => {
  it('names the saved press and the one the route now picks, per operation', () => {
    expect(routeMachineDrift(
      [line('Injection Molding', 'injection_molding', 'Arburg Allrounder 221 K')],
      [saved('Injection Molding', 'injection_molding', 'KraussMaffei 35 CX - 180')],
    )).toEqual([{ process: 'Injection Molding', applied: 'KraussMaffei 35 CX - 180', now: 'Arburg Allrounder 221 K' }]);
  });

  it('is empty when the route still picks the saved machines', () => {
    expect(routeMachineDrift([line('Laser Cutting', 'laser_cutting', 'Trumpf 3030')], [saved('Laser Cutting', 'laser_cutting', 'Trumpf 3030')])).toEqual([]);
  });

  it('pairs by machine class, and by operation when one class runs two operations', () => {
    expect(routeMachineDrift(
      [line('Deburring', 'deburring', 'Timesaver 1'), line('Edge Rounding', 'deburring', 'Timesaver 2')],
      [saved('Edge Rounding', 'deburring', 'Timesaver 2'), saved('Deburring', 'deburring', 'Timesaver 1')],
    )).toEqual([]);
  });

  it('says nothing about a line with no machine on either side, or a saved row the route has no line for', () => {
    expect(routeMachineDrift([line('Tooling', 'tooling', null)], [saved('Tooling', 'tooling', 'X')])).toEqual([]);
    expect(routeMachineDrift([line('Injection Molding', 'injection_molding', 'A')], [saved('Painting', 'painting', 'B')])).toEqual([]);
  });
});
