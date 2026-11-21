// The real memory/Roto & blow molding data as the staged rows, HR Rates machines and materials the engine reads, for the Roto & Blow Molding
// tests. Everything is read from the folder.
import { readdirSync } from 'fs';
import { join } from 'path';
import { resolveSandReference } from '../../../../../modules/bom-items/costing/casting/sand/sand-reference';
import type { SandMachine } from '../../../../../modules/bom-items/costing/casting/sand/sand-machines';
import { ROTO_BLOW_CLASS, type RotoBlowMaterial } from '../../../../../modules/bom-items/costing/roto-blow/roto-blow-route';
import { machineOf } from '../additive/additive-test-data';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv, specKey } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const DIR = join(__dirname, '../../../../../../../memory/Roto & blow molding');
const rows = (rel: string): Array<Record<string, any>> => readCsv(join(DIR, rel)).rows;

const stagedVariables = rows('roto_blow_molding_variables.csv').map((r) => ({ key: String(r['Variable Name']), value: r['String Value'] == null ? null : String(r['String Value']), unit_type: r['Unit Type Name'] || null }));
const stagedLookups = readdirSync(join(DIR, 'Lookup')).filter((f) => f.endsWith('.csv')).map((f) => ({ key: f.replace(/\.csv$/, ''), raw: { rows: rows(`Lookup/${f}`) } }));
export const realRotoBlowReference = () => resolveSandReference({ variables: stagedVariables, lookups: stagedLookups });

function machines(file: string, machineClass: string): SandMachine[] {
  return rows(`Machines/${file}`).map((r, i) => machineOf(Object.fromEntries(Object.entries(r).map(([h, v]) => [specKey(String(h).replace(/^﻿/, '')), v])), machineClass, i));
}

export const allRotoBlowMachines = (): Record<string, SandMachine[]> => ({
  [ROTO_BLOW_CLASS.blow]: machines('machines_extrusion_blow_mold.csv', ROTO_BLOW_CLASS.blow),
  [ROTO_BLOW_CLASS.roto]: machines('machines_rotational_mold.csv', ROTO_BLOW_CLASS.roto),
  [ROTO_BLOW_CLASS.router]: machines('machines_router.csv', ROTO_BLOW_CLASS.router),
  [ROTO_BLOW_CLASS.saw]: machines('machines_saw.csv', ROTO_BLOW_CLASS.saw),
  [ROTO_BLOW_CLASS.grind]: machines('machines_grind.csv', ROTO_BLOW_CLASS.grind),
});

/** A material of memory/Roto & blow molding/Raw materials, as the cost service reads it (raw_materials and its properties). */
export function rotoBlowMaterial(name: string): RotoBlowMaterial {
  const r = rows('Raw materials/raw_materials.csv').find((m) => m['Name'] === name);
  if (!r) throw new Error(`no Roto & Blow Molding material ${name}`);
  const n = (h: string) => (r[h] == null || r[h] === '' ? null : Number(r[h]));
  return {
    id: `raw-materials:${name}`, name, materialType: String(r['Material Type']), densityKgM3: n('Density (kg / m^3)'), costPerKgUsd: n('Unit Cost (USD / kg)'),
    canBlowMold: String(r['Can Blow Mold']) === 'true', canRotoMold: String(r['Can Rotational Mold']) === 'true',
    melt: {
      meltingTempC: n('Melting Temp (°C)'), moldTempC: n('Mold Temp (°C)'), ejectTempC: n('Eject Deflection Temp (°C)'),
      specificHeatJgC: n('Specific Heat of Melt (J / g * °C)'), conductivityWMC: n('Thermal Conductivity of Melt (Watts / m * °C)'), densityKgM3: n('Density of Melt (kg / m^3)'),
    },
  };
}
