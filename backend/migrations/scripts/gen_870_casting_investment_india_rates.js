// Generates migration 870: Casting Investment India rates, the USA twin (migration 869)
// at India rates. Source: memory/Casting Investment/Indian data/investment_casting_machine_rates_FINAL.csv.
//
// The India file is read with a plain comma split, not the shared quote-aware CSV parser:
// every row has exactly 7 fields (checked), and several machine names carry a bare,
// unescaped `"` for inches (e.g. `Pacific Kiln SM 36" Deluxe Slurry`) that the quote-aware
// parser misreads as a quote delimiter and corrupts the rest of the file. The USA machine
// files escape the same inch mark properly (`""`), so they still use the shared parser.
//
// Matching: a USA machine and an India row are the same physical machine when, after
// lowercasing and removing whitespace, their names are identical, or -- when the two files
// spell the name differently (a transcription slip, not a different machine) -- within edit
// distance 2 of each other and there is exactly one such USA candidate, the same resolution
// migration 845 already uses for this exact problem. A name can be the HR Rates row of more
// than one USA process file (e.g. "Pacific Kiln PBF-60" rates Flash Fire De-Waxing's, Mold
// Burnout's and Mold Preheating's own machine); where the India file disambiguates with a
// suffix, the suffix picks the one USA category it rates; where it does not (e.g. "Wax
// Injection 100 Ton" is the India rate for both Soluble Wax Core Making and Wax Pattern
// Molding), the one given rate is applied to every USA row of that exact name -- the same
// real machine, not a fabricated number.
//
// Disclosed, not guessed: Ceramic Leaching and Soluble Wax Leaching share the exact same
// 5 Magnus machine names. India gives two distinct rate sets for them (plain and "(group
// 2)"), which really do differ, but nothing in the file says which set belongs to which
// USA category. Left unlinked; reported in the migration header for a human decision.
const fs = require('fs');
const path = require('path');
const { parseCsv, sqlStr, sqlNum } = require('./lib/memory-machine-seed');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SRC = path.join(ROOT, 'memory', 'Casting Investment');
const OUT = path.join(__dirname, '..', '870_casting_investment_india_rates.sql');
const GROUP = 'Casting Investment';
const INDIA_FILE = path.join(SRC, 'Indian data', 'investment_casting_machine_rates_FINAL.csv');

// Same 20 files/categories as migration 869's generator.
const FILES = [
  ['band_saw_machine.csv', 'Band Saw'], ['belt_sand_machine.csv', 'Belt Sand'],
  ['ceramic_core_extrusion_machines.csv', 'Ceramic Core Extrusion'], ['ceramic_core_firing_machines.csv', 'Ceramic Core Firing'],
  ['ceramic_core_making_machines.csv', 'Ceramic Core Making'], ['ceramic_leaching_machines.csv', 'Ceramic Leaching'],
  ['chemical_etching_machines.csv', 'Chemical Etching'], ['flash_fire_dewaxing_machines.csv', 'Flash Fire De-Waxing'],
  ['knockout_machine.csv', 'Knockout'], ['metal_pouring_machines.csv', 'Metal Pouring'],
  ['mold_burnout_machines.csv', 'Mold Burnout'], ['mold_preheating_machines.csv', 'Mold Preheating'],
  ['primary_sand_coating_machine.csv', 'Primary Sand Coating'], ['primary_slurry_dipping_machines.csv', 'Primary Slurry Dipping'],
  ['robotic_assist_machines.csv', 'Robotic Assist'], ['secondary_slurry_dipping_machines.csv', 'Secondary Slurry Dipping'],
  ['soluble_wax_core_making_machines.csv', 'Soluble Wax Core Making'], ['soluble_wax_leaching_machines.csv', 'Soluble Wax Leaching'],
  ['steam_autoclave_dewaxing_machines.csv', 'Steam Autoclave De-Waxing'], ['wax_pattern_molding_machines.csv', 'Wax Pattern Molding'],
];
const classOf = (category) => 'casting_investment_' + category.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const norm = (s) => s.toLowerCase().replace(/\s+/g, '');

function lev(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, d[j], d[j - 1]);
      prev = tmp;
    }
  }
  return d[b.length];
}

// category -> real USA machine names, read with the shared (quote-aware, correct for these
// files) parser, the same way gen_869 reads them.
const namesOf = (file) => {
  const text = fs.readFileSync(path.join(SRC, 'Machine', file), 'utf8').replace(/^﻿/, '');
  const pairs = parseCsv(text);
  if (pairs[0][0] === 'Field') return [pairs.slice(1).find((r) => r[0] === 'Name')[1]];
  const ni = pairs[0].indexOf('Name');
  return pairs.slice(1).filter((r) => r.length > 1).map((r) => r[ni]);
};
const usaByCategory = Object.fromEntries(FILES.map(([file, cat]) => [cat, namesOf(file)]));
// Flat list of every (category, name, normalized-name) for cross-category fuzzy matching.
const usaFlat = Object.entries(usaByCategory).flatMap(([cat, names]) => names.map((name) => ({ cat, name, n: norm(name) })));

// India file: plain comma split (7 fields/row, checked by the caller before this is trusted).
const indiaText = fs.readFileSync(INDIA_FILE, 'utf8').replace(/^﻿/, '');
const indiaLines = indiaText.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.length);
const indiaHeader = indiaLines[0].split(',');
if (indiaHeader.length !== 7) throw new Error(`India file: expected 7 columns, found ${indiaHeader.length}`);
const indiaRaw = indiaLines.slice(1).map((line) => {
  const f = line.split(',');
  if (f.length !== 7) throw new Error(`India file: row with ${f.length} fields, expected 7: ${line}`);
  return { name: f[0].trim(), labor: Number(f[1]), direct: Number(f[2]), indirect: Number(f[3]) };
});

const SUFFIX = [
  [/ \(group 2\)$/, 'group2'],
  [/ \(Burnout group\)$/, 'Mold Burnout'],
  [/ \(Flash Fire group\)$/, 'Flash Fire De-Waxing'],
  [/ \(Preheat group\)$/, 'Mold Preheating'],
];
const EXCLUDED_NAMES = new Set(['Default Bench', 'Default Machine (variant A)', 'Default Machine (variant B)']);

const indiaRows = [];       // { cat, usa, labor, direct, indirect }
const resolved = [];        // report lines
const fuzzyResolved = [];   // report lines, separately called out
const ambiguousGroup2 = []; // Magnus plain/group2: disclosed, not assigned.
const unmatched = [];

for (const r of indiaRaw) {
  const { name, labor, direct, indirect } = r;
  if (EXCLUDED_NAMES.has(name)) continue;
  for (const v of [labor, direct, indirect]) if (!Number.isFinite(v)) throw new Error(`India ${name}: non-numeric rate`);

  let base = name, hint = null;
  for (const [re, h] of SUFFIX) { if (re.test(name)) { base = name.replace(re, ''); hint = h; break; } }
  const baseN = norm(base);

  // matches holds the REAL per-category USA spelling, never the India-side spelling --
  // the SQL lookup below compares machine_name with a case-sensitive '=', so using
  // anything but the exact database string here would silently match nothing.
  let matches = Object.entries(usaByCategory).flatMap(([cat, names]) => {
    const hit = names.find((n) => norm(n) === baseN);
    return hit ? [{ cat, usa: hit }] : [];
  });
  if (matches.length === 0) {
    // Fuzzy fallback, scoped to the hinted category when the India row carries one.
    const pool = hint && hint !== 'group2' ? usaFlat.filter((u) => u.cat === hint) : usaFlat;
    // Tier 1: edit distance, same rule as migration 845 -- the single candidate at the
    // strict minimum distance (<=2), not merely any candidate within 2 (a tie at the
    // minimum is a real ambiguity, not a typo to resolve).
    const withDist = pool.map((u) => ({ ...u, d: lev(u.n, baseN) })).filter((u) => u.d <= 2);
    const minD = withDist.length ? Math.min(...withDist.map((u) => u.d)) : null;
    const atMin = withDist.filter((u) => u.d === minD);
    const uniqueAtMin = [...new Set(atMin.map((c) => c.name))];
    if (uniqueAtMin.length === 1) {
      matches = atMin.map((c) => ({ cat: c.cat, usa: c.name }));
      fuzzyResolved.push(`${name} -> ${uniqueAtMin[0]} (edit distance ${minD}, ${[...new Set(matches.map((m) => m.cat))].join(', ')})`);
    } else if (uniqueAtMin.length > 1) {
      unmatched.push(`${name} (ambiguous at distance ${minD}: ${uniqueAtMin.join(' / ')})`);
      continue;
    } else {
      // Tier 2: the India name is a prefix of exactly one USA name (a truncated name,
      // e.g. "...Tank" for USA's "...Tank Size" -- not a typo, but still unambiguous).
      const prefixCands = pool.filter((u) => u.n.startsWith(baseN));
      const uniquePrefix = [...new Set(prefixCands.map((c) => c.name))];
      if (uniquePrefix.length === 1) {
        matches = prefixCands.map((c) => ({ cat: c.cat, usa: c.name }));
        fuzzyResolved.push(`${name} -> ${uniquePrefix[0]} (truncated name, ${[...new Set(matches.map((m) => m.cat))].join(', ')})`);
      } else {
        unmatched.push(`${name}${uniquePrefix.length > 1 ? ` (ambiguous prefix: ${uniquePrefix.join(' / ')})` : ''}`);
        continue;
      }
    }
  }

  if (hint === 'group2') { ambiguousGroup2.push({ name, base: matches[0].usa, labor, direct, indirect, variant: 'group 2' }); continue; }
  if (hint) {
    const hitHint = matches.find((m) => m.cat === hint);
    if (!hitHint) throw new Error(`India ${name}: hinted category ${hint} has no USA machine matching`);
    indiaRows.push({ cat: hint, usa: hitHint.usa, labor, direct, indirect });
    resolved.push(`${name} -> ${hint}`);
    continue;
  }
  for (const m of matches) indiaRows.push({ cat: m.cat, usa: m.usa, labor, direct, indirect });
  resolved.push(`${name} -> ${matches.map((m) => m.cat).join(', ')}`);
}
// Plain Magnus names (no suffix) also match both Ceramic Leaching and Soluble Wax Leaching,
// the same ambiguity as the group-2 set -- both sets stay disclosed, not assigned.
const plainMagnusAmbiguous = indiaRows.filter((r) => ['Ceramic Leaching', 'Soluble Wax Leaching'].includes(r.cat));
for (const r of plainMagnusAmbiguous) ambiguousGroup2.push({ name: r.usa, base: r.usa, labor: r.labor, direct: r.direct, indirect: r.indirect, variant: 'plain' });
const finalIndiaRows = indiaRows.filter((r) => !['Ceramic Leaching', 'Soluble Wax Leaching'].includes(r.cat));

const values = finalIndiaRows.map((r) => `  (${sqlStr(classOf(r.cat))}, ${sqlStr(r.usa)}, ${sqlNum(r.labor)}, ${sqlNum(r.direct)}, ${sqlNum(r.indirect)})`).join(',\n');
const byCat = {};
for (const r of finalIndiaRows) (byCat[r.cat] ??= new Set()).add(r.usa);

const header = `-- ============================================================================
-- Migration 870: Casting Investment machines, India rates (USA twin cloned at India rates)
-- ============================================================================
-- Generated by scripts/gen_870_casting_investment_india_rates.js -- do not
-- hand-edit, re-run the generator and diff instead.
--
-- Source: memory/Casting Investment/Indian data/investment_casting_machine_rates_FINAL.csv
-- (91 rows; read with a plain comma split, not the quote-aware parser -- several names carry
-- an unescaped inches mark the India file never quotes, unlike the USA files).
-- ${finalIndiaRows.length} India rates matched to a USA machine (migration 869):
${Object.entries(byCat).map(([cat, names]) => `--   ${cat.padEnd(28)} ${names.size} machine(s)`).join('\n')}
--
-- Names the two files spell differently for the same machine, resolved by edit distance <=2
-- within the candidate USA category set (the same rule migration 845 uses for this exact
-- problem -- a transcription slip, never a different machine):
${fuzzyResolved.map((a) => `--   ${a}`).join('\n') || '--   none'}
--
-- Not inserted, with the reason:
--   Default Bench, Default Machine (variant A), Default Machine (variant B): the USA
--     template placeholders themselves were not seeded (migration 869), so there is no
--     USA row to clone.
--   Ceramic Leaching and Soluble Wax Leaching (5 Magnus machines each, 10 India rows:
--     5 plain + 5 "(group 2)"): both USA categories carry the exact same 5 machine names,
--     and the two India rate sets genuinely differ, but nothing in the source file says
--     which set rates which category. Left unlinked -- a human decision, not guessed.
${unmatched.map((u) => `--   ${u}: no unambiguous USA match. Left unlinked -- a human decision, not guessed.`).join('\n')}
--
-- Idempotent: an India row already present for a machine_class + machine_name is skipped,
-- the same guard migration 845 uses (mhr_records has no unique constraint to ON CONFLICT on).
-- Verify: SELECT split_part(benchmark_source_key, ':', 1) AS machine_class, count(*)
--   FROM mhr_records WHERE process_group = '${GROUP}' AND location = 'India' GROUP BY 1 ORDER BY 1;
-- expect ${finalIndiaRows.length} total.
-- ============================================================================

DO $india870$
DECLARE
  cols text; sel text; r record; usa_id uuid; n integer := 0; missing text[] := '{}';
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
        WHEN 'id'                                      THEN 'gen_random_uuid()'
        WHEN 'created_at'                              THEN 'now()'
        WHEN 'updated_at'                              THEN 'now()'
        ELSE 'usa_row.' || quote_ident(c.column_name)
      END, ', ' ORDER BY c.ordinal_position
    )
  INTO cols, sel
  FROM information_schema.columns c
  WHERE c.table_name = 'mhr_records';

  FOR r IN SELECT * FROM (VALUES
${values}
  ) AS v(machine_class, usa_name, labor, direct, indirect)
  LOOP
    SELECT id INTO usa_id FROM mhr_records
    WHERE process_group = '${GROUP}' AND location = 'USA' AND machine_class = r.machine_class AND machine_name = r.usa_name
    LIMIT 1;
    IF usa_id IS NULL THEN
      missing := array_append(missing, r.machine_class || ':' || r.usa_name);
      CONTINUE;
    END IF;
    -- Idempotency guard, same as migration 845: an India row for this machine_class +
    -- machine_name already present means this row was already inserted by an earlier run.
    IF EXISTS (SELECT 1 FROM mhr_records m WHERE m.location = 'India' AND m.machine_class = r.machine_class AND m.machine_name = r.usa_name) THEN
      CONTINUE;
    END IF;
    EXECUTE format(
      'INSERT INTO mhr_records (%s) SELECT %s FROM mhr_records usa_row WHERE usa_row.id = $1',
      cols, sel
    ) USING usa_id, r.direct, r.indirect, r.labor;
    n := n + 1;
  END LOOP;

  RAISE NOTICE 'Casting Investment India rows inserted: %', n;
  IF array_length(missing, 1) > 0 THEN
    RAISE NOTICE 'Casting Investment India rows with no USA match (not inserted): %', missing;
  END IF;
END $india870$;

NOTIFY pgrst, 'reload schema';
`;

fs.writeFileSync(OUT, header, 'utf8');
console.log(`Wrote ${path.basename(OUT)}: ${finalIndiaRows.length} India rates resolved`);
console.log('Exact:', resolved.length, '| Fuzzy (edit distance <=2):', fuzzyResolved.length, '| Disclosed/unassigned (Magnus):', ambiguousGroup2.length);
for (const a of fuzzyResolved) console.log(`  FUZZY: ${a}`);
for (const r of ambiguousGroup2) console.log(`  DISCLOSED (not written): ${r.name} (${r.variant}) base=${r.base}`);
