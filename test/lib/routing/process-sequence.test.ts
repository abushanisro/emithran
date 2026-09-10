import { describe, it, expect } from 'vitest';
import { sequenceProcessRows } from '@/lib/routing/process-sequence';

// The engine line order for a Laser Punch route on the part that reproduced
// the report, in the order cost-engine.ts emits processLines.
const ENGINE_LINES = [
  { process: 'Laser Punch', machineClass: 'laser_punch' },
  { process: 'Press Brake', machineClass: 'press_brake' },
  { process: 'Deburring', machineClass: 'deburring' },
  { process: 'Inspection', machineClass: 'cmm' },
];

// The rows actually persisted for that part, verified live via
// GET /v1/api/process-costs. Note the catalog operation names ("Bend Brake",
// "Deslag", "CMM Inspection") differ from the engine labels above for the
// very same machine classes.
const STORED = [
  { id: 'a', opNbr: 10, machineClass: 'laser_punch', operation: 'Laser Punch' },
  { id: 'b', opNbr: 20, machineClass: 'press_brake', operation: 'Bend Brake' },
  { id: 'c', opNbr: 30, machineClass: 'deburring', operation: 'Deslag' },
  { id: 'd', opNbr: 40, machineClass: 'cmm', operation: 'CMM Inspection' },
];

function labels(rows: ReturnType<typeof sequenceProcessRows>): string[] {
  return rows.map((r) => (r.kind === 'stored'
    ? String((r.item as { operation?: string }).operation)
    : String((r.item as { process: string }).process)));
}

describe('sequenceProcessRows', () => {
  it('keeps saved rows in their real persisted op_nbr order', () => {
    // The reported bug: this rendered Bend Brake, Deslag, CMM Inspection,
    // Laser Punch because laser_punch was absent from the hardcoded rank
    // table and fell through to rank 99.
    const rows = sequenceProcessRows(STORED, [], ENGINE_LINES);
    expect(labels(rows)).toEqual(['Laser Punch', 'Bend Brake', 'Deslag', 'CMM Inspection']);
  });

  it('reports each saved row real op_nbr rather than its render position', () => {
    const rows = sequenceProcessRows(STORED, [], ENGINE_LINES);
    expect(rows.map((r) => r.opNbr)).toEqual([10, 20, 30, 40]);
  });

  it('orders a cutting class the ordering model has never seen, purely from persisted data', () => {
    // Every class the retired rank table omitted must sort correctly with no
    // entry anywhere: the persisted op_nbr already carries the answer.
    for (const cls of ['plasma_punch', 'oxyfuel_cut', 'shear', 'router_2axis', 'progressive_die_press', 'roll_bending_3']) {
      const stored = [
        { id: '1', opNbr: 10, machineClass: cls, operation: 'Cut' },
        { id: '2', opNbr: 20, machineClass: 'press_brake', operation: 'Bend Brake' },
        { id: '3', opNbr: 30, machineClass: 'cmm', operation: 'CMM Inspection' },
      ];
      expect(labels(sequenceProcessRows(stored, [], []))).toEqual(['Cut', 'Bend Brake', 'CMM Inspection']);
    }
  });

  it('interleaves an unsaved engine line at its real position, not after every saved row', () => {
    // The original defect this merge was built for: a saved Deburr must not
    // outrank an unsaved cutting operation just because it is persisted.
    const storedTail = STORED.filter((s) => s.machineClass !== 'laser_punch');
    const rows = sequenceProcessRows(storedTail, [ENGINE_LINES[0]!], ENGINE_LINES);
    expect(labels(rows)).toEqual(['Laser Punch', 'Bend Brake', 'Deslag', 'CMM Inspection']);
    expect(rows[0]!.kind).toBe('missing');
  });

  it('places an unsaved line between the saved rows it really falls between', () => {
    const withoutDeburr = STORED.filter((s) => s.machineClass !== 'deburring');
    const rows = sequenceProcessRows(withoutDeburr, [ENGINE_LINES[2]!], ENGINE_LINES);
    expect(labels(rows)).toEqual(['Laser Punch', 'Bend Brake', 'Deburring', 'CMM Inspection']);
  });

  it('matches a saved row to its engine line by machine class, not by name', () => {
    // "Bend Brake" (catalog) and "Press Brake" (engine) are the same class;
    // a name-only join would fail to anchor around it.
    const onlyBend = [{ id: 'b', opNbr: 20, machineClass: 'press_brake', operation: 'Bend Brake' }];
    const rows = sequenceProcessRows(onlyBend, [ENGINE_LINES[0]!, ENGINE_LINES[3]!], ENGINE_LINES);
    expect(labels(rows)).toEqual(['Laser Punch', 'Bend Brake', 'Inspection']);
  });

  it('falls back to the process name when a saved row carries no machine class', () => {
    const noClass = [{ id: 'x', opNbr: 20, machineClass: null, operation: 'Deburring' }];
    const rows = sequenceProcessRows(noClass, [ENGINE_LINES[0]!], ENGINE_LINES);
    expect(labels(rows)).toEqual(['Laser Punch', 'Deburring']);
  });

  it('never gives an unsaved line an op number, since it does not have one yet', () => {
    const rows = sequenceProcessRows([], ENGINE_LINES, ENGINE_LINES);
    expect(rows.every((r) => r.opNbr === null)).toBe(true);
    expect(labels(rows)).toEqual(['Laser Punch', 'Press Brake', 'Deburring', 'Inspection']);
  });

  it('appends an operation that belongs to no engine line rather than guessing a position', () => {
    const extra = { process: 'Hand Assembly', machineClass: 'manual_assembly' };
    const rows = sequenceProcessRows(STORED, [extra], ENGINE_LINES);
    expect(labels(rows).at(-1)).toBe('Hand Assembly');
  });

  it('keeps a saved row with no op_nbr in its incoming position instead of jumping it to the front', () => {
    const mixed = [
      { id: 'a', opNbr: 10, machineClass: 'laser_punch', operation: 'Laser Punch' },
      { id: 'z', opNbr: null, machineClass: 'manual_assembly', operation: 'Hand Assembly' },
      { id: 'b', opNbr: 20, machineClass: 'press_brake', operation: 'Bend Brake' },
    ];
    expect(labels(sequenceProcessRows(mixed, [], ENGINE_LINES)))
      .toEqual(['Laser Punch', 'Bend Brake', 'Hand Assembly']);
  });

  it('handles both lists being empty', () => {
    expect(sequenceProcessRows([], [], ENGINE_LINES)).toEqual([]);
  });

  it('does not mutate its inputs', () => {
    const stored = [...STORED];
    const missing = [ENGINE_LINES[0]!];
    sequenceProcessRows(stored, missing, ENGINE_LINES);
    expect(stored.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(missing).toHaveLength(1);
  });
});
