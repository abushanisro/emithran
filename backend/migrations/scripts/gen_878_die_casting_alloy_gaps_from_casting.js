#!/usr/bin/env node
// Generates migration 878: complete the Die Casting alloys
// (memory/Die Casting/Raw Material/materials_master.csv, promoted by 855) from
// the same alloys elsewhere in memory/.
//
// Rules (user decisions 2026-10-04):
//   1. The Die Casting value wins wherever it has one.
//   2. A blank is filled only when every other memory/ file that lists the same
//      alloy (by Name) and states the property agrees on one value. Disagreement
//      leaves it blank and is listed in the migration header.
//   3. A file named X_v2.csv supersedes X.csv in the same folder (the older one
//      is not read).
//   4. Material Type: a blank, or a value every other memory/ file contradicts
//      unanimously, takes the unanimous value. (materials_master.csv has its
//      identity columns shifted by one row from Aluminum Bronze on: Aluminum,
//      AA 1100 is typed Aluminum Bronze there and Aluminum in nine other folders.)
//   5. Only headers in the engine units are read (kg/m^3, MPa, s/mm, C).
//
//   node migrations/scripts/gen_878_die_casting_alloy_gaps_from_casting.js
const fs = require('fs');
const path = require('path');
const { readCsv, sqlStr, sqlNum } = require('./lib/memory-machine-seed.js');

const MEMORY = path.join(__dirname, '../../../memory');
const DIE = path.join(MEMORY, 'Die Casting');
const OUT = path.join(__dirname, '../878_die_casting_alloy_gaps_from_casting.sql');
const SOURCE_VERSION = '2026-DieCasting-xref';

// Header text with spaces and non-ASCII (mis-encoded degree signs) removed, lower case.
const norm = (h) => String(h).toLowerCase().replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, '');
// property -> [Die Casting header, accepted normalized headers elsewhere, unit]
const PROPERTIES = {
  clamping_pressure: ['Clamping Pressure (MPa)', ['clampingpressure(mpa)'], 'MPa'],
  cooling_factor: ['Cooling Factor (s/mm)', ['coolingfactor(s/mm)', 'coolingfactor'], 's/mm'],
  injection_temp: ['Injection Temp (C)', ['injectiontemp(c)'], 'C'],
  liquidus_temp: ['Liquidus Temp (C)', ['liquidustemp(c)'], 'C'],
  mold_temp: ['Mold Temp (C)', ['moldtemp(c)'], 'C'],
  chamber_type: ['Chamber Type', ['chambertype'], null],
};
const DENSITY = ['Density (kg/m^3)', ['density(kg/m^3)']];
// Die Casting chamber code (materials_master Chamber Type): 1 hot, 2 cold.
const CHAMBER = { hot: 1, cold: 2, 1: 1, 2: 2 };
const toValue = (key, v) => {
  if (v === null || v === undefined || v === '') return null;
  if (key === 'chamber_type') return CHAMBER[String(v).trim().toLowerCase()] ?? null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

function csvFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...csvFiles(p));
    else if (e.name.toLowerCase().endsWith('.csv')) out.push(p);
  }
  return out;
}
const all = csvFiles(MEMORY).filter((f) => !f.startsWith(DIE + path.sep));
const superseded = new Set(all.filter((f) => /_v2\.csv$/i.test(f)).map((f) => f.replace(/_v2\.csv$/i, '.csv')));
const sources = all.filter((f) => !superseded.has(f));

const die = readCsv(path.join(DIE, 'Raw Material/materials_master.csv')).rows;
const names = new Set(die.map((r) => r['Name']));

// name -> property -> Map(value -> Set(folder))
const seen = new Map();
const note = (name, key, value, file) => {
  if (value === null) return;
  const byKey = seen.get(name) ?? new Map(); seen.set(name, byKey);
  const byVal = byKey.get(key) ?? new Map(); byKey.set(key, byVal);
  const folder = path.relative(MEMORY, path.dirname(file)).split(path.sep)[0];
  (byVal.get(value) ?? byVal.set(value, new Set()).get(value)).add(folder);
};
for (const f of sources) {
  let t;
  try { t = readCsv(f); } catch { continue; }
  const headers = t.rows.length ? Object.keys(t.rows[0]) : [];
  if (!headers.includes('Name')) continue;
  const pick = (accepted) => headers.filter((h) => accepted.includes(norm(h)));
  const cols = Object.fromEntries(Object.entries(PROPERTIES).map(([k, [, acc]]) => [k, pick(acc)]));
  const dens = pick(DENSITY[1]);
  const type = headers.filter((h) => norm(h) === 'materialtype');
  for (const r of t.rows) {
    if (!names.has(r['Name'])) continue;
    for (const [k, hs] of Object.entries(cols)) for (const h of hs) note(r['Name'], k, toValue(k, r[h]), f);
    for (const h of dens) note(r['Name'], 'density', toValue('density', r[h]), f);
    for (const h of type) if (r[h]) note(r['Name'], 'material_type', String(r[h]).trim(), f);
  }
}

const unanimous = (name, key) => {
  const byVal = seen.get(name)?.get(key);
  if (!byVal || byVal.size === 0) return { value: null, conflict: null };
  if (byVal.size > 1) return { value: null, conflict: [...byVal].map(([v, fs]) => `${v} (${[...fs].join(', ')})`).join(' vs ') };
  const [[value, folders]] = [...byVal];
  return { value, folders: [...folders], conflict: null };
};

const props = [], density = [], types = [], filled = [], open = [];
const blank = (v) => v === null || v === undefined || v === '';
for (const d of die) {
  const name = d['Name'];
  const done = [];
  for (const [key, [dieH, , unit]] of Object.entries(PROPERTIES)) {
    if (!blank(d[dieH])) continue;
    const u = unanimous(name, key);
    if (u.value === null) { open.push(`${name}: ${key} ${u.conflict ? `sources disagree: ${u.conflict}` : 'not in memory/'}`); continue; }
    props.push(`(${sqlStr(name)}, ${sqlStr(key)}, ${sqlNum(u.value)}, ${unit ? sqlStr(unit) : 'NULL'})`);
    done.push(`${key}=${u.value} [${u.folders.join(', ')}]`);
  }
  if (blank(d[DENSITY[0]])) {
    const u = unanimous(name, 'density');
    if (u.value === null) open.push(`${name}: density ${u.conflict ? `sources disagree: ${u.conflict}` : 'not in memory/'}`);
    else { density.push(`(${sqlStr(name)}, ${sqlNum(u.value)})`); done.push(`density=${u.value} [${u.folders.join(', ')}]`); }
  }
  const u = unanimous(name, 'material_type');
  const own = String(d['Material Type'] ?? '').trim();
  if (u.value !== null && u.value !== own) {
    types.push(`(${sqlStr(name)}, ${sqlStr(u.value)})`);
    done.push(`material_type=${u.value}${own ? ` (was ${own})` : ''} [${u.folders.join(', ')}]`);
  } else if (!own && u.value === null) {
    open.push(`${name}: material_type ${u.conflict ? `sources disagree: ${u.conflict}` : 'not in memory/'}`);
  }
  if (done.length) filled.push(`--   ${name}: ${done.join('; ')}`);
}

const sql = `-- ============================================================================
-- Migration 878: Die Casting alloys completed from the rest of memory/
-- ============================================================================
-- Generated by scripts/gen_878_die_casting_alloy_gaps_from_casting.js -- do not
-- hand-edit, re-run the generator and diff instead.
--
-- Die Casting alloys (memory/Die Casting materials_master.csv, promoted by 855)
-- missing an input of the HPDC cost engine take it from the same alloy (by
-- Name) in the other memory/ folders, only where every one of them that states
-- it agrees. The Die Casting value wins wherever it exists. A file X_v2.csv
-- supersedes X.csv. Material Type also replaces a value every other folder
-- contradicts (the file has its identity columns shifted by one row from
-- Aluminum Bronze on). Property rows written here carry source_version
-- ${SOURCE_VERSION}; the folders behind each value are listed below.
-- Chamber Type Hot/Cold is written in the Die Casting code: 1 hot, 2 cold.
--
-- Filled:
${filled.join('\n')}
--
-- Left blank (the HPDC line names the missing input):
${open.map((o) => `--   ${o}`).join('\n')}
--
-- Idempotent: an existing non-null property value is never overwritten.
-- ============================================================================

DO $$
BEGIN
  INSERT INTO raw_material_properties (raw_material_id, property_key, value_num, value_text, unit, source_version)
  SELECT rm.id, p.property_key, p.value_num, NULL, p.unit, ${sqlStr(SOURCE_VERSION)}
  FROM (VALUES
    ${props.join(',\n    ')}
  ) AS p(name, property_key, value_num, unit)
  JOIN raw_materials rm ON rm.name = p.name AND rm.material_group = 'Die Casting'
  ON CONFLICT (raw_material_id, property_key) DO UPDATE
    SET value_num = EXCLUDED.value_num, unit = EXCLUDED.unit, source_version = EXCLUDED.source_version
    WHERE raw_material_properties.value_num IS NULL;

  UPDATE raw_materials rm
  SET density_kg_m3 = v.density_kg_m3, density = v.density_kg_m3 / 1000.0
  FROM (VALUES
    ${density.join(',\n    ')}
  ) AS v(name, density_kg_m3)
  WHERE rm.name = v.name AND rm.material_group = 'Die Casting' AND rm.density_kg_m3 IS NULL;

  UPDATE raw_materials rm
  SET material_type = v.material_type
  FROM (VALUES
    ${types.join(',\n    ')}
  ) AS v(name, material_type)
  WHERE rm.name = v.name AND rm.material_group = 'Die Casting' AND rm.material_type IS DISTINCT FROM v.material_type;
END $$;

NOTIFY pgrst, 'reload schema';

-- Verify:
--   SELECT rm.name, rm.material_type, rm.density_kg_m3, p.property_key, p.value_num
--   FROM raw_materials rm LEFT JOIN raw_material_properties p
--     ON p.raw_material_id = rm.id AND p.source_version = '${SOURCE_VERSION}'
--   WHERE rm.material_group = 'Die Casting' ORDER BY rm.name, p.property_key;
`;
if (!props.length || !density.length || !types.length) throw new Error('a VALUES list is empty; adjust the template before writing');
fs.writeFileSync(OUT, sql);
console.log(`wrote ${path.basename(OUT)}: ${props.length} properties, ${density.length} densities, ${types.length} material types`);
console.log(filled.join('\n'));
console.log('open:\n' + open.join('\n'));
