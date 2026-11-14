import { edgeDeburrRow } from '../../../../../../modules/bom-items/costing/machining/lookup/machining-lookup.service';
import { readMachiningMemoryCsv } from '../real-reference-tables';

// The reference deburring table itself (memory/Machining/lookup/tblDeburring__rows.csv): 13 tool types per material code.
const ROWS = readMachiningMemoryCsv('lookup/tblDeburring__rows.csv').map((r) => ({
  ...r, hardness: Number(r['hardness']), linear_speed_mm_s: Number(r['linear_speed_mm_s']),
}));
// variables.csv: defaultExternalEdgeDeburrToolType.
const DEFAULT_TOOL = 'Wire Wheel Brush';

describe('edgeDeburrRow: the deburring tool is the reference default edge tool, not the first row of the table', () => {
  it('reads the Wire Wheel Brush row of the material: 22.7 mm/s for mild steel, 27.4 mm/s for aluminum', () => {
    expect(edgeDeburrRow(ROWS, DEFAULT_TOOL, 'mild_steel')).toMatchObject({ tool_type: 'Wire Wheel Brush', deburr_type: 'Edge', material_cut_code_name: '1.0', linear_speed_mm_s: 22.7 });
    expect(edgeDeburrRow(ROWS, DEFAULT_TOOL, 'aluminum')).toMatchObject({ material_cut_code_name: '30.11', linear_speed_mm_s: 27.4 });
  });

  it('never reads the Deburring Brush, which the table marks "Unused" (it is the table\'s first row: 18.8 mm/s)', () => {
    expect(ROWS[0]).toMatchObject({ tool_type: 'Deburring Brush', deburr_type: 'Unused', linear_speed_mm_s: 18.8 });
    expect(edgeDeburrRow(ROWS, DEFAULT_TOOL, 'mild_steel')!.deburr_type).not.toBe('Unused');
  });

  it('is missing, not guessed, when the default tool is not staged or the table has no such tool', () => {
    expect(edgeDeburrRow(ROWS, null, 'mild_steel')).toBeNull();
    expect(edgeDeburrRow(ROWS, 'Laser Deburr', 'mild_steel')).toBeNull();
  });
});
