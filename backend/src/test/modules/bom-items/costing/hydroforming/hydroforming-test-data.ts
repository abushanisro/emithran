// The real memory/Sheetmetal Hydroforming data as the staged rows and HR Rates machines the engine reads (the presses rated as migration 1109
// rates them: the Netherlands export's overheads, the 3 - Metal labour, the exports' forming and stroke times), and the tool shop, for the
// hydroforming tests. Everything is read from memory/.
import { readdirSync } from 'fs';
import { join } from 'path';

import { resolveSandReference } from '../../../../../modules/bom-items/costing/casting/sand/sand-reference';
import { resolveToolShop, type ToolShop } from '../../../../../modules/bom-items/costing/casting/tool-shop';
import { HYDROFORMING_CLASS, type HydroformingMaterial } from '../../../../../modules/bom-items/costing/hydroforming/hydroforming-route';
import { machineOf } from '../additive/additive-test-data';

import type { SandMachine } from '../../../../../modules/bom-items/costing/casting/sand/sand-machines';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readCsv, specKey } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js') as {
  readCsv: (p: string) => { columns: string[]; rows: Record<string, unknown>[] };
  specKey: (h: string) => string;
};

const MEMORY = join(__dirname, '../../../../../../../memory');
const DIR = join(MEMORY, 'Sheetmetal Hydroforming');
const rows = (path: string) => readCsv(path).rows;

const stagedVariables = rows(join(DIR, 'hydroforming_digital_factory_variables (1).csv'))
  .map((r) => ({ key: String(r['Variable Name']), value: r['String Value'] == null ? null : String(r['String Value']), unit_type: (r['Unit Type Name'] as string) || null }));
const stagedLookups = readdirSync(join(DIR, 'Lookup')).filter((f) => f.endsWith('.csv')).map((f) => ({ key: f.replace(/\.csv$/, ''), raw: { rows: rows(join(DIR, 'Lookup', f)) } }));
export const realHydroformingReference = () => resolveSandReference({ variables: stagedVariables, lookups: stagedLookups });

/** The Netherlands export's Sheet Metal - Hydroforming row of each machine (migration 1109's USA rates and the exports' timing). */
const netherlands = new Map(rows(join(MEMORY, 'Countries data/Netherlands_XML_Data_.csv'))
  .filter((r) => r.Commodity === 'Sheet Metal - Hydroforming').map((r) => [String(r.name), r]));
const fromCsv = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([h, v]) => [specKey(h.replace(/^\uFEFF/, '')), v]));
export const USA_LABOUR_3_METAL = 36.3;

function presses(): SandMachine[] {
  return rows(join(DIR, 'Machine/machines_hydroform.csv')).map((r, i) => {
    const row = fromCsv(r);
    const nl = netherlands.get(String(row.name))!;
    return machineOf({
      ...row, labor_rate_usd_per_hr: USA_LABOUR_3_METAL,
      direct_overhead_rate_usd_per_hr: Math.round(Number(nl.customWorkCenterDirectOverheadRate) * 100) / 100,
      indirect_overhead_rate_usd_per_hr: Math.round(Number(nl.customWorkCenterIndirectOverheadRate) * 100) / 100,
      machine_forming_cycle_time_s: Number(nl.machineFormingCycleTime),
    }, HYDROFORMING_CLASS.press, i);
  });
}

function blankPresses(): SandMachine[] {
  return rows(join(DIR, 'Machine/machines_offline_blank.csv')).map((r, i) => {
    const row = fromCsv(r);
    const nl = netherlands.get(String(row.name))!;
    return machineOf({
      ...row,
      press_cycle_time_s: Number(nl.pressCycleTime), mass_coeff_handling_time_s_per_kg: Number(nl.massCoeffHandlingTime),
      const_coeff_handling_time_s: Number(nl.constCoeffHandlingTime), max_part_length_mm: Number(nl.maxPartLength), max_part_width_mm: Number(nl.maxPartWidth),
      pitch_margin_mm: Number(nl.pitchMargin), side_margin_mm: Number(nl.sideMargin),
    }, HYDROFORMING_CLASS.blank, i);
  });
}

export const allHydroformingMachines = (): Record<string, SandMachine[]> => ({ [HYDROFORMING_CLASS.press]: presses(), [HYDROFORMING_CLASS.blank]: blankPresses() });

/**
 * The Digital Factory USA Default tool shop (memory/plastic modeling/process), as CastingReferenceService.getToolShop reads it. The folder is
 * spelled as the reference-data repository has it (lowercase): CI checks that repository out on a case-sensitive file system.
 */
export function realToolShop(): ToolShop {
  const { shop, missing } = resolveToolShop({
    digital_factory_settings_usa: rows(join(MEMORY, 'plastic modeling/process/digital_factory_settings_usa.csv')),
    digital_factory_tool_materials_usa: rows(join(MEMORY, 'plastic modeling/process/digital_factory_tool_materials_usa.csv')),
  });
  if (!shop) throw new Error(missing.join('; '));
  return shop;
}

/** A cold-rolled steel sheet (the numbers a Ferrous & Non-Ferrous row resolves to): 7850 kg/m³, 1.75 USD/kg, UTS 330, shear 250. */
export const MILD_STEEL: HydroformingMaterial = {
  id: 'raw-materials:steel-cr-1010', name: 'Steel, Cold Rolled, AISI 1010', materialType: 'Steel', densityKgM3: 7850, costPerKgUsd: 1.75, utsMpa: 330, shearStrengthMpa: 250,
};

/** Memory's catalog of the process (memory/Sheetmetal Hydroforming/operations, staged as process_taxonomy_operations): each row once. */
export const realHydroformingCatalog = (): string[] =>
  [...new Set(rows(join(DIR, 'operations (6).csv')).map((r) => (typeof r['Process Name'] === 'string' ? r['Process Name'].trim() : '')).filter((s) => s.includes('//')))];
