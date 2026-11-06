#!/usr/bin/env node
// Source-to-engine traceability for memory/Plastic Modeling: every variable, lookup table, machine column, material column and process-setting
// column of the reference data, and whether any non-test backend code reads it. Reproducible: `node backend/scripts/plastic-reference-traceability.cjs`
// writes docs/plastic-modeling/traceability-matrix.csv and prints the totals. "READ" means the name (camelCase or snake_case) appears in the
// backend code that prices plastic parts; it does not prove the value is used correctly (see the audit, section 5).
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MEM = path.join(ROOT, 'memory', 'Plastic Modeling');
// Only the code that prices or selects machines for plastic parts: a name shared with another family (casting, machining) must not count as read.
const CODE_DIRS = [
  'backend/src/modules/bom-items/costing/plastic-molding',
  'backend/src/modules/bom-items/costing/shared/capability/machine-selection',
  'backend/src/modules/bom-items/services/rate-resolution.service.ts',
  'backend/src/modules/raw-materials',
  'backend/src/modules/mhr',
];

function walk(dir, out = []) {
  if (fs.statSync(dir).isFile()) return dir.endsWith('.ts') ? [...out, dir] : out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts') && !p.includes(`${path.sep}test${path.sep}`) && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}
const files = CODE_DIRS.flatMap((d) => walk(path.join(ROOT, d))).map((p) => ({ rel: path.relative(ROOT, p), text: fs.readFileSync(p, 'utf8') }));
const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
// Where staging renamed a source column (mhr_records / MachineCapability): the staged name counts as reading the source column.
const ALIASES = {
  numberOfOperators: ['operators'], directOverheadRateUsdPerHr: ['directOverheadRate', 'direct_overhead_rate'], indirectOverheadRateUsdPerHr: ['indirectOverheadRate', 'indirect_overhead_rate'],
  laborRateUsdPerHr: ['laborRateUsdHr', 'usd_lhr_total'], clampingForceKn: ['maxTonnage', 'clamp'], shotSizeGppsG: ['shotCapacityGrams'], shotSizeG: ['shotCapacityGrams'],
  tieBarDistanceHorMm: ['tieBarXMm'], tieBarDistanceVertMm: ['tieBarYMm'], platenLengthMm: ['platenLength', 'platen_length'], platenWidthMm: ['platenWidth', 'platen_width'], maxMoldHeightMm: ['maxMoldHeight'], minMoldHeightMm: ['minMoldHeight'],
  overheadMultiplier: ['overhead_multiplier'], workCenterLaborRateFactor: ['work_center_labor_rate_factor'], laborTimeStandard: ['labor_time_standard'], wageGradeName: ['wage_grade'],
};
const readers = (names) => {
  const hit = new Set();
  for (const f of files) if (names.some((n) => n && f.text.includes(n))) hit.add(f.rel.replace('backend/src/modules/', ''));
  return [...hit];
};

function parseCsv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.length > 1 || r[0] !== '');
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const out = [['kind', 'item', 'scope', 'detail', 'status', 'read_by']];
const add = (kind, item, scope, detail, names) => {
  const r = readers(names);
  out.push([kind, item, scope, detail.replace(/\s+/g, ' ').slice(0, 140), r.length ? 'READ' : 'NOT_READ', r.slice(0, 4).join(' ; ')]);
};

// 1. Variables. Scope from the variable's own note: which process it says it serves.
for (const v of parseCsv(path.join(MEM, 'variables', 'digital_factory_variables.csv'))) {
  const n = v.notes.toLowerCase();
  const scope = n.includes('compression') ? 'compression' : /structural foam|sfm/.test(n) ? 'structural_foam' : /reaction/.test(n) ? 'rim' : n.includes('injection') ? 'injection' : 'unspecified';
  add('variable', v.variableName, scope, v.notes, [`'${v.variableName}'`, `"${v.variableName}"`, v.variableName]);
}
// 2. Lookup tables.
const tables = [...new Set(fs.readdirSync(path.join(MEM, 'lookup')).map((f) => f.replace(/__(records|fields|columns)\.csv$/, '').replace(/\.csv$/, '')))];
for (const t of tables) {
  const rec = path.join(MEM, 'lookup', `${t}__records.csv`);
  const rows = fs.existsSync(rec) ? parseCsv(rec).length : parseCsv(path.join(MEM, 'lookup', `${t}.csv`)).length;
  add('lookup_table', t, 'n/a', `${rows} rows`, [t]);
}
// Bookkeeping columns identify a row; they carry no cost input.
const IDENTITY = new Set(['sector', 'processCategory', 'machineCount', 'primaryId', 'name', 'description', 'materialCount', 'category', 'sourceName', 'dataSource']);
// 3. Machine columns, per machine file.
for (const [file, cls] of [['injection_molding_machines.csv', 'injection'], ['compression_molding_machines.csv', 'compression'], ['reaction_injection_molding_machines.csv', 'rim'], ['structural_foam_molding_machines.csv', 'structural_foam']]) {
  const rows = parseCsv(path.join(MEM, 'machine', file));
  for (const col of Object.keys(rows[0] ?? {})) {
    const leaf = col.split('.').pop();
    if (IDENTITY.has(leaf)) { out.push(['machine_column', `${cls}: ${col}`, cls, 'identity column', 'IDENTITY', '']); continue; }
    add('machine_column', `${cls}: ${col}`, cls, `${rows.length} machines`, [leaf, snake(leaf), ...(ALIASES[leaf] ?? [])]);
  }
}
// 4. Material columns.
for (const col of Object.keys(parseCsv(path.join(MEM, 'materials_final.csv'))[0] ?? {})) {
  const leaf = col.split('.').pop();
  if (IDENTITY.has(leaf)) { out.push(['material_column', col, 'all', 'identity column', 'IDENTITY', '']); continue; }
  add('material_column', col, 'all', 'materials_final.csv', [leaf, snake(leaf)]);
}
// 5. Process settings and tool materials (digital factory).
for (const [file, kind] of [['digital_factory_settings_usa.csv', 'setting'], ['digital_factory_tool_materials_usa.csv', 'tool_material_column']]) {
  for (const col of Object.keys(parseCsv(path.join(MEM, 'process', file))[0] ?? {})) add(kind, col, 'all', file, [col, snake(col)]);
}

fs.writeFileSync(path.join(ROOT, 'docs', 'plastic-modeling', 'traceability-matrix.csv'), out.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n') + '\n');
const by = {};
for (const r of out.slice(1)) { const k = `${r[0]}|${r[2] === 'n/a' ? '' : r[2]}`; by[k] = by[k] || { READ: 0, NOT_READ: 0, IDENTITY: 0 }; by[k][r[4]]++; }
console.log(JSON.stringify(by, null, 1));
console.log('items:', out.length - 1, 'read:', out.filter((r) => r[4] === 'READ').length);
