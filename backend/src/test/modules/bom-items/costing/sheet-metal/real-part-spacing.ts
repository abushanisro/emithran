import { readFileSync } from 'fs';
import { join } from 'path';
import type { PartSpacingRow } from '../../../../../modules/bom-items/costing/sheet-metal/machine/sheet-metal-nesting.engine';

/** tblPartSpacing, every row, read from the file migration 518 staged. */
export function realPartSpacingTable(): PartSpacingRow[] {
  const text = readFileSync(
    join(__dirname, '../../../../../../../memory/Sheetmetal/lookuptable/digital_factory_lookup_tables__tblPartSpacing.csv'), 'utf-8',
  );
  return text.split(/\r?\n/).slice(1).filter(Boolean).map((l) => {
    const [process, t, sp] = l.split(',');
    return { process: process!, thicknessMm: Number(t), spacingMm: Number(sp) };
  });
}
