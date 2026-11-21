#!/usr/bin/env node
/**
 * Writes migration 1109 (the Sheet Metal - Hydroforming machines: the hydroform presses' rates and forming time, the offline blanking presses'
 * stroke and handling data, and the India twins of all 56) from memory/Sheetmetal Hydroforming and memory/Countries data:
 *   node scripts/generate-hydroforming-machines-migration.js
 * Re-run and diff instead of editing the migration.
 */
const { readdirSync, writeFileSync } = require('fs');
const { join } = require('path');
const { readCsv, sqlStr, sqlNum, sqlJsonb, twinMachinesSql } = require('../migrations/scripts/lib/memory-machine-seed.js');

const MEMORY = join(__dirname, '../../memory');
const DIR = 'Sheetmetal Hydroforming';
const COUNTRIES = 'Countries data';
const OUT = join(__dirname, '../migrations/1109_hydroforming_machines.sql');
const GROUP = 'Sheet Metal - Hydroforming';
const CLASS = { Hydroform: 'hydroform', 'Offline Blank': 'hydroform_offline_blank' };
const USA_FILE = { Hydroform: 'machines_hydroform.csv', 'Offline Blank': 'machines_offline_blank.csv' };
// The USA press rate: no export lists the USA, so the overheads are the Netherlands export's (the user's decision, 2026-11-21: of the 14 exports
// it is the closest to the USA file on the 18 blanking presses both list, as migration 1070 took Netherlands rates for the USA).
const USA_PROXY = 'Netherlands_XML_Data_.csv';
const INDIA = 'India_XML_Data_.csv';
// The labour of each wage grade (USD/hr): the rate the rows of that grade carry in HR Rates (USA 36.30 on 522 rows, as the blanking presses'
// own file; India 1.73 on 238 rows, as migrations 1049, 1063 and 1089 took it).
const GRADE_RATE = { '3 - Metal': { USA: 36.30, India: 1.73 } };
// Offline blank stroke and handling data the exports carry per press (identical in every export); the specs key each is stored under.
const BLANK_SPECS = {
  pressCycleTime: 'press_cycle_time_s', massCoeffHandlingTime: 'mass_coeff_handling_time_s_per_kg', constCoeffHandlingTime: 'const_coeff_handling_time_s',
  maxPartLength: 'max_part_length_mm', maxPartWidth: 'max_part_width_mm', pitchMargin: 'pitch_margin_mm', sideMargin: 'side_margin_mm',
  trimStrip: 'trim_strip_mm', shutHeight: 'shut_height_mm',
};

/** A number as an export writes it: plain, or "$ 56.26" (Canada, China, Mexico, Singapore). */
const num = (v) => {
  if (v == null) return null;
  const s = String(v).replace(/[$\s,]/g, '');
  return s === '' || !Number.isFinite(Number(s)) ? null : Number(s);
};
const cents = (v, what) => {
  const n = num(v);
  if (n == null || n < 0) throw new Error(`not a rate: ${what} = ${v}`);
  return Math.round(n * 100) / 100;
};

// The USA machines (names) and the wage grade of each process.
const grades = Object.fromEntries(readCsv(join(MEMORY, DIR, 'hydroforming_wage_grade_associations.csv')).rows.map((r) => [r['Process Name'], r['Wage Grade Name']]));
const usa = {};
for (const [process, file] of Object.entries(USA_FILE)) {
  if (!GRADE_RATE[grades[process]]) throw new Error(`${process}: wage grade ${grades[process]} has no rate here`);
  usa[process] = readCsv(join(MEMORY, DIR, 'Machine', file)).rows.map((r) => r['Name']);
}
const usaBlank = new Map(readCsv(join(MEMORY, DIR, 'Machine', USA_FILE['Offline Blank'])).rows.map((r) => [r['Name'], r]));

// Every export's Sheet Metal - Hydroforming rows, by machine name; the columns are matched by their trimmed header (Singapore pads them).
function exportRows(file) {
  const t = readCsv(join(MEMORY, COUNTRIES, file));
  const col = (name) => t.columns.find((c) => c.trim() === name);
  const rows = t.rows.filter((r) => String(r[col('Commodity')]).trim() === GROUP);
  return new Map(rows.map((r) => [String(r[col('name')]).trim(), { process: String(r[col('Machine Type')]).trim(), get: (name) => r[col(name)] }]));
}
const exportsByFile = Object.fromEntries(readdirSync(join(MEMORY, COUNTRIES)).filter((f) => f.endsWith('.csv')).sort().map((f) => [f, exportRows(f)]));
for (const [file, rows] of Object.entries(exportsByFile)) {
  for (const [process, names] of Object.entries(usa)) {
    const listed = [...rows].filter(([, r]) => r.process === process).map(([n]) => n).sort();
    if (JSON.stringify(listed) !== JSON.stringify([...names].sort())) throw new Error(`${file}: its ${process} machines are not the USA file's`);
  }
}
// The press timing is the press's own: the same in every export (checked), so it is taken from the Netherlands export.
const proxy = exportsByFile[USA_PROXY];
for (const [file, rows] of Object.entries(exportsByFile)) {
  for (const [name, r] of rows) {
    for (const k of r.process === 'Hydroform' ? ['machineFormingCycleTime'] : Object.keys(BLANK_SPECS)) {
      if (num(r.get(k)) !== num(proxy.get(name).get(k))) throw new Error(`${file} ${name}: ${k} ${r.get(k)} differs from ${USA_PROXY}'s ${proxy.get(name).get(k)}`);
    }
  }
}

// USA hydroform presses: the Netherlands overheads, the USA labour, the forming cycle time.
const presses = usa.Hydroform.map((name) => {
  const r = proxy.get(name);
  const fct = num(r.get('machineFormingCycleTime'));
  if (!(fct > 0)) throw new Error(`${name}: no forming cycle time`);
  return { name, direct: cents(r.get('customWorkCenterDirectOverheadRate'), name), indirect: cents(r.get('customWorkCenterIndirectOverheadRate'), name), fct };
});
// Offline blanking presses: their stroke and handling data (their USA rates are in their own file, migration 828).
const blanks = usa['Offline Blank'].map((name) => {
  const r = proxy.get(name);
  const specs = {};
  for (const [k, key] of Object.entries(BLANK_SPECS)) {
    const v = num(r.get(k));
    if (v == null) throw new Error(`${name}: no ${k}`);
    specs[key] = v;
  }
  if (!(specs.press_cycle_time_s > 0)) throw new Error(`${name}: no press cycle time`);
  return { name, specs };
});
// The evidence for the proxy: on the blanking presses, which both the USA file and the Netherlands export rate, the largest difference.
const proxyGap = usa['Offline Blank'].reduce((worst, name) => {
  const u = usaBlank.get(name);
  const r = proxy.get(name);
  const d = Math.max(Math.abs(num(u['Direct Overhead Rate (USD / hr)']) - num(r.get('customWorkCenterDirectOverheadRate'))),
    Math.abs(num(u['Indirect Overhead Rate (USD / hr)']) - num(r.get('customWorkCenterIndirectOverheadRate'))));
  return d > worst.d ? { d, name } : worst;
}, { d: 0, name: '' });

// India twins of all 56: the India export's overheads, the India labour of the grade.
const india = exportsByFile[INDIA];
const twins = Object.entries(usa).flatMap(([process, names]) => names.map((name) => {
  const r = india.get(name);
  return {
    location: 'India', countryCode: 'IN', machineClass: CLASS[process], machineName: name, labour: GRADE_RATE[grades[process]].India,
    direct: cents(r.get('customWorkCenterDirectOverheadRate'), `India ${name}`), indirect: cents(r.get('customWorkCenterIndirectOverheadRate'), `India ${name}`),
    sourceKey: `${process}:${name}:India`,
  };
})).sort((a, b) => (a.machineClass + a.machineName).localeCompare(b.machineClass + b.machineName));

const USA_LABOUR = GRADE_RATE[grades.Hydroform].USA;
const usaBasis = `overheads memory/${COUNTRIES}/${USA_PROXY} (no export lists the USA); labour ${grades.Hydroform} USA ${USA_LABOUR.toFixed(2)}`;
const indiaBasis = (process) => `overheads memory/${COUNTRIES}/${INDIA}; labour ${grades[process]} India ${GRADE_RATE[grades[process]].India.toFixed(2)}`;
const r2 = (n) => Math.round(n * 100) / 100;

const sql = `-- ============================================================================
-- Migration 1109: the Sheet Metal - Hydroforming machines -- press rates and forming time, blanking press data, and India
-- ============================================================================
-- Generated by scripts/generate-hydroforming-machines-migration.js; re-run it and diff instead of editing.
--
-- Migration 828 loaded the ${presses.length} hydroform presses (memory/${DIR}/Machine/${USA_FILE.Hydroform}) with no rate and no labour (the USA
-- file has neither) and no forming time, so a hydroformed part could not be priced; and no machine of the group for India.
--
-- 1. The ${presses.length} USA hydroform presses: direct and indirect overhead (USD/hr, to cents) from memory/${COUNTRIES}/${USA_PROXY}, the closest
--    export to the USA file (no export lists the USA; on the ${blanks.length} blanking presses both rate, the largest difference is
--    ${r2(proxyGap.d)} USD/hr, ${proxyGap.name}), labour ${grades.Hydroform} ${USA_LABOUR.toFixed(2)} USD/hr (the rate that grade's HR Rates rows carry), and specs
--    machine_forming_cycle_time_s, the press's forming cycle (the exports' machineFormingCycleTime, s; the same in all ${Object.keys(exportsByFile).length} exports).
--    Rates are written only where the press has none, so a rate entered in HR Rates is kept.
-- 2. The ${blanks.length} USA offline blanking presses: specs ${Object.values(BLANK_SPECS).join(', ')} (the exports' stroke and handling data,
--    the same in every export).
-- 3. India: the twins of all ${twins.length} (memory/${COUNTRIES}/${INDIA}, commodity "${GROUP}"): each machine's own overheads and labour
--    ${grades.Hydroform} India ${GRADE_RATE[grades.Hydroform].India.toFixed(2)} USD/hr; specs as the USA twin's, with the India rate basis.
--
-- Idempotent. Verify:
--   SELECT location, machine_class, count(*), count(*) FILTER (WHERE mhr_usd_per_hour > 0) FROM mhr_records
--   WHERE process_group = '${GROUP}' GROUP BY 1, 2 ORDER BY 1, 2;
-- ============================================================================

UPDATE mhr_records m SET
  specs = COALESCE(m.specs, '{}'::jsonb) || jsonb_build_object('machine_forming_cycle_time_s', v.fct, 'rate_basis', ${sqlStr(usaBasis)}),
  updated_at = now()
FROM (VALUES
${presses.map((p) => `  (${sqlStr(p.name)}, ${sqlNum(p.fct)}::numeric)`).join(',\n')}
) AS v(machine_name, fct)
WHERE m.process_group = ${sqlStr(GROUP)} AND m.location = 'USA' AND m.machine_class = ${sqlStr(CLASS.Hydroform)} AND m.machine_name = v.machine_name;

UPDATE mhr_records m SET
  direct_overhead_rate = v.direct, indirect_overhead_rate = v.indirect,
  benchmark_direct_overhead_rate_usd_hr = v.direct, benchmark_indirect_overhead_rate_usd_hr = v.indirect,
  total_machine_hour_rate = v.direct + v.indirect, mhr_usd_per_hour = v.direct + v.indirect,
  usd_labor_rate_per_hr = ${sqlNum(USA_LABOUR)}, usd_lhr_total = ${sqlNum(USA_LABOUR)}, benchmark_labor_rate_usd_hr = ${sqlNum(USA_LABOUR)},
  updated_at = now()
FROM (VALUES
${presses.map((p) => `  (${sqlStr(p.name)}, ${sqlNum(p.direct)}::numeric, ${sqlNum(p.indirect)}::numeric)`).join(',\n')}
) AS v(machine_name, direct, indirect)
WHERE m.process_group = ${sqlStr(GROUP)} AND m.location = 'USA' AND m.machine_class = ${sqlStr(CLASS.Hydroform)} AND m.machine_name = v.machine_name
  AND m.mhr_usd_per_hour IS NULL;

UPDATE mhr_records m SET specs = COALESCE(m.specs, '{}'::jsonb) || v.specs, updated_at = now()
FROM (VALUES
${blanks.map((b) => `  (${sqlStr(b.name)}, ${sqlJsonb(b.specs)})`).join(',\n')}
) AS v(machine_name, specs)
WHERE m.process_group = ${sqlStr(GROUP)} AND m.location = 'USA' AND m.machine_class = ${sqlStr(CLASS['Offline Blank'])} AND m.machine_name = v.machine_name;

${twinMachinesSql({ tag: 'hydroforming_machines', processGroup: GROUP, twins })}

UPDATE mhr_records SET specs = specs || jsonb_build_object('rate_basis', CASE machine_class
    WHEN ${sqlStr(CLASS.Hydroform)} THEN ${sqlStr(indiaBasis('Hydroform'))}
    ELSE ${sqlStr(indiaBasis('Offline Blank'))} END), updated_at = now()
WHERE process_group = ${sqlStr(GROUP)} AND location = 'India' AND specs IS NOT NULL
  AND specs ->> 'rate_basis' IS DISTINCT FROM CASE machine_class WHEN ${sqlStr(CLASS.Hydroform)} THEN ${sqlStr(indiaBasis('Hydroform'))} ELSE ${sqlStr(indiaBasis('Offline Blank'))} END;

DO $hydroforming_check$
DECLARE bad text[]; n integer;
BEGIN
  SELECT array_agg(location || ': ' || machine_name ORDER BY location, machine_name) INTO bad FROM mhr_records
   WHERE process_group = ${sqlStr(GROUP)} AND machine_class = ${sqlStr(CLASS.Hydroform)} AND location IN ('USA', 'India')
     AND NOT (COALESCE(mhr_usd_per_hour, 0) > 0 AND COALESCE(usd_labor_rate_per_hr, 0) > 0 AND COALESCE((specs ->> 'machine_forming_cycle_time_s')::numeric, 0) > 0);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Hydroform presses without a rate, labour or forming time: %', bad; END IF;
  SELECT array_agg(location || ': ' || machine_name ORDER BY location, machine_name) INTO bad FROM mhr_records
   WHERE process_group = ${sqlStr(GROUP)} AND machine_class = ${sqlStr(CLASS['Offline Blank'])} AND location IN ('USA', 'India')
     AND NOT COALESCE((specs ->> 'press_cycle_time_s')::numeric, 0) > 0;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Offline blanking presses without a press cycle time: %', bad; END IF;
  SELECT count(*) INTO n FROM mhr_records WHERE process_group = ${sqlStr(GROUP)} AND location = 'India' AND machine_class IN (${Object.values(CLASS).map(sqlStr).join(', ')});
  IF n <> ${twins.length} THEN RAISE EXCEPTION 'expected ${twins.length} India ${GROUP} machines, found %', n; END IF;
END $hydroforming_check$;

NOTIFY pgrst, 'reload schema';
`;
writeFileSync(OUT, sql);
console.log(`wrote ${OUT} (${presses.length} hydroform presses, ${blanks.length} blanking presses, ${twins.length} India twins; proxy gap ${r2(proxyGap.d)} on ${proxyGap.name})`);
