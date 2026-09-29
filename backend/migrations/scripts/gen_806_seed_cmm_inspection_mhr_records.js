#!/usr/bin/env node
// Generates migration 806: seed mhr_records with the real CMM Inspection
// machines from memory/Secondary process/machines/cmm_inspection_machines.csv.
//
// Why: migration 805 removed every mhr_records row without a memory/ source
// key. The cost engine's 'cmm' class (Sheet Metal / generic inspection lines,
// resolveCmmSpecificRate) was served only by such rows, so it was left with
// no machine in any location. This file is the real memory/ source for that
// class: 11 USA machines, with real overhead, labour and bottom-up inputs.
//
// Same column shape and conventions as gen_797 (PCB). Differences, each
// deliberate:
//   machine_class  'cmm' -- the class every inspection resolver filters on
//                  (.eq('machine_class','cmm')); classifyInspectionResource
//                  treats class 'cmm' as CMM regardless of the name, so real
//                  names like "Axiom Too 1200" resolve correctly.
//   process_group  'Other Secondary Processes' -- the group migration 790
//                  seeded "CMM Inspection" under in the process catalog.
//   process_family and press_cycle_time_s are not inserted (left NULL):
//                  CMM is not family-specific and has no press cycle. An
//                  all-NULL VALUES column is typed text and would fail to
//                  insert into a numeric column, so they are omitted.
//   wage_grade     "2 - Metal", the real per-process value from
//                  memory/Secondary process/wage_grade_associations.csv.
//   location       USA only -- the only location this file carries.
//
// Run: node backend/migrations/scripts/gen_806_seed_cmm_inspection_mhr_records.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SRC = path.join(ROOT, 'memory', 'Secondary process', 'machines', 'cmm_inspection_machines.csv');
const WAGE = path.join(ROOT, 'memory', 'Secondary process', 'wage_grade_associations.csv');
const OUT = path.join(__dirname, '..', '806_seed_cmm_inspection_mhr_records.sql');
const PROCESS_NAME = 'CMM Inspection';

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f !== '')) rows.push(row); }
  return rows;
}
const num = (v) => { if (v == null || String(v).trim() === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const sqlNum = (v) => { const n = num(v); return n == null ? 'NULL' : String(n); };
const sqlStr = (v) => (v == null || String(v).trim() === '' ? 'NULL' : `$str$${String(v).trim()}$str$`);

const table = parseCsv(fs.readFileSync(SRC, 'utf8').replace(/^﻿/, ''));
const header = table[0].map((h) => h.trim());
const col = (label) => {
  const i = header.indexOf(label);
  if (i === -1) throw new Error(`cmm_inspection_machines.csv: missing column "${label}"`);
  return i;
};

const wageRows = parseCsv(fs.readFileSync(WAGE, 'utf8').replace(/^﻿/, ''));
const wageRow = wageRows.find((r) => r[0].trim() === PROCESS_NAME);
if (!wageRow) throw new Error(`No wage grade for "${PROCESS_NAME}" in wage_grade_associations.csv`);
const processWageGrade = wageRow[1].trim();

const COLUMNS = [
  'machine_class', 'location', 'machine_name', 'currency_code', 'country_code',
  'source_type', 'process_group', 'operators', 'setup_time_hr',
  'landed_machine_cost',
  'direct_overhead_rate', 'indirect_overhead_rate',
  'benchmark_direct_overhead_rate_usd_hr', 'benchmark_indirect_overhead_rate_usd_hr',
  'total_machine_hour_rate', 'mhr_usd_per_hour',
  'usd_labor_rate_per_hr', 'benchmark_labor_rate_usd_hr', 'usd_lhr_total',
  'work_center_labor_rate_factor', 'labor_time_standard', 'wage_grade',
  'machine_price_usd', 'machine_length_mm', 'machine_width_mm',
  'footprint_allowance_factor', 'machine_power_kw', 'machine_life_yr',
  'installation_factor_pct', 'machine_uptime_pct', 'annual_maintenance_factor_pct',
  'salvage_value_factor_pct', 'supplies_cost_per_year', 'avg_utilization',
  'good_part_yield', 'manufacturer_country', 'benchmark_source_key',
];

const seen = new Set();
const rows = [];
for (const r of table.slice(1)) {
  const name = (r[col('Primary ID (Name)')] || '').trim();
  if (!name || seen.has(name)) continue;
  seen.add(name);

  const direct = num(r[col('Direct Overhead Rate (USD / hr)')]);
  const indirect = num(r[col('Indirect Overhead Rate (USD / hr)')]);
  if (direct == null || indirect == null) throw new Error(`${name}: missing overhead rate in source`);
  const mhr = Math.round((direct + indirect) * 100) / 100; // canonical MHR = Direct + Indirect (migration 581)
  const labour = r[col('Labor Rate (USD / hr)')];
  const price = num(r[col('Machine Price (USD)')]);
  const ownGrade = (r[col('Wage Grade Name')] || '').trim();

  rows.push([
    sqlStr('cmm'), sqlStr('USA'), sqlStr(name), sqlStr('USD'), sqlStr('US'),
    sqlStr('BENCHMARK'), sqlStr('Other Secondary Processes'),
    sqlNum(r[col('Number of Operators')]), sqlNum(r[col('Setup Time (hr)')]),
    sqlNum(price != null && price > 0 ? price : null),
    sqlNum(direct), sqlNum(indirect), sqlNum(direct), sqlNum(indirect),
    sqlNum(mhr), sqlNum(mhr),
    sqlNum(labour), sqlNum(labour), sqlNum(labour),
    sqlNum(r[col('Work Center Labor Rate Factor')]), sqlNum(r[col('Labor Time Standard')]),
    sqlStr(ownGrade || processWageGrade),
    sqlNum(price), sqlNum(r[col('Machine Length (mm)')]), sqlNum(r[col('Machine Width (mm)')]),
    sqlNum(r[col('Footprint Allowance Factor')]), sqlNum(r[col('Machine Power (kW)')]), sqlNum(r[col('Machine Life (yr)')]),
    sqlNum(r[col('Installation Factor (%)')]), sqlNum(r[col('Machine Uptime (%)')]),
    sqlNum(r[col('Annual Maintenance Factor (%)')]), sqlNum(r[col('Salvage Value Factor (%)')]),
    sqlNum(r[col('Supplies Cost (USD / yr)')]), sqlNum(r[col('Avg Utilization')]), sqlNum(r[col('Good Part Yield')]),
    sqlStr(r[col('Machine Manufacturer Location')]),
    sqlStr(`${PROCESS_NAME}:${name}`),
  ]);
}

const sql = `-- ============================================================================
-- Migration 806: Seed mhr_records with the real CMM Inspection machines
-- ============================================================================
-- Generated by scripts/gen_806_seed_cmm_inspection_mhr_records.js -- do not
-- hand-edit, re-run the generator and diff instead.
--
-- Source: memory/Secondary process/machines/cmm_inspection_machines.csv
-- (${rows.length} real USA machines). Restores the cost engine cmm class, which
-- migration 805 left with no machine in any location because every row that
-- served it had no memory/ source key.
--
-- MHR = Direct OH + Indirect OH (migration 581). LHR = the source labour rate.
-- wage_grade = ${processWageGrade} (memory/Secondary process/wage_grade_associations.csv).
-- process_group = Other Secondary Processes (the group migration 790 seeded
-- CMM Inspection under). process_family left NULL: not family-specific.
--
-- USA only: the source file carries no other location. Other locations stay
-- without a CMM rate until real memory/ data exists for them.
--
-- Idempotent: skips any (machine_class, location, machine_name) already present.
-- ============================================================================

INSERT INTO mhr_records (
  ${COLUMNS.join(', ')}
)
SELECT v.* FROM (VALUES
${rows.map((r) => `  (${r.join(', ')})`).join(',\n')}
) AS v(${COLUMNS.join(', ')})
WHERE NOT EXISTS (
  SELECT 1 FROM mhr_records m
  WHERE m.machine_class = v.machine_class
    AND m.location = v.location
    AND lower(trim(m.machine_name)) = lower(trim(v.machine_name))
);

-- Verify (expect ${rows.length} rows, mhr = direct + indirect on every one):
-- SELECT machine_name, direct_overhead_rate, indirect_overhead_rate,
--        total_machine_hour_rate, usd_lhr_total, benchmark_source_key
-- FROM mhr_records WHERE machine_class = 'cmm' AND location = 'USA'
-- ORDER BY machine_name;
`;

fs.writeFileSync(OUT, sql);
console.log(`Wrote ${path.relative(ROOT, OUT)} (${rows.length} machines, wage grade ${processWageGrade})`);
