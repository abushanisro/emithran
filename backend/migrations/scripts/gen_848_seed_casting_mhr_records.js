#!/usr/bin/env node
// Generates migration 848: every Casting machine in HR Rates (mhr_records) and
// the Casting catalog rows of migration 847 pointed at their class.
//
//   1. USA machines: memory/Casting/Machine/*.csv (reference export), row shape
//      of 806/818/820/824/845 (scripts/lib/memory-machine-seed.js). Each file is
//      one HR Rates category = the process of processes.csv it serves;
//      xray_machine.csv serves no listed process and is its own category.
//   2. India machines: memory/Casting/Indian data/sand_casting_machine_rates_full.csv,
//      a transcription of the India rate screenshots (rates only, USD/hr). Each
//      screenshot (source_image) is one process's machine list, in processes.csv
//      order (IMAGE_PROCESS below); the generator verifies that against the data
//      (most of a screenshot's machine names must be names in that process's
//      machine file, or it stops). An India machine is its USA twin at India
//      rates (594/829/845 rule): every column cloned; location, country, rates
//      and benchmark_source_key overridden; the screenshot id and transcription
//      review note added to specs. Twin by exact name, else the one unclaimed
//      USA name of that file within edit distance 2. A machine with no twin is
//      seeded from its own India row (rates only; nothing invented).
//   3. process_taxonomy / process_calculator_mappings (847): machine_class.
//
// Run: node backend/migrations/scripts/gen_848_seed_casting_mhr_records.js

const fs = require('fs');
const path = require('path');
const { readCsv, parseCsv, sqlStr, sqlJsonb, buildMachineRows, insertSql } = require('./lib/memory-machine-seed');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SRC = path.join(ROOT, 'memory', 'Casting');
const OUT = path.join(__dirname, '..', '848_seed_casting_mhr_records.sql');
const GROUP = 'Casting';
const INDIA_FILE = 'sand_casting_machine_rates_full.csv';

// file -> HR Rates category (its process) + envelope [x, y, z, weight].
const COREBOX = ['Max Corebox Length (mm)', 'Max Corebox Width (mm)', 'Max Corebox Height (mm)', null];
const FLASK = ['Flask Length (mm)', 'Flask Width (mm)', 'Flask Height (mm)', null];
const DIE = ['Tie Bar Distance Hor (mm)', 'Tie Bar Distance Vert (mm)', 'Max Mold Height (mm)', null];
const BLAST = ['Max Width (mm)', null, 'Max Height (mm)', 'Weight Capacity (kg)'];
const NONE = [null, null, null, null];
const FILES = [
  ['cleaning_machines.csv', 'Cleaning', BLAST],
  ['co2cured_machines.csv', 'CO2 Cured', COREBOX],
  ['cooling_machines.csv', 'Cool', NONE],
  ['diecasting_machines.csv', 'Die Casting', DIE],
  ['finishing_machines.csv', 'Finishing', [null, null, null, 'Max Weight (kg)']],
  ['horizontal_automatic_machines.csv', 'Horizontal Automatic', FLASK],
  ['hotbox_machines.csv', 'Hot Box', COREBOX],
  ['inspection_machines.csv', 'InLine Inspection', NONE],
  ['isocure_gas_machines.csv', 'Isocure Gas', COREBOX],
  ['manual_floor_moldmaking.csv', 'Manual Floor Moldmaking', FLASK],
  ['manual_pit_moldmaking.csv', 'Manual Pit Moldmaking', FLASK],
  ['manual_std_moldmaking.csv', 'Manual Std Moldmaking', FLASK],
  ['melting_machines.csv', 'Melting', NONE],
  ['nobake_machines.csv', 'No Bake', COREBOX],
  ['oilcore_machines.csv', 'Oil Core', COREBOX],
  ['pmcleaning_machines.csv', 'PM Cleaning', BLAST],
  ['pmcoremaking_machines.csv', 'PM CoreMaking', COREBOX],
  ['pmfinishing_machines.csv', 'PM Finishing', [null, null, null, 'Max Weight (kg)']],
  ['pminspection_machines.csv', 'PM Inspection', NONE],
  ['pmmelting_machines.csv', 'PM Melting', NONE],
  ['pmmolding_machines.csv', 'PM Molding', DIE],
  ['pour_machines.csv', 'Pour', [null, null, null, 'Ladle Weight Capacity (kg)']],
  ['shakeout_machine.csv', 'Shakeout', NONE],
  ['shell_machines.csv', 'Shell', COREBOX],
  ['stockcore_machine.csv', 'Stock Core', COREBOX],
  ['vertical_automatic_machines.csv', 'Vertical Automatic', FLASK],
  ['xray_machine.csv', 'X-ray', NONE],
];
// India screenshot -> process (processes.csv order; B1-12|B1-13 is the one
// two-screenshot list, B1-5|B1-19 one list shared by Finishing and PM Finishing,
// B2-8 the X-ray machine after the process list). Verified against the data below.
const IMAGE_PROCESS = {
  'B1-1': ['Cleaning'], 'B1-2': ['CO2 Cured'], 'B1-3': ['Cool'], 'B1-4': ['Die Casting'],
  'B1-5|B1-19': ['Finishing', 'PM Finishing'], 'B1-6': ['Horizontal Automatic'], 'B1-7': ['Hot Box'],
  'B1-8': ['InLine Inspection'], 'B1-9': ['Isocure Gas'], 'B1-10': ['Manual Floor Moldmaking'],
  'B1-11': ['Manual Pit Moldmaking'], 'B1-12|B1-13': ['Manual Std Moldmaking'], 'B1-14': ['Melting'],
  'B1-15': ['No Bake'], 'B1-16': ['Oil Core'], 'B1-17': ['PM Cleaning'], 'B1-18': ['PM CoreMaking'],
  'B1-20': ['PM Inspection'], 'B2-1': ['PM Melting'], 'B2-2': ['PM Molding'], 'B2-3': ['Pour'],
  'B2-4': ['Shakeout'], 'B2-5': ['Shell'], 'B2-6': ['Stock Core'], 'B2-7': ['Vertical Automatic'],
  'B2-8': ['X-ray'],
};

const classOf = (category) => 'casting_' + category.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const processes = readCsv(path.join(SRC, 'Processes', 'processes.csv')).rows.map((r) => String(r['Process Name']));
const wage = readCsv(path.join(SRC, 'wage_grade_associations.csv')).rows;
const onDisk = fs.readdirSync(path.join(SRC, 'Machine')).filter((f) => f.endsWith('.csv')).sort();
const unmapped = onDisk.filter((f) => !FILES.some(([x]) => x === f));
if (unmapped.length) throw new Error(`unmapped machine files: ${unmapped.join(', ')}`);
const unserved = processes.filter((p) => !['No Cost Feature', 'User-Defined Process'].includes(p) && !FILES.some(([, c]) => c === p));
if (unserved.length) throw new Error(`processes with no machine file: ${unserved.join(', ')}`);

const specs = FILES.map(([file, category, envelope]) => {
  const grade = wage.find((w) => w['Process Name'] === category)?.['Wage Grade Name'] ?? null;
  return { file: path.join(SRC, 'Machine', file), rel: `Casting/Machine/${file}`, category, machineClass: classOf(category), grade, envelope };
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
const t = parseCsv(fs.readFileSync(path.join(SRC, 'Indian data', INDIA_FILE), 'utf8').replace(/^﻿/, ''));
const h = t[0].map((x) => x.trim());
const india = t.slice(1).map((r) => Object.fromEntries(h.map((k, i) => [k, (r[i] ?? '').trim()])));
for (const r of india) {
  for (const k of ['labor_rate_usd_per_hr', 'direct_overhead_rate_usd_per_hr', 'indirect_overhead_rate_usd_per_hr']) {
    if (!Number.isFinite(Number(r[k])) || r[k] === '') throw new Error(`India ${r.machine_name}: ${k} "${r[k]}"`);
  }
  if (!IMAGE_PROCESS[r.source_image]) throw new Error(`India ${r.machine_name}: unknown screenshot ${r.source_image}`);
}

const indiaRows = [];   // { cat, usa | null, name, labor, direct, indirect, image, note }
const aliases = [];
const verify = [];
for (const [image, cats] of Object.entries(IMAGE_PROCESS)) {
  const list = india.filter((r) => r.source_image === image);
  for (const cat of cats) {
    const names = usaByCategory[cat];
    const exact = list.filter((r) => names.includes(r.machine_name)).length;
    const before = indiaRows.length;
    const claimed = new Set();
    const pending = [];
    for (const r of list) {
      if (names.includes(r.machine_name)) {
        if (claimed.has(r.machine_name)) throw new Error(`screenshot ${image}: ${r.machine_name} twice`);
        claimed.add(r.machine_name);
        indiaRows.push({ cat, usa: r.machine_name, r });
      } else pending.push(r);
    }
    const unmatched = [];
    for (const r of pending) {
      const cands = names.filter((n) => !claimed.has(n) && lev(n.toLowerCase(), r.machine_name.toLowerCase()) <= 2);
      if (cands.length === 1) {
        claimed.add(cands[0]);
        aliases.push(`${r.machine_name} -> ${cands[0]} (${cat})`);
        indiaRows.push({ cat, usa: cands[0], r });
      } else unmatched.push(r);
    }
    // One India name and one USA name left over in the same list: the same
    // machine read two ways (both files are screenshot transcriptions).
    const leftUsa = names.filter((n) => !claimed.has(n));
    if (unmatched.length === 1 && leftUsa.length === 1) {
      claimed.add(leftUsa[0]);
      aliases.push(`${unmatched[0].machine_name} -> ${leftUsa[0]} (${cat}; the one name left on both sides)`);
      indiaRows.push({ cat, usa: leftUsa[0], r: unmatched[0] });
    } else {
      for (const r of unmatched) indiaRows.push({ cat, usa: null, r });
    }
    // The screenshot really is this process's list: most of its machines are
    // machines of this process's file (exact or a 1-2 character misreading).
    const twins = indiaRows.slice(before).filter((x) => x.usa).length;
    if (twins < Math.ceil(list.length * 0.75)) throw new Error(`screenshot ${image}: only ${twins}/${list.length} names in ${cat}'s machine file`);
    verify.push(`${image} -> ${cat}: ${twins}/${list.length} matched (${exact} exact)`);
  }
}
const covered = new Set(india.map((r) => r.source_image));
if (covered.size !== Object.keys(IMAGE_PROCESS).length) throw new Error('screenshot list mismatch');

const num = (v) => String(Math.round(Number(v) * 1e6) / 1e6);
const extra = (r) => ({ india_source_file: `memory/Casting/Indian data/${INDIA_FILE}`, india_source_image: r.source_image, india_sector: r.sector || null, india_machine_type: r.machine_type || null, india_review_note: r.review_note || null, india_name_as_transcribed: r.machine_name });
const twinValues = indiaRows.filter((x) => x.usa).map((x) => `      (${sqlStr(classOf(x.cat))}, ${sqlStr(x.usa)}, ${num(x.r.labor_rate_usd_per_hr)}, ${num(x.r.direct_overhead_rate_usd_per_hr)}, ${num(x.r.indirect_overhead_rate_usd_per_hr)}, ${sqlJsonb(extra(x.r))})`).join(',\n');
const onlyRows = indiaRows.filter((x) => !x.usa);
const gradeOf = (cat) => wage.find((w) => w['Process Name'] === cat)?.['Wage Grade Name'] ?? null;
const onlyValues = onlyRows.map((x) => `  (${sqlStr(classOf(x.cat))}, $str$India$str$, ${sqlStr(x.r.machine_name)}, $str$USD$str$, $str$IN$str$, $str$BENCHMARK$str$, ${sqlStr(GROUP)}, ${sqlStr(gradeOf(x.cat))}, ${num(x.r.direct_overhead_rate_usd_per_hr)}, ${num(x.r.indirect_overhead_rate_usd_per_hr)}, ${num(x.r.labor_rate_usd_per_hr)}, ${sqlJsonb(extra(x.r))}, ${sqlStr(`${x.cat}:${x.r.machine_name}:India`)})`).join(',\n');
const perCat = specs.map((s) => {
  const n = indiaRows.filter((x) => x.cat === s.category);
  return `--   ${s.category.padEnd(24)} ${String(n.filter((x) => x.usa).length).padStart(3)}/${String(usaByCategory[s.category].length).padEnd(3)} twins${n.some((x) => !x.usa) ? `, ${n.filter((x) => !x.usa).length} India-only` : ''}`;
}).join('\n');
const notes = india.filter((r) => r.review_note).length;

const catVals = specs.filter((s) => processes.includes(s.category)).map((s) => `  (${sqlStr(s.category)}, ${sqlStr(s.machineClass)})`).join(',\n');

const header = `-- ============================================================================
-- Migration 848: Casting machines in HR Rates (USA + India)
-- ============================================================================
-- Generated by scripts/gen_848_seed_casting_mhr_records.js -- do not
-- hand-edit, re-run the generator and diff instead.
--
-- 1. USA: memory/Casting/Machine/*.csv (reference export). ${rows.length} machines:
${report.map((r) => `--   ${r.category.padEnd(24)} ${r.machineClass.padEnd(33)} ${String(r.n).padStart(2)} machine(s)  wage ${r.grade ?? '-'}`).join('\n')}
--    Row shape of 806/818/820/824/845 (scripts/lib/memory-machine-seed.js):
--    MHR = Direct OH + Indirect OH, LHR = labour rate, every other source
--    column in specs; HR Rates category = benchmark_source_key prefix.
--
-- 2. India: memory/Casting/Indian data/${INDIA_FILE} (${india.length} rows,
--    ${indiaRows.length} India machines). Each screenshot is one process's list:
${verify.map((v) => `--      ${v}`).join('\n')}
--    Per category (twins of the USA file / India-only machines):
${perCat}
--    Transcription errors (both files are screenshot transcriptions) resolved
--    to the one unclaimed USA name within edit distance 2 of the same file, or
--    to the one USA name left when exactly one India name is left:
${aliases.map((a) => `--      ${a}`).join('\n') || '--      none'}
--    India-only machines (no USA twin): seeded from their own India row,
--    rates only -- no capability is invented:
${onlyRows.map((x) => `--      ${x.r.machine_name} (${x.cat})`).join('\n') || '--      none'}
--    Rates are as transcribed, including the ${notes} rows the transcription
--    flagged (CONFLICT / VERIFY notes, e.g. Melting's 0.00 overheads in
--    screenshot B1-14); each India row carries its screenshot id and note in
--    specs (india_source_image, india_review_note) so they can be checked.
--
-- 3. Casting catalog rows (847): machine_class where still NULL.
--
-- Split into parts so each fits the SQL editor: run the USA parts first (any
-- order), then the last part (India + catalog). Statements are idempotent
-- (existing rows never overwritten).
-- ============================================================================
`;

// USA rows in chunks of at most ~170 KB of VALUES each.
const usaChunks = [];
let chunk = [], bytes = 0;
for (const r of rows) {
  const n = Buffer.byteLength(r.join(', ')) + 8;
  if (bytes + n > 170000 && chunk.length) { usaChunks.push(chunk); chunk = []; bytes = 0; }
  chunk.push(r); bytes += n;
}
if (chunk.length) usaChunks.push(chunk);
const total = usaChunks.length + 1;
const usaParts = usaChunks.map((c, i) => `${header}
-- ── Part ${i + 1} of ${total} ── 1. USA machines (${c.length} of ${rows.length}).
${insertSql(columns, c)}

NOTIFY pgrst, 'reload schema';
`);

const part2 = `${header}
-- ── Part ${total} of ${total} (run the USA parts first).
-- ── 2a. India machines with a USA twin: the twin at India rates.
DO $india848$
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
        WHEN 'specs'                                   THEN 'coalesce(usa.specs, ''{}''::jsonb) || $5'
        WHEN 'benchmark_source_key'                    THEN 'usa.benchmark_source_key || '':India'''
        ELSE 'usa.' || quote_ident(c.column_name)
      END, ', ' ORDER BY c.ordinal_position)
  INTO cols, sel
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'mhr_records'
    AND c.column_name NOT IN ('id', 'created_at', 'updated_at')
    AND c.is_generated = 'NEVER' AND c.identity_generation IS NULL;

  FOR r IN SELECT * FROM (VALUES
${twinValues}
  ) v(machine_class, name, labor, direct, indirect, extra)
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
        USING usa_id, r.direct, r.indirect, r.labor, r.extra;
      n := n + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'Casting India rows cloned from a USA twin: %', n;
  IF cardinality(missing) > 0 THEN
    RAISE NOTICE 'No USA twin (run part 1 first): %', array_to_string(missing, '; ');
  END IF;
END
$india848$;

-- ── 2b. India-only machines: their own India row (rates only).
INSERT INTO mhr_records (machine_class, location, machine_name, currency_code, country_code, source_type, process_group, wage_grade,
  direct_overhead_rate, indirect_overhead_rate, benchmark_direct_overhead_rate_usd_hr, benchmark_indirect_overhead_rate_usd_hr,
  total_machine_hour_rate, mhr_usd_per_hour, usd_labor_rate_per_hr, benchmark_labor_rate_usd_hr, usd_lhr_total, specs, benchmark_source_key)
SELECT v.machine_class, v.location, v.machine_name, v.currency_code, v.country_code, v.source_type, v.process_group, v.wage_grade,
  v.direct::numeric, v.indirect::numeric, v.direct::numeric, v.indirect::numeric,
  ROUND((v.direct + v.indirect)::numeric, 2), ROUND((v.direct + v.indirect)::numeric, 2), v.labor::numeric, v.labor::numeric, v.labor::numeric,
  v.specs, v.benchmark_source_key
FROM (VALUES
${onlyValues}
) AS v(machine_class, location, machine_name, currency_code, country_code, source_type, process_group, wage_grade, direct, indirect, labor, specs, benchmark_source_key)
WHERE NOT EXISTS (
  SELECT 1 FROM mhr_records m WHERE m.location = 'India' AND m.machine_class = v.machine_class
    AND lower(trim(m.machine_name)) = lower(trim(v.machine_name))
);

-- ── 3. Casting catalog rows (migration 847): machine_class, where still NULL.
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

for (const old of fs.readdirSync(path.dirname(OUT)).filter((n) => /^848_seed_casting_mhr_records.*\.sql$/.test(n))) fs.unlinkSync(path.join(path.dirname(OUT), old));
usaParts.forEach((p, i) => fs.writeFileSync(OUT.replace(/\.sql$/, `_part${i + 1}of${total}.sql`), p, 'utf8'));
fs.writeFileSync(OUT.replace(/\.sql$/, `_part${total}of${total}.sql`), part2, 'utf8');
console.log(`Wrote 848 parts: ${rows.length} USA machines, ${indiaRows.length} India machines (${onlyRows.length} India-only)`);
for (const r of report) console.log(`  ${r.machineClass}: ${r.n} | grade ${r.grade}`);
console.log(verify.join('\n'));
console.log('aliases:', aliases);
console.log('india-only:', onlyRows.map((x) => `${x.r.machine_name} (${x.cat})`));
