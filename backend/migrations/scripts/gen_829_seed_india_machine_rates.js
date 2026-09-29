#!/usr/bin/env node
// Generates migration 829: India machine rates from EVERY India file in memory/
//
//   memory/Secondary process/machines/India/India_Secondary_Process_Machine_Data_SingleSheet.xlsx
//   memory/Plastic Modeling/machine/India/machine_rates.csv      (the 12 secondary-process screenshots)
//   memory/Plastic Modeling/machine/India/machine_rates_2.csv    (band saws)
//   memory/Machining/machine/India/machining_final.csv           (per process)
//   memory/Machining/machine/India/all_machines_master.csv       (flat list, 412 rows;
//     byte-for-byte the same rows as Secondary .../all_machines_master (1).xlsx)
//
// Every file carries RATES ONLY (labour, direct and indirect overhead, USD/hr,
// transcribed from screenshots). An India machine is its USA reference machine
// (already in mhr_records from memory/, benchmark_source_key set) at India
// rates: every other column is cloned from that one USA row, the rule migration
// 594 set. How each India row finds its USA machine, decided by the data only:
//
//  1. Exact name.
//  2. Transcription errors: an India name with no exact USA name is paired with
//     the one USA machine name, among those no other India row already names,
//     within edit distance 2 (the screenshots misread 6/8/9/0/3/5, drop a
//     letter: GLT for GL7, 38 Litre for 36 Litre, DoAll C-455NC for C-455CNC).
//     Several candidates, or one USA name claimed twice, pairs nothing.
//  3. Unlabeled screenshot rows: machine_rates.csv holds the 12 secondary
//     processes as screenshots 1..12 in processes.csv order; its three "Default"
//     rows are screenshots 4 (CT Scan), 6 (Hydrostatic Leak Testing) and 12
//     (Xray Inspection) -- the three processes whose USA machine is "Default",
//     and each row's labour equals its process's wage-grade labour. The
//     Secondary workbook's "Manual Former (unlabeled default)" and "Default
//     (unlabeled)" are screenshots 4 and 6 again (identical rates; asserted).
//  4. A name the USA fleet holds in several categories (Haas SL 20 as a 2 Axis
//     Lathe and as a bar-feed lathe, at two labour rates) is matched on its
//     category; a row whose process is unreadable (UNIDENTIFIED-nn) takes the
//     one USA category left after the others are matched.
//  5. The same machine twice with different rates: keep the row whose labour
//     equals the labour every other machine of that process shares (labour is
//     per wage grade); otherwise nothing is inserted.
//  6. A machine that exists only in India data is seeded from its own India
//     data (rates; power and max part size from its description) under the one
//     USA category its process names (Gear Grinding by its own TWG/PG flags);
//     no capability is invented. A process with no single USA category skips it.
//
// Rates stay USD (as 594). Existing India rows are never overwritten.
//
// Run: node backend/migrations/scripts/gen_829_seed_india_machine_rates.js

const fs = require('fs');
const path = require('path');
const ExcelJS = require(path.join(__dirname, '..', '..', 'node_modules', 'exceljs'));

const ROOT = path.resolve(__dirname, '..', '..', '..');
const MEM = path.join(ROOT, 'memory');
const OUT = path.join(__dirname, '..', '829_seed_india_machine_rates.sql');

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
function readCsv(file) {
  const t = parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const h = t[0].map((x) => x.trim());
  return t.slice(1).map((r) => Object.fromEntries(h.map((k, i) => [k, (r[i] ?? '').trim()])));
}
const num = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : Number(v));
const sqlStr = (v) => (v === null || v === undefined || String(v).trim() === '' ? 'NULL' : `$str$${String(v).trim()}$str$`);
const sqlNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : 'NULL');
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

// ── USA machine names in memory/ (everything outside India folders) ─────────
const usaNames = new Set();
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'India') walk(p); continue; }
    if (!/achine/.test(p)) continue;
    if (e.name.endsWith('.csv')) {
      let rows; try { rows = readCsv(p); } catch { continue; }
      for (const r of rows) {
        for (const c of ['Primary ID (Name)', 'Machine Name', 'Name', 'machine_name', 'name']) {
          if (c in r) { if (r[c]) usaNames.add(r[c]); break; }
        }
      }
    } else if (e.name.endsWith('.json')) {
      let d; try { d = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
      const st = [d];
      while (st.length) {
        const o = st.pop();
        if (Array.isArray(o)) st.push(...o);
        else if (o && typeof o === 'object') {
          for (const k of ['name', 'machine_name', 'Name']) if (typeof o[k] === 'string' && o[k].trim()) usaNames.add(o[k].trim());
          st.push(...Object.values(o));
        }
      }
    }
  }
})(MEM);
const usaLower = new Map([...usaNames].map((n) => [n.toLowerCase(), n]));

(async () => {
  const rows = []; // { name, category, labor, direct, indirect, source, description?, twg?, pg? }

  // Secondary workbook
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(MEM, 'Secondary process/machines/India/India_Secondary_Process_Machine_Data_SingleSheet.xlsx'));
  const ws = wb.worksheets[0];
  const hdr = ws.getRow(1).values.slice(1).map((h) => String(h).trim());
  const secWb = [];
  ws.eachRow((r, i) => {
    if (i === 1) return;
    const v = (k) => r.getCell(hdr.indexOf(k) + 1).value;
    if (!v('Machine_ID')) return;
    secWb.push({ name: String(v('Machine_ID')).trim(), category: String(v('Category') ?? ''), labor: num(v('Labor_Rate_USD_per_hr')), direct: num(v('Direct_Overhead_Rate_USD_per_hr')), indirect: num(v('Indirect_Overhead_Rate_USD_per_hr')) });
  });

  // Plastic Modeling machine_rates.csv: screenshot n = processes.csv row n
  const processes = readCsv(path.join(MEM, 'Secondary process/processes.csv')).map((r) => r['Process Name']);
  const shots = readCsv(path.join(MEM, 'Plastic Modeling/machine/India/machine_rates.csv'));
  const imageProcess = (img) => processes[Number(img) - 1];
  for (const r of shots) {
    const category = imageProcess(r.Source_Image);
    if (!category) throw new Error(`machine_rates.csv: screenshot ${r.Source_Image} has no process`);
    rows.push({ name: r.Machine_ID, category, labor: num(r.Labor_Rate_USD_per_hr), direct: num(r.Direct_Overhead_Rate_USD_per_hr), indirect: num(r.Indirect_Overhead_Rate_USD_per_hr), source: 'Plastic Modeling/machine/India/machine_rates.csv' });
  }
  // Workbook: same machines; unlabeled rows must equal their screenshot rows.
  const WB_CATEGORY = { 'Pack And Load': 'Pack & Load' };
  for (const r of secWb) {
    if (/\(unlabeled/.test(r.name)) {
      const same = rows.find((x) => x.name === 'Default' && x.labor === r.labor && x.direct === r.direct && x.indirect === r.indirect);
      if (!same) throw new Error(`workbook row ${r.name} matches no screenshot Default row`);
      continue; // identified through its screenshot
    }
    const category = r.category.startsWith('Unmapped') ? null : (WB_CATEGORY[r.category] ?? r.category);
    rows.push({ ...r, category, source: 'Secondary process/machines/India/India_Secondary_Process_Machine_Data_SingleSheet.xlsx' });
  }
  for (const r of readCsv(path.join(MEM, 'Plastic Modeling/machine/India/machine_rates_2.csv'))) {
    rows.push({ name: r.Machine_ID, category: null, labor: num(r.Labor_Rate_USD_per_hr), direct: num(r.Direct_Overhead_Rate_USD_per_hr), indirect: num(r.Indirect_Overhead_Rate_USD_per_hr), source: 'Plastic Modeling/machine/India/machine_rates_2.csv' });
  }
  for (const r of readCsv(path.join(MEM, 'Machining/machine/India/machining_final.csv'))) {
    let category = r.process;
    const twg = r.twg_capable === 'true', pg = r.pg_capable === 'true';
    if (category === 'Gear Grinding') category = twg && !pg ? 'Threaded Wheel Gear Grinder' : pg && !twg ? 'Profile Gear Grinder' : 'Gear Grinding';
    rows.push({ name: r.machine_name, category, labor: num(r.labor_rate_usd_per_hr), direct: num(r.direct_overhead_rate_usd_per_hr), indirect: num(r.indirect_overhead_rate_usd_per_hr), description: r.description, source: 'Machining/machine/India/machining_final.csv' });
  }
  for (const r of readCsv(path.join(MEM, 'Machining/machine/India/all_machines_master.csv'))) {
    rows.push({ name: r.Machine, category: null, labor: num(r.Labor_Rate_USD_per_hr), direct: num(r.Direct_Overhead_Rate_USD_per_hr), indirect: num(r.Indirect_Overhead_Rate_USD_per_hr), source: 'Machining/machine/India/all_machines_master.csv' });
  }
  const noRate = rows.filter((r) => [r.labor, r.direct, r.indirect].some((v) => v === null || !Number.isFinite(v)));
  const valid = rows.filter((r) => !noRate.includes(r));

  // ── 2. transcription errors ────────────────────────────────────────────────
  const claimed = new Set(valid.map((r) => usaLower.get(r.name.toLowerCase())).filter(Boolean));
  const free = [...usaNames].filter((n) => !claimed.has(n));
  const unmatched = [...new Set(valid.map((r) => r.name).filter((n) => !usaLower.has(n.toLowerCase())))];
  const proposal = new Map();
  for (const n of unmatched) {
    let best = Infinity, cands = [];
    for (const f of free) {
      const d = lev(n.toLowerCase(), f.toLowerCase());
      if (d < best) { best = d; cands = [f]; } else if (d === best) cands.push(f);
    }
    if (best <= 2 && cands.length === 1) proposal.set(n, { to: cands[0], d: best });
  }
  const targetCount = new Map();
  for (const { to } of proposal.values()) targetCount.set(to, (targetCount.get(to) ?? 0) + 1);
  const alias = new Map([...proposal].filter(([, p]) => targetCount.get(p.to) === 1));
  for (const r of valid) if (alias.has(r.name)) { r.indiaName = r.name; r.name = alias.get(r.name).to; }

  // ── 5. duplicates ──────────────────────────────────────────────────────────
  const modalLabor = (category) => {
    const counts = new Map();
    for (const r of valid) if (r.category === category) counts.set(r.labor, (counts.get(r.labor) ?? 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1]);
    return top.length && (top.length === 1 || top[0][1] > top[1][1]) ? top[0][0] : null;
  };
  const byKey = new Map();
  for (const r of valid) {
    const k = `${r.name.toLowerCase()}|${r.category ?? ''}`;
    (byKey.get(k) ?? byKey.set(k, []).get(k)).push(r);
  }
  const chosen = [];
  const conflicts = [];
  for (const [, list] of byKey) {
    const tuples = new Map(list.map((r) => [`${r.labor}|${r.direct}|${r.indirect}`, r]));
    if (tuples.size === 1) { chosen.push(list[0]); continue; }
    const mode = list[0].category ? modalLabor(list[0].category) : null;
    const pick = [...tuples.values()].filter((r) => r.labor === mode);
    if (pick.length === 1) chosen.push({ ...pick[0], resolved: `labour ${mode} shared by its process (other value${tuples.size > 2 ? 's' : ''} dropped)` });
    else conflicts.push(list);
  }
  // Flat-list rows only fill machines no categorised file names.
  const categorisedNames = new Set(chosen.filter((r) => r.category).map((r) => r.name.toLowerCase()));
  const finalRows = chosen.filter((r) => r.category || !categorisedNames.has(r.name.toLowerCase()));
  // A flat duplicate name with two rate tuples and no category cannot be placed.
  const flatAmbiguous = conflicts.filter((l) => !l[0].category && categorisedNames.has(l[0].name.toLowerCase()));
  const realConflicts = conflicts.filter((l) => !flatAmbiguous.includes(l));

  // ── 6. India-only capability from the description ─────────────────────────
  for (const r of finalRows) {
    const m = /([\d.]+)\s*hp,\s*([\d.]+)\s*in max part length,\s*([\d.]+)\s*in max part width/i.exec(r.description ?? '');
    if (m) { r.powerKw = Number(m[1]) * 0.745699872; r.maxX = Number(m[2]) * 25.4; r.maxY = Number(m[3]) * 25.4; }
  }

  const values = finalRows.map((r) =>
    `      (${sqlStr(r.name)}, ${sqlStr(r.category && !/^UNIDENTIFIED/.test(r.category) ? r.category : null)}, ${sqlStr(r.category && /^UNIDENTIFIED/.test(r.category) ? r.category : null)}, ${sqlNum(r.labor)}, ${sqlNum(r.direct)}, ${sqlNum(r.indirect)}, ${sqlStr(r.description && !r.powerKw ? null : r.description)}, ${sqlNum(r.powerKw)}, ${sqlNum(r.maxX)}, ${sqlNum(r.maxY)})`,
  ).join(',\n');
  const aliasLines = [...alias].map(([from, p]) => `--   ${from}  ->  ${p.to}  (edit distance ${p.d})`).join('\n');
  const unresolvedAlias = unmatched.filter((n) => !alias.has(n));
  const conflictLines = realConflicts.map((l) => `--   ${l[0].name} (${l[0].category ?? 'no process'}): ${[...new Set(l.map((r) => `${r.labor}/${r.direct}/${r.indirect}`))].join(' vs ')}`).join('\n');
  const resolvedLines = chosen.filter((r) => r.resolved).map((r) => `--   ${r.name} (${r.category}): ${r.resolved}`).join('\n');

  const sql = `-- ============================================================================
-- Migration 829: India machine rates from every India file in memory/
-- ============================================================================
-- Generated by scripts/gen_829_seed_india_machine_rates.js -- do not hand-edit,
-- re-run the generator and diff instead. The generator header documents the
-- matching rules; this header records what they decided.
--
-- Sources (rates only, USD/hr, transcribed from screenshots):
--   Secondary process/machines/India/India_Secondary_Process_Machine_Data_SingleSheet.xlsx
--   Plastic Modeling/machine/India/machine_rates.csv, machine_rates_2.csv
--   Machining/machine/India/machining_final.csv, all_machines_master.csv
--   (Secondary .../all_machines_master (1).xlsx is the same 412 rows as the csv.)
-- ${rows.length} rows read, ${finalRows.length} distinct India machines after merging.
--
-- Transcription errors resolved to the one unclaimed USA machine name:
${aliasLines || '--   none'}
--
-- Unlabeled screenshot rows: machine_rates.csv screenshots 4, 6 and 12 are the
-- "Default" machines of CT Scan, Hydrostatic Leak Testing and Xray Inspection.
--
-- Duplicates resolved by the labour rate their process shares:
${resolvedLines || '--   none'}
--
-- NOT inserted (listed again by the NOTICE when run):
--   no USA machine within edit distance 2 (India-only machines; seeded only
--   when their process names exactly one USA category, else skipped):
--     ${unresolvedAlias.join('; ') || 'none'}
--   rate conflicts the data cannot settle:
${conflictLines || '--     none'}
--
-- Every India row clones its USA twin (all columns, read from
-- information_schema), overriding location, country, rates and
-- benchmark_source_key (suffixed :India). Rates stay USD, as in migration 594.
-- Existing India rows are never overwritten. One DO block. Run it LAST, after
-- every USA machine seed (806, 815, 818, 820, 824, 826, 828), so each India row
-- finds its USA twin.
-- ============================================================================

DO $india829$
DECLARE
  cols text; sel text;
  r record; t record;
  n_twin integer := 0; n_only integer := 0;
  skipped text[] := '{}';
  used uuid[] := '{}';
  cat_class text; cat_group text; cat_grade text; n_class integer;
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

  -- Pass 1 matches rows with a named process (and unique names); pass 2 gives
  -- UNIDENTIFIED-process rows the one USA twin their name has left.
  FOR r IN
    SELECT *, CASE WHEN unidentified IS NULL THEN 1 ELSE 2 END AS pass FROM (VALUES
${values}
    ) v(name, category, unidentified, labor, direct, indirect, description, power_kw, max_x, max_y)
    ORDER BY pass
  LOOP
    SELECT usa.id, usa.machine_class, usa.machine_name INTO t
    FROM mhr_records usa
    WHERE usa.location = 'USA' AND usa.benchmark_source_key IS NOT NULL
      AND lower(trim(usa.machine_name)) = lower(trim(r.name))
      AND NOT (usa.id = ANY (used))
      AND (
        -- one twin left for this name
        (SELECT count(*) FROM mhr_records u2
          WHERE u2.location = 'USA' AND u2.benchmark_source_key IS NOT NULL
            AND lower(trim(u2.machine_name)) = lower(trim(r.name)) AND NOT (u2.id = ANY (used))) = 1
        -- or the twin in this row's own category
        OR split_part(usa.benchmark_source_key, ':', 1) = r.category
      )
    ORDER BY (split_part(usa.benchmark_source_key, ':', 1) = r.category) DESC
    LIMIT 1;

    IF t.id IS NOT NULL THEN
      used := used || t.id;
      IF NOT EXISTS (SELECT 1 FROM mhr_records m WHERE m.location = 'India'
                     AND m.machine_class = t.machine_class AND lower(trim(m.machine_name)) = lower(trim(t.machine_name))) THEN
        EXECUTE format('INSERT INTO mhr_records (%s) SELECT %s FROM mhr_records usa WHERE usa.id = $1', cols, sel)
          USING t.id, r.direct, r.indirect, r.labor;
        n_twin := n_twin + 1;
      END IF;
    ELSIF r.category IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM mhr_records usa WHERE usa.location = 'USA' AND usa.benchmark_source_key IS NOT NULL
              AND lower(trim(usa.machine_name)) = lower(trim(r.name))) THEN
      -- India-only machine: its process must name exactly one USA category/class.
      SELECT count(DISTINCT machine_class), min(machine_class), min(process_group), min(wage_grade)
        INTO n_class, cat_class, cat_group, cat_grade
      FROM mhr_records WHERE location = 'USA' AND benchmark_source_key LIKE r.category || ':%';
      IF n_class = 1 AND NOT EXISTS (SELECT 1 FROM mhr_records m WHERE m.location = 'India'
                                     AND m.machine_class = cat_class AND lower(trim(m.machine_name)) = lower(trim(r.name))) THEN
        INSERT INTO mhr_records (machine_class, location, machine_name, machine_description, currency_code, country_code,
          source_type, process_group, wage_grade, direct_overhead_rate, indirect_overhead_rate,
          benchmark_direct_overhead_rate_usd_hr, benchmark_indirect_overhead_rate_usd_hr,
          total_machine_hour_rate, mhr_usd_per_hour, usd_labor_rate_per_hr, benchmark_labor_rate_usd_hr, usd_lhr_total,
          machine_power_kw, max_x_mm, max_y_mm, capability_source, benchmark_source_key)
        VALUES (cat_class, 'India', r.name, r.description, 'USD', 'IN', 'BENCHMARK', cat_group, cat_grade,
          r.direct, r.indirect, r.direct, r.indirect,
          ROUND((r.direct + r.indirect)::numeric, 2), ROUND((r.direct + r.indirect)::numeric, 2), r.labor, r.labor, r.labor,
          r.power_kw, r.max_x, r.max_y, CASE WHEN r.max_x IS NOT NULL THEN 'imported' END,
          r.category || ':' || r.name || ':India');
        n_only := n_only + 1;
      ELSE
        skipped := skipped || (r.name || ' (' || r.category || ')');
      END IF;
    ELSE
      skipped := skipped || (r.name || COALESCE(' (' || COALESCE(r.category, r.unidentified) || ')', ''));
    END IF;
  END LOOP;

  RAISE NOTICE 'India rows cloned from a USA twin: %, India-only machines: %', n_twin, n_only;
  RAISE NOTICE 'Not inserted: %', CASE WHEN cardinality(skipped) = 0 THEN 'none' ELSE array_to_string(skipped, '; ') END;
END
$india829$;

NOTIFY pgrst, 'reload schema';

-- Verify: SELECT process_group, count(*) FROM mhr_records WHERE location = 'India'
-- AND benchmark_source_key LIKE '%:India' GROUP BY 1 ORDER BY 1;
`;
  fs.writeFileSync(OUT, sql, 'utf8');
  console.log(`Wrote ${path.relative(ROOT, OUT)}: ${rows.length} rows read, ${finalRows.length} machines, ${alias.size} aliases, ${noRate.length} without rates`);
  console.log('unresolved names:', unresolvedAlias.join('; '));
  console.log('duplicates resolved:', chosen.filter((r) => r.resolved).map((r) => `${r.name}/${r.category}`).join('; ') || 'none');
  console.log('conflicts left:', realConflicts.map((l) => `${l[0].name}/${l[0].category}`).join('; ') || 'none');
  console.log('flat ambiguous (covered by categorised rows):', flatAmbiguous.length);
})().catch((e) => { console.error(e); process.exit(1); });
