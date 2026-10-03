#!/usr/bin/env node
// Generates migration 845: every Die Casting machine in HR Rates (mhr_records)
// and the Die Casting catalog rows of migration 844 pointed at their class.
//
//   1. USA machines: memory/Die Casting/Machine/*.csv (reference export), the
//      row shape of 806/818/820/824/826/828 (scripts/lib/memory-machine-seed.js):
//      MHR = Direct OH + Indirect OH, every process-specific column in specs.
//      Each file is one HR Rates category and serves the process of the same
//      name in processDefaults.csv; wage grade from wage_grade_associations.csv.
//   2. India machines: memory/Die Casting/Indian data/
//      aPriori_India_Casting_Machine_Rates_FULL.csv (rates only, USD/hr). An
//      India machine is its USA twin at India rates (migration 594 / 829 rule):
//      every column cloned, location/country/rates/benchmark_source_key
//      overridden. The twin is found by exact name in the file's own category,
//      else (screenshot transcription errors) by the one unclaimed USA name of
//      that category within edit distance 2. Rows of another domain's machines
//      (the Investment Casting wax injection / autoclave / Magnus rows, which
//      the Casting Investment India file also carries) are not Die Casting
//      machines and are not inserted here; migration 846 stages the whole file.
//   3. process_taxonomy / process_calculator_mappings (844): machine_class.
//
// Run: node backend/migrations/scripts/gen_845_seed_die_casting_mhr_records.js

const fs = require('fs');
const path = require('path');
const { readCsv, parseCsv, sqlStr, buildMachineRows, insertSql } = require('./lib/memory-machine-seed');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SRC = path.join(ROOT, 'memory', 'Die Casting');
const OUT = path.join(__dirname, '..', '845_seed_die_casting_mhr_records.sql');
const GROUP = 'Die Casting';

// file -> HR Rates category (= its process name) + envelope [x, y, z, weight].
const FILES = [
  ['cleaning_machines_shot_blast.csv', 'Cleaning', ['Max Width (mm)', null, 'Max Height (mm)', 'Weight Capacity (kg)']],
  ['core_making_machines.csv', 'Coremaking', ['Max Corebox Length (mm)', 'Max Corebox Width (mm)', 'Max Corebox Height (mm)', null]],
  ['core_refractory_coat.csv', 'Core Refractory Coat', [null, null, null, null]],
  ['finishing_machines.csv', 'Finishing', [null, null, null, 'Max Weight (kg)']],
  ['gravity_die_casting_machines.csv', 'Gravity Die Casting', ['Tie Bar Distance Hor (mm)', 'Tie Bar Distance Vert (mm)', 'Max Mold Height (mm)', null]],
  ['high_pressure_die_casting_machines.csv', 'High Pressure Die Casting', ['Tie Bar Distance Hor (mm)', 'Tie Bar Distance Vert (mm)', 'Max Mold Height (mm)', null]],
  ['melting_furnaces.csv', 'Melting', [null, null, null, null], { ratesAbsentInSource: true }],
  ['refractory_coat_air_dry.csv', 'Refractory Coat Air Dry', ['Bed Length (mm)', 'Bed Width (mm)', 'Bed Height (mm)', null]],
  ['refractory_coat_oven_dry.csv', 'Refractory Coat Oven Dry', ['Bed Length (mm)', 'Bed Width (mm)', 'Bed Height (mm)', null]],
  ['trim_presses.csv', 'Trim', [null, null, null, null]],
  ['visual_inspection.csv', 'Visual Inspection', [null, null, null, null]],
];
// India file category -> USA category.
const INDIA_CATEGORY = {
  'High Pressure Die Casting': 'High Pressure Die Casting',
  'Gravity / Tilt-Pour / Low-Pressure Die Casting': 'Gravity Die Casting',
};
const INDIA_FILE = 'aPriori_India_Casting_Machine_Rates_FULL.csv';

const classOf = (category) => 'die_casting_' + category.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const processes = readCsv(path.join(SRC, 'Processes', 'processDefaults.csv')).rows.map((r) => String(r['Process Name']));
const wage = readCsv(path.join(SRC, 'wage_grade_associations.csv')).rows;
const onDisk = fs.readdirSync(path.join(SRC, 'Machine')).filter((f) => f.endsWith('.csv')).sort();
const unmapped = onDisk.filter((f) => !FILES.some(([x]) => x === f));
if (unmapped.length) throw new Error(`unmapped machine files: ${unmapped.join(', ')}`);

const specs = FILES.map(([file, category, envelope, opts]) => {
  if (!processes.includes(category)) throw new Error(`${file}: category ${category} is not a process in processDefaults.csv`);
  const grade = wage.find((w) => w['Process Name'] === category)?.['Wage Grade Name'] ?? null;
  return { file: path.join(SRC, 'Machine', file), rel: `Die Casting/Machine/${file}`, category, machineClass: classOf(category), grade, envelope, ...(opts || {}) };
});

const { columns, rows, report } = buildMachineRows(specs, GROUP);

// ── India ───────────────────────────────────────────────────────────────────
function lev(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}
const usaByCategory = Object.fromEntries(specs.map((s) => [s.category, readCsv(s.file).rows.map((r) => String(r['Name']))]));
const indiaRaw = parseCsv(fs.readFileSync(path.join(SRC, 'Indian data', INDIA_FILE), 'utf8').replace(/^﻿/, ''));
const indiaHeader = indiaRaw[0].map((h) => h.trim());
const ix = (h) => { const i = indiaHeader.indexOf(h); if (i < 0) throw new Error(`${INDIA_FILE}: no ${h}`); return i; };
const [iG, iN, iL, iD, iI] = ['Machine Group', 'Machine Name', 'Labor Rate (USD/hr)', 'Direct Overhead Rate (USD/hr)', 'Indirect Overhead Rate (USD/hr)'].map(ix);
const india = indiaRaw.slice(1).map((r) => ({ group: r[iG].trim(), name: r[iN].trim(), labor: Number(r[iL]), direct: Number(r[iD]), indirect: Number(r[iI]) }));

const otherDomain = india.filter((r) => !(r.group in INDIA_CATEGORY));
const indiaRows = [];
const aliases = [];
const claimed = new Set();
const pending = [];
for (const r of india.filter((x) => x.group in INDIA_CATEGORY)) {
  for (const v of [r.labor, r.direct, r.indirect]) if (!Number.isFinite(v)) throw new Error(`India ${r.name}: non-numeric rate`);
  const cat = INDIA_CATEGORY[r.group];
  if (usaByCategory[cat].includes(r.name)) {
    if (claimed.has(`${cat}|${r.name}`)) throw new Error(`India ${r.name}: named twice`);
    claimed.add(`${cat}|${r.name}`);
    indiaRows.push({ ...r, cat, usa: r.name });
  } else pending.push({ ...r, cat });
}
for (const r of pending) {
  const cands = usaByCategory[r.cat].filter((n) => !claimed.has(`${r.cat}|${n}`) && lev(n.toLowerCase(), r.name.toLowerCase()) <= 2);
  if (cands.length !== 1) throw new Error(`India ${r.name} (${r.cat}): ${cands.length} USA candidates within edit distance 2`);
  claimed.add(`${r.cat}|${cands[0]}`);
  aliases.push(`${r.name} -> ${cands[0]}`);
  indiaRows.push({ ...r, usa: cands[0] });
}
const num = (v) => String(Math.round(v * 1e6) / 1e6);
const indiaValues = indiaRows.map((r) => `      (${sqlStr(classOf(r.cat))}, ${sqlStr(r.usa)}, ${num(r.labor)}, ${num(r.direct)}, ${num(r.indirect)})`).join(',\n');
const indiaCounts = Object.values(INDIA_CATEGORY).map((c) => `${c} ${indiaRows.filter((r) => r.cat === c).length}/${usaByCategory[c].length}`).join(', ');
const otherGroups = [...new Set(otherDomain.map((r) => r.group))].map((g) => `${g} (${otherDomain.filter((r) => r.group === g).length})`).join('; ');

const catVals = specs.map((s) => `  (${sqlStr(s.category)}, ${sqlStr(s.machineClass)})`).join(',\n');

const header = `-- ============================================================================
-- Migration 845: Die Casting machines in HR Rates (USA + India)
-- ============================================================================
-- Generated by scripts/gen_845_seed_die_casting_mhr_records.js -- do not
-- hand-edit, re-run the generator and diff instead.
--
-- 1. USA: memory/Die Casting/Machine/*.csv (reference export). ${rows.length} machines:
${report.map((r) => `--   ${r.category.padEnd(26)} ${r.machineClass.padEnd(38)} ${String(r.n).padStart(2)} machine(s)  wage ${r.grade ?? '-'}${r.ratesAbsentInSource ? '  (source has no overhead rates: MHR NULL)' : ''}`).join('\n')}
--    Row shape of 806/818/820/824 (scripts/lib/memory-machine-seed.js):
--    MHR = Direct OH + Indirect OH, LHR = labour rate, every other source
--    column in specs; HR Rates category = benchmark_source_key prefix.
--
-- 2. India: memory/Die Casting/Indian data/${INDIA_FILE}
--    ${indiaRows.length} machines (${indiaCounts}), each its USA twin at India rates
--    (every column cloned; location India, country IN, rates USD, as 594/829).
--    Transcription errors resolved to the one unclaimed USA name within edit
--    distance 2 of the same category:
${aliases.map((a) => `--      ${a}`).join('\n') || '--      none'}
--    Not inserted (other domain's machines; staged raw by migration 846):
--      ${otherGroups || 'none'}
--
-- 3. Die Casting catalog rows (844): machine_class where still NULL.
--
-- Run after 844. Split in two parts so each fits the SQL editor: run part 1
-- (USA machines) before part 2 (India twins + catalog). Statements are
-- idempotent (existing rows never overwritten).
-- ============================================================================
`;
const part1 = `${header}
-- ── Part 1 of 2 ── 1. USA machines.
${insertSql(columns, rows)}

NOTIFY pgrst, 'reload schema';
`;
const sql = `${header}
-- ── Part 2 of 2 (run part 1 first).
-- ── 2. India machines: the USA twin at India rates.
DO $india845$
DECLARE
  cols text; sel text; r record; usa_id uuid;
  n integer := 0; missing text[] := '{}';
BEGIN
  SELECT
    string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position),
    string_agg(
      CASE c.column_name
        WHEN 'location'                                THEN '''India'''
        WHEN 'country_code'                            THEN '''IN'''
        WHEN 'direct_overhead_rate'                    THEN '$2'
        WHEN 'indirect_overhead_rate'                  THEN '$3'
        WHEN 'benchmark_direct_overhead_rate_usd_hr'   THEN '$2'
        WHEN 'benchmark_indirect_overhead_rate_usd_hr' THEN '$3'
        WHEN 'total_machine_hour_rate'                 THEN 'ROUND(($2 + $3)::numeric, 2)'
        WHEN 'mhr_usd_per_hour'                        THEN 'ROUND(($2 + $3)::numeric, 2)'
        WHEN 'manual_mhr_value'                        THEN 'ROUND(($2 + $3)::numeric, 2)'
        WHEN 'fully_burdened_local_per_hr'             THEN 'ROUND(($2 + $3)::numeric, 2)'
        WHEN 'usd_labor_rate_per_hr'                   THEN '$4'
        WHEN 'benchmark_labor_rate_usd_hr'             THEN '$4'
        WHEN 'usd_lhr_total'                           THEN '$4'
        WHEN 'benchmark_source_key'                    THEN 'usa.benchmark_source_key || '':India'''
        ELSE 'usa.' || quote_ident(c.column_name)
      END, ', ' ORDER BY c.ordinal_position)
  INTO cols, sel
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'mhr_records'
    AND c.column_name NOT IN ('id', 'created_at', 'updated_at')
    AND c.is_generated = 'NEVER' AND c.identity_generation IS NULL;

  FOR r IN SELECT * FROM (VALUES
${indiaValues}
  ) v(machine_class, name, labor, direct, indirect)
  LOOP
    SELECT usa.id INTO usa_id FROM mhr_records usa
    WHERE usa.location = 'USA' AND usa.machine_class = r.machine_class
      AND lower(trim(usa.machine_name)) = lower(trim(r.name))
    LIMIT 1;
    IF usa_id IS NULL THEN
      missing := missing || r.name;
    ELSIF NOT EXISTS (SELECT 1 FROM mhr_records m WHERE m.location = 'India'
                      AND m.machine_class = r.machine_class AND lower(trim(m.machine_name)) = lower(trim(r.name))) THEN
      EXECUTE format('INSERT INTO mhr_records (%s) SELECT %s FROM mhr_records usa WHERE usa.id = $1', cols, sel)
        USING usa_id, r.direct, r.indirect, r.labor;
      n := n + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'Die Casting India rows inserted: %', n;
  IF cardinality(missing) > 0 THEN
    RAISE NOTICE 'No USA twin (run section 1 first): %', array_to_string(missing, '; ');
  END IF;
END
$india845$;

-- ── 3. Die Casting catalog rows (migration 844): machine_class, where still NULL.
UPDATE process_taxonomy pt
SET machine_class = v.machine_class
FROM (VALUES
${catVals}
) AS v(process_name, machine_class)
WHERE pt.process_group = '${GROUP}' AND pt.process_name = v.process_name AND pt.machine_class IS NULL;

UPDATE process_calculator_mappings pcm
SET machine_class = v.machine_class, updated_at = now()
FROM (VALUES
${catVals}
) AS v(operation, machine_class)
WHERE pcm.process_group = '${GROUP}' AND pcm.operation = v.operation AND pcm.machine_class IS NULL;

NOTIFY pgrst, 'reload schema';

-- Verify (expect USA ${rows.length}, India ${indiaRows.length}):
-- SELECT location, split_part(benchmark_source_key, ':', 1) AS category, count(*)
--   FROM mhr_records WHERE process_group = '${GROUP}' GROUP BY 1, 2 ORDER BY 1, 2;
`;
for (const old of fs.readdirSync(path.dirname(OUT)).filter((n) => /^845_seed_die_casting_mhr_records.*\.sql$/.test(n))) fs.unlinkSync(path.join(path.dirname(OUT), old));
fs.writeFileSync(OUT.replace(/\.sql$/, '_part1of2.sql'), part1, 'utf8');
fs.writeFileSync(OUT.replace(/\.sql$/, '_part2of2.sql'), sql, 'utf8');
console.log(`Wrote ${path.relative(ROOT, OUT).replace(/\.sql$/, '_part{1,2}of2.sql')}:${rows.length} USA machines, ${indiaRows.length} India machines`);
for (const r of report) console.log(`  ${r.machineClass}: ${r.n} | grade ${r.grade}`);
console.log('aliases:', aliases);
console.log('other-domain India rows not inserted:', otherGroups);
