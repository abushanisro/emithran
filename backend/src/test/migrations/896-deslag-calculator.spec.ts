// Migration 896 must make the Deslag calculator's stored formula the same
// product the physics function computes (PHYSICS_REGISTRY.deburring).
import * as fs from 'fs';
import * as path from 'path';
import { PHYSICS_REGISTRY } from '../../modules/calculators/physics-registry';

const sql = fs.readFileSync(path.resolve(__dirname, '../../../migrations/896_deslag_calculator_burr_edge_formula.sql'), 'utf8');

describe('migration 896 — Deslag calculator burr edge formula', () => {
  it('removes the laser-style inputs (cut length, pierces, fixed rates)', () => {
    expect(sql).toMatch(/field_name IN \('Length Of Cut \(mm\)', 'No Of Starts', 'Sec Per Metre', 'Sec Per Pierce'\)/);
  });

  it('adds exactly the two inputs the physics function reads', () => {
    for (const f of ['Burr Edge Length', 'Deburr Time Per mm']) expect(sql).toContain(`('${f}',`);
  });

  it('stores the same formula the physics function computes', () => {
    expect(sql).toContain("SET default_value = '{Burr Edge Length} * {Deburr Time Per mm}'");
    const r = PHYSICS_REGISTRY.deburring!({ 'Burr Edge Length': 500, 'Deburr Time Per mm': 0.02 });
    expect(r['Total Time']).toBeCloseTo(500 * 0.02, 9);
  });

  it('is re-runnable: inserts only fields that are not there yet', () => {
    expect(sql).toContain('WHERE NOT EXISTS');
  });
});
