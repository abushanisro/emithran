import { handlingBands, handlingTime } from '../../../../../modules/bom-items/costing/casting/sand/sand-handling';
import { realSandReference } from './sand-test-data';

// lookupTables_Component_tblHandlingTimes: equipment, handling time (s), max weight (kg):
//   none 1 s to 0.25 kg, 2 s to 1 kg, 10 s to 5 kg, 30 s to 15 kg, 45 s to 20 kg; forklift 540 s to 300 kg, 900 s to 500 kg; crane 1800 s to 2000 kg, 2700 s beyond.
const ref = realSandReference();

describe('handlingTime: the band of tblHandlingTimes that takes the weight', () => {
  it.each([
    [0.1, 'none', 1],
    [0.25, 'none', 1], // a band takes up to and including its maximum
    [0.26, 'none', 2],
    [1, 'none', 2],
    [2.112, 'none', 10], // the 200 x 100 x 60 mm core of the tests
    [5, 'none', 10],
    [15, 'none', 30],
    [20, 'none', 45],
    [20.5, 'forklift', 540], // beyond what hands take, the table's next band is a forklift
    [300, 'forklift', 540],
    [301, 'forklift', 900],
    [501, 'crane', 1800],
    [5000, 'crane', 2700],
  ])('%f kg: %s, %i s', (kg, equipment, seconds) => {
    expect(handlingTime(ref, kg)).toMatchObject({ equipment, seconds });
  });

  it('reads the bands lightest first, and a weight beyond every band has none', () => {
    const bands = handlingBands(ref);
    expect(bands.map((b) => b.maxKg)).toEqual([...bands.map((b) => b.maxKg)].sort((a, b) => a - b));
    expect(handlingTime(ref, 1e9)).toBeNull();
  });
});
