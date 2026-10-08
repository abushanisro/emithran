#!/usr/bin/env node
// Generates migration 889: the identity columns of the Die Casting alloys
// (memory/Die Casting/Raw Material/materials_master.csv, promoted by 855),
// which that file has shifted against the alloy Name in places from Aluminum
// Bronze on -- Cut Code, Material Type and Description belong to the row above
// on some rows (Aluminum, AA 1100 carries Aluminum Bronze's 33.3 / Aluminum
// Bronze / Grade C95500), Base Cost Per Unit is the row above's on others, and
// two rows (Aluminum Bronze, Aluminum AA 383.0) are blank.
//
// Rules (user decisions 2026-10-04; 878 extended):
//   Cut Code, Material Type, Description
//     1. Every other memory/ folder that lists the alloy (by Name) and states
//        the column agrees on one value: that value, replacing a blank or a
//        Die Casting value it contradicts.
//     2. They disagree: the common value -- the one the most folders give
//        (a tie decides nothing) -- fills a BLANK only. It never replaces a
//        Die Casting value: the folders split by process (the casting folders
//        give aluminium grades Cut Code 30.21 like Die Casting, the wrought /
//        sheet / forging folders 30.11), so a head count is no evidence
//        against the die-casting row.
//     3. Otherwise the Die Casting value stands.
//     A file named X_v2.csv supersedes X.csv in the same folder.
//   Base Cost Per Unit (USD): the row's own Unit Cost (USD/kg), rounded to
//     cents -- what every unshifted row of the file holds (the column restates
//     the per-kg cost in 'Cost per KG' units).
//   USA Name / Cost Units of a blank row: the pattern every other row of the
//     file follows (USA Name = Name; Cost per KG).
//
//   node migrations/scripts/gen_889_die_casting_alloy_identity.js
const fs = require('fs');
const path = require('path');
const { readCsv, sqlStr, sqlNum } = require('./lib/memory-machine-seed.js');

const MEMORY = path.join(__dirname, '../../../memory');
const DIE = path.join(MEMORY, 'Die Casting');
const OUT = path.join(__dirname, '../889_die_casting_alloy_identity.sql');

const norm = (h) => String(h).toLowerCase().replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, '');
const COLUMNS = {
  cut_code: { die: 'Cut Code', accept: ['cutcode'], num: true },
  material_type: { die: 'Material Type', accept: ['materialtype'], num: false },
  description: { die: 'Description', accept: ['description'], num: false },
};
const value = (col, v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s === '-') return null;
  if (!COLUMNS[col].num) return s;
  const n = Number(s.replace(/,/g, ''));
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

// name -> column -> Map(value -> Set(folder)); one vote per folder per value.
const seen = new Map();
const note = (name, col, v, file) => {
  if (v === null) return;
  const byCol = seen.get(name) ?? new Map(); seen.set(name, byCol);
  const byVal = byCol.get(col) ?? new Map(); byCol.set(col, byVal);
  const folder = path.relative(MEMORY, path.dirname(file)).split(path.sep)[0];
  (byVal.get(v) ?? byVal.set(v, new Set()).get(v)).add(folder);
};
for (const f of sources) {
  let t;
  try { t = readCsv(f); } catch { continue; }
  const headers = t.rows.length ? Object.keys(t.rows[0]) : [];
  if (!headers.includes('Name')) continue;
  const cols = Object.fromEntries(Object.entries(COLUMNS).map(([k, c]) => [k, headers.filter((h) => c.accept.includes(norm(h)))]));
  for (const r of t.rows) {
    if (!names.has(r['Name'])) continue;
    for (const [k, hs] of Object.entries(cols)) for (const h of hs) note(r['Name'], k, value(k, r[h]), f);
  }
}

/** The other folders' answer: unanimous, else the common (most folders) value; ties decide nothing. */
function decide(name, col) {
  const byVal = seen.get(name)?.get(col);
  if (!byVal || byVal.size === 0) return null;
  const ranked = [...byVal].map(([v, fs]) => ({ v, folders: [...fs] })).sort((a, b) => b.folders.length - a.folders.length);
  if (ranked.length === 1) return { v: ranked[0].v, how: 'unanimous', folders: ranked[0].folders };
  if (ranked[0].folders.length === ranked[1].folders.length) return { v: null, how: 'tie', detail: ranked.map((r) => `${r.v} (${r.folders.join(', ')})`).join(' vs ') };
  return { v: ranked[0].v, how: 'common', folders: ranked[0].folders, detail: ranked.map((r) => `${r.v} (${r.folders.join(', ')})`).join(' vs ') };
}

const rows = [];
const log = [];
const open = [];
for (const d of die) {
  const name = d['Name'];
  const out = { name, cut_code: null, material_type: null, description: null, base_cost: null, usa_name: null, cost_units: null };
  const done = [];
  for (const col of Object.keys(COLUMNS)) {
    const own = value(col, d[COLUMNS[col].die]);
    const x = decide(name, col);
    if (!x || x.v === null) {
      if (own === null) open.push(`${name}: ${col} ${x?.how === 'tie' ? `sources tie: ${x.detail}` : 'not in memory/'}`);
      continue;
    }
    if (own !== null && own === x.v) continue;
    if (own !== null && x.how === 'common') continue;
    out[col] = x.v;
    done.push(`${col}=${x.v}${own !== null ? ` (was ${own})` : ''} [${x.how}: ${x.how === 'common' ? x.detail : x.folders.join(', ')}]`);
  }
  const unit = value('cut_code', d['Unit Cost (USD/kg)']);
  const base = value('cut_code', d['Base Cost Per Unit (USD)']);
  if (unit !== null) {
    const cents = Math.round(unit * 100) / 100;
    if (base === null || Math.abs(base - cents) > 0.005) { out.base_cost = cents; done.push(`base_cost_per_unit_usd=${cents}${base !== null ? ` (was ${base})` : ''} [own Unit Cost]`); }
  }
  if (!String(d['USA Name'] ?? '').trim()) { out.usa_name = name; done.push(`usa_name=${name} [file pattern]`); }
  if (!String(d['Cost Units'] ?? '').trim()) { out.cost_units = 'Cost per KG'; done.push('cost_units=Cost per KG [file pattern]'); }
  if (done.length) {
    rows.push(out);
    log.push(`--   ${name}: ${done.join('; ')}`);
  }
}
// Every other row of the file follows the USA Name / Cost Units patterns the blank rows take.
const usaOk = die.filter((d) => String(d['USA Name'] ?? '').trim()).every((d) => d['USA Name'] === d['Name']);
const unitsOk = die.filter((d) => String(d['Cost Units'] ?? '').trim()).every((d) => d['Cost Units'] === 'Cost per KG');
if (!usaOk || !unitsOk) throw new Error('USA Name / Cost Units pattern does not hold across the file; revisit the rule');

const v = (x) => (x === null ? 'NULL' : typeof x === 'number' ? sqlNum(x) : sqlStr(x));
const sql = `-- ============================================================================
-- Migration 889: Die Casting alloy identity columns from the rest of memory/
-- ============================================================================
-- Generated by scripts/gen_889_die_casting_alloy_identity.js -- do not
-- hand-edit, re-run the generator and diff instead.
--
-- memory/Die Casting materials_master.csv has its identity columns shifted
-- against the alloy Name in places from Aluminum Bronze on (and two rows
-- blank), so Cut Code (grinding speed factor), Material Type (grouping, tool
-- life, latent heat) and the grade Description were wrong or missing.
-- Corrected from the same alloy in the other memory/ folders: a blank or a
-- value they all contradict takes their unanimous value; a blank they disagree
-- on takes the common one (most folders; a tie decides nothing). Base Cost
-- Per Unit = the row's own Unit Cost. Blank rows take USA Name = Name and
-- Cost Units 'Cost per KG', the pattern of every other row.
--
-- Corrected:
${log.join('\n')}
--
-- Left as is:
${open.length ? open.map((o) => `--   ${o}`).join('\n') : '--   (none)'}
--
-- Idempotent. One DO block.
-- ============================================================================

DO $$
BEGIN
  UPDATE raw_materials rm
  SET cut_code = COALESCE(v.cut_code, rm.cut_code),
      material_type = COALESCE(v.material_type, rm.material_type),
      description = COALESCE(v.description, rm.description),
      base_cost_per_unit_usd = COALESCE(v.base_cost, rm.base_cost_per_unit_usd),
      usa_name = COALESCE(v.usa_name, rm.usa_name),
      cost_units = COALESCE(v.cost_units, rm.cost_units)
  FROM (VALUES
    ${rows.map((r) => `(${sqlStr(r.name)}, ${v(r.cut_code)}::numeric, ${v(r.material_type)}::text, ${v(r.description)}::text, ${v(r.base_cost)}::numeric, ${v(r.usa_name)}::text, ${v(r.cost_units)}::text)`).join(',\n    ')}
  ) AS v(name, cut_code, material_type, description, base_cost, usa_name, cost_units)
  WHERE rm.name = v.name AND rm.material_group = 'Die Casting';
END $$;

NOTIFY pgrst, 'reload schema';

-- Verify (every Die Casting alloy has a cut code and a material type):
--   SELECT name, cut_code, material_type, description, base_cost_per_unit_usd
--   FROM raw_materials WHERE material_group = 'Die Casting' ORDER BY name;
`;
fs.writeFileSync(OUT, sql);
console.log(`wrote ${path.basename(OUT)}: ${rows.length} alloys corrected`);
console.log(log.join('\n'));
console.log('open:\n' + (open.join('\n') || '(none)'));
