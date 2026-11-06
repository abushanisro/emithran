#!/usr/bin/env node
// Corrects mhr_records.operators for the plastic presses from their source files (memory/Plastic Modeling/machine/*.csv), and checks the result.
//
// Why a script and not a migration: reference rows may not be written by a migration after 935 (migrations/REFERENCE_DATA.json). Migration 971 makes the
// column fractional; this prints the statements that put the source values in it, for a person with database access to run:
//
//   node backend/scripts/restage-machine-operators.cjs            > fix.sql    # UPDATEs, one transaction, idempotent
//   node backend/scripts/restage-machine-operators.cjs --check    > check.sql  # lists every press whose database value differs from the source (expect 0 rows)
//   psql "$DATABASE_URL" -f fix.sql ; psql "$DATABASE_URL" -f check.sql
//
// Only `operators` is touched; nothing is read from or written to the database by this script. Presses are matched on machine class, location (USA) and name.
const fs = require('fs');
const path = require('path');

const MEM = path.resolve(__dirname, '..', '..', 'memory', 'Plastic Modeling', 'machine');
const FILES = [
  ['injection_molding_machines.csv', 'injection_molding'],
  ['compression_molding_machines.csv', 'compression_molding'],
  ['structural_foam_molding_machines.csv', 'structural_foam_molding'],
  ['reaction_injection_molding_machines.csv', 'reaction_injection_molding'],
];

function parseCsv(text) {
  const rows = []; let row = []; let cur = ''; let q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.length > 1);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const sources = [];
for (const [file, cls] of FILES) {
  for (const r of parseCsv(fs.readFileSync(path.join(MEM, file), 'utf8'))) {
    const n = r['accounting.numberOfOperators'];
    if (n === '' || n === undefined) continue; // the source states none: the database keeps what it has
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0) throw new Error(`${file}: ${r.name}: operators "${n}" is not a number`);
    sources.push({ cls, name: r.name, operators: v });
  }
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const values = sources.map((s) => `(${lit(s.cls)}, ${lit(s.name)}, ${s.operators})`).join(',\n  ');

if (process.argv.includes('--check')) {
  console.log(`-- Presses whose mhr_records.operators differs from the source file (${sources.length} presses in the sources). Expect 0 rows.`);
  console.log(`SELECT m.machine_class, m.machine_name, m.operators AS database, s.operators AS source
FROM mhr_records m
JOIN (VALUES
  ${values}
) AS s(machine_class, machine_name, operators) ON s.machine_class = m.machine_class AND s.machine_name = m.machine_name
WHERE m.location = 'USA' AND m.operators IS DISTINCT FROM s.operators::numeric
ORDER BY 1, 2;`);
} else {
  console.log(`-- mhr_records.operators from memory/Plastic Modeling/machine (${sources.length} presses). Run after migration 971. Idempotent.`);
  console.log(`BEGIN;
UPDATE mhr_records m SET operators = s.operators
FROM (VALUES
  ${values}
) AS s(machine_class, machine_name, operators)
WHERE s.machine_class = m.machine_class AND s.machine_name = m.machine_name AND m.location = 'USA' AND m.operators IS DISTINCT FROM s.operators::numeric;
COMMIT;`);
}
