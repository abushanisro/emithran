#!/usr/bin/env node
// Generates migration 862: the Process catalog and HR Rates machines of every
// memory/ domain that had neither yet, the shape of 844/845 (Die Casting),
// 847/848 (Casting) and 851 (Sand Casting), one config row per domain:
//
//   process_taxonomy             one row per process in the domain's process file
//   process_taxonomy_operations  one row per Process:Operation//Feature entry
//   process_calculator_mappings  one row per process, inactive (no cost engine)
//   mhr_records                  every machine in the domain's machine files
//                                (USA; Casting Investment also India twins)
//
// Design rules (same as gen_790 / gen_844 / gen_851):
//   * Source of truth is the CSV under memory/, never a hand-kept list.
//   * No cost engine exists for any of these domains: roadmap_status
//     'not_modeled' (Material Stock-type rows 'non_mfg'), mapping rows
//     INACTIVE, machine_class '<domain>_<process>' on catalog and machines.
//   * A machine file is matched to its process by name; the few files whose
//     name differs are listed per domain in `alias`, never fuzzy-matched.
//   * Source shapes are normalised, never reinterpreted: a transposed
//     Field,Value file is one machine; "Accounting: " style section prefixes
//     are dropped; a header the export truncated ("Direct Over...") is mapped
//     only when it is the prefix of exactly one known column; camelCase keys
//     (accounting.laborRateUsdPerHr) map to their export names.
//   * A file with no overhead-rate columns is seeded with its rates NULL
//     (never derived) and disclosed in the header.
//   * An operation naming a process absent from the process file, and a
//     machine file with no process, are disclosed in the header, not guessed.
//   * 'User-Defined Process' (UI placeholder) and 'No Cost Feature' (not a
//     process) are skipped, as in 851.
//
// Run: node backend/migrations/scripts/gen_862_seed_remaining_memory_domains.js

const fs = require('fs');
const path = require('path');
const { readCsv, sqlStr, buildMachineRows, insertSql, readMachineTable } = require('./lib/memory-machine-seed');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const MEMORY = path.join(ROOT, 'memory');
const OUT_DIR = path.join(__dirname, '..');
const BASE_NAME = '862_seed_remaining_memory_domains';

const DOMAINS = [
  {
    key: 'casting_investment', group: 'Casting Investment', dir: 'Casting Investment',
    processes: 'Processes/processes.csv', operations: 'Processes/operations.csv',
    wage: 'wage_grade_associations.csv', machines: 'Machine',
    alias: {
      'flash_fire_dewaxing_machines.csv': 'Flash Fire De-Waxing',
      'steam_autoclave_dewaxing_machines.csv': 'Steam Autoclave De-Waxing',
    },
    india: 'Indian data/investment_casting_machine_rates_FINAL.csv',
    // "Pacific Kiln PBF-60 (Burnout group)": the suffix the India transcription
    // itself carries, naming which process's machine list the row came from.
    indiaGroup: { 'Flash Fire': 'Flash Fire De-Waxing', Burnout: 'Mold Burnout', Preheat: 'Mold Preheating' },
  },
  {
    key: 'assembly_molding', group: 'Assembly Molding', dir: 'Assembly molding',
    processes: 'Processes/processes.csv', operations: 'Processes/operations.csv',
    wage: 'wage_grade_associations.csv', machines: 'Machines',
  },
  {
    key: 'assembly_plastic_molding', group: 'Assembly Plastic Molding', dir: 'Assembly plastic molding',
    processes: 'Processes/processes.csv', operations: 'Processes/operations.csv',
    wage: 'wage_grade_associations.csv', machines: 'Machines',
    alias: { 'injection_molders.csv': 'Multi-Shot Molding' },
    // The same 78 multi-shot molders as injection_molders.csv, rates only.
    // injection_molders.csv carries the rates AND the press specs, so it is the
    // seeded file; this one is disclosed, with every cell where the two differ.
    duplicateOf: { 'machines_multishot_accounting.csv': 'injection_molders.csv' },
  },
  {
    key: 'bar_tube_fab', group: 'Bar and Tube Fabrication', dir: 'Bar and tube fab',
    processes: 'Processes/processes_default_machines.csv', operations: 'Processes/operations.csv',
    wage: 'wage_grade_associations.csv', machines: 'Machines',
    alias: { 'machines_bar_punching.csv': 'Punching' },
  },
  {
    key: 'powder_metal', group: 'Powder Metal', dir: 'Powder metal',
    processes: 'Processes/processes_default_machines.csv', operations: 'Processes/operations.csv',
    wage: 'wage_grade_associations.csv', machines: 'Machines',
  },
  {
    key: 'rapid_prototyping', group: 'Rapid Prototyping', dir: 'Rapid prototyping',
    processes: 'Processes/processes_default_machines.csv', operations: 'Processes/operations.csv',
    wage: 'wage_grade_associations.csv', machines: 'Machines',
    alias: { 'machine_default_cleaning.csv': 'Cleaning' },
  },
  {
    key: 'roto_blow_molding', group: 'Roto & Blow Molding', dir: 'Roto & blow molding',
    processes: 'Processes/processes.csv', operations: 'Processes/operations.csv', operationColumn: 'Process Name (Full Path)',
    wage: 'roto_blow_molding_wage_grade_associations.csv', machines: 'Machines', categoryColumn: 'Process',
  },
  {
    key: 'sheet_roll_forming', group: 'Sheet Metal Roll Forming', dir: 'Sheet metal roll forming',
    processes: 'Processes/roll_forming_processes.csv', operations: 'Processes/roll_forming_operations.csv',
    wage: 'roll_forming_wage_grades.csv', machines: 'Machines',
  },
  {
    key: 'sheet_stretch_forming', group: 'Sheet Metal Stretch Forming', dir: 'Sheet metal stretch forming',
    processes: 'Processes/processes.csv', operations: 'Processes/operations.csv',
    wage: 'wage_grade_associations.csv', machines: 'Machines',
  },
  {
    key: 'sheet_transfer_die', group: 'Sheet Metal Transfer Die', dir: 'Sheet metal transfer die',
    processes: 'Processes/processes_default_machines.csv', operations: 'Processes/operations.csv',
    wage: 'wage_grade_associations.csv', machines: 'Machines',
    alias: {
      'machines_OfflineBlanking_TransferDie.csv': 'Offline Blanking',
      'machines_TransferDie.csv': 'Transfer Die',
      'machine_DefaultMaterialStock.csv': 'Material Stock',
    },
  },
  {
    key: 'sheet_plastic', group: 'Sheet Plastic', dir: 'Sheet Plastic',
    processes: 'Processes/processes.csv', operations: 'Processes/operations.csv',
    wage: 'wage_grade_associations.csv', machines: 'Machines', categoryColumn: 'Process',
  },
  {
    // No process file: the one process is named by the operations themselves.
    key: 'two_mold_molding', group: '2 Mold Molding', dir: '2 Mold Molding',
    processes: null, operations: 'operations (1).csv',
    wage: 'wage_grade_associations (2).csv', machines: null,
  },
  {
    key: 'multi_spindle', group: 'Multi-Spindle Machining', dir: 'Multi-Spindle Maching',
    processes: 'Procesess/multi_spindle_processes.csv', processColumn: 'processName',
    operations: 'Procesess/multi_spindle_operations.csv', operationColumn: 'processName',
    wage: 'wage_grade_associations.csv', machines: 'Machine',
    alias: { 'material_stock_digital_factory.csv': 'Material Stock' },
  },
];

const SKIP_PROCESS = new Set(['User-Defined Process', 'No Cost Feature']);
// Stock-issue processes: real rows with a default machine, but no
// manufacturing operation (790's NON_MFG rule).
const NON_MFG_RE = /(^|\s)(material|sheet|coil) stock$|^source component$/i;
const FIRST_ORDER = 3000;
const ORDER_STEP = 100;

const normalize = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

// "Process:Category//Feature[:Category//Feature...]": the leaf pair typed,
// the full string verbatim (gen_609 / gen_790 split).
function parseCompound(raw) {
  const segments = raw.split(':');
  const levels = segments.slice(1).map((seg) => {
    const i = seg.indexOf('//');
    return i === -1 ? { operation: seg, feature: null } : { operation: seg.slice(0, i), feature: seg.slice(i + 2) };
  });
  const leaf = levels[levels.length - 1] || { operation: null, feature: null };
  return { process: segments[0], operationCategory: leaf.operation, featureType: leaf.feature };
}

function levenshtein(a, b) {
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

// ── Per domain ──────────────────────────────────────────────────────────────
const q = (s) => (s == null || String(s).trim() === '' ? 'NULL' : sqlStr(s));
const results = [];

DOMAINS.forEach((dom, domIndex) => {
  const src = (rel) => path.join(MEMORY, dom.dir, rel);
  const classOf = (proc) => `${dom.key}_${normalize(proc)}`;
  const disclosures = [];

  // Operations first: a domain with no process file takes its processes from them.
  const opsTable = readCsv(src(dom.operations));
  const opCol = dom.operationColumn ?? 'Process Name';
  if (!opsTable.columns.includes(opCol)) throw new Error(`${dom.dir}/${dom.operations}: no "${opCol}" column`);
  const operations = opsTable.rows
    .map((r) => (r[opCol] == null ? null : String(r[opCol]).trim()))
    .filter(Boolean)
    .map((raw) => ({ raw, ...parseCompound(raw) }));

  // Processes.
  let processRows;
  if (dom.processes) {
    const t = readCsv(src(dom.processes));
    const pc = dom.processColumn ?? 'Process Name';
    if (!t.columns.includes(pc)) throw new Error(`${dom.dir}/${dom.processes}: no "${pc}" column`);
    const machineCol = t.columns.find((c) => /^default ?machine$/i.test(c.replace(/\s+/g, ' ').trim()) || c === 'defaultMachine');
    const toolCol = t.columns.find((c) => /^default ?tool ?shop ?name$/i.test(c.replace(/\s+/g, ' ').trim()) || c === 'defaultToolShopName');
    processRows = t.rows.map((r) => ({
      name: String(r[pc]).trim(),
      machine: machineCol ? r[machineCol] : null,
      tool: toolCol ? r[toolCol] : null,
    }));
  } else {
    processRows = [...new Set(operations.map((o) => o.process))].map((name) => ({ name, machine: null, tool: null }));
  }
  const seen = new Set();
  const processes = [];
  for (const p of processRows) {
    if (!p.name || SKIP_PROCESS.has(p.name)) continue;
    if (seen.has(p.name)) throw new Error(`${dom.dir}: duplicate process ${p.name}`);
    seen.add(p.name);
    processes.push({ ...p, order: FIRST_ORDER + domIndex * ORDER_STEP + processes.length, roadmap: NON_MFG_RE.test(p.name) ? 'non_mfg' : 'not_modeled' });
  }
  const processNames = new Set(processes.map((p) => p.name));

  const seenOps = new Set();
  const keptOps = [];
  const orphanOps = new Map();
  for (const o of operations) {
    if (SKIP_PROCESS.has(o.process)) continue;
    if (!processNames.has(o.process)) { orphanOps.set(o.process, (orphanOps.get(o.process) ?? 0) + 1); continue; }
    if (seenOps.has(o.raw)) continue; // exact duplicate line in the export
    seenOps.add(o.raw);
    keptOps.push(o);
  }
  if (orphanOps.size) {
    disclosures.push(`operations naming no process in the process file (staged source only, not seeded): ${[...orphanOps].map(([p, n]) => `${p} (${n})`).join(', ')}`);
  }

  // Wage grades.
  const wageTable = dom.wage ? readCsv(src(dom.wage)) : { columns: [], rows: [] };
  const wpc = wageTable.columns.find((c) => /^process ?name$/i.test(c));
  const wgc = wageTable.columns.find((c) => /^wage ?grade ?name$/i.test(c));
  const gradeOf = (proc) => (wpc && wgc ? wageTable.rows.find((w) => String(w[wpc]).trim() === proc)?.[wgc] ?? null : null);

  // Machines.
  const files = [];
  if (dom.machines) {
    const dir = src(dom.machines);
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.csv')).sort()) {
      if (dom.duplicateOf?.[file]) {
        const a = readMachineTable(path.join(dir, file));
        const b = readMachineTable(path.join(dir, dom.duplicateOf[file]));
        const diffs = [];
        for (const r of a.rows) {
          const twin = b.rows.find((x) => x.Name === r.Name);
          if (!twin) { diffs.push(`"${r.Name}" not in ${dom.duplicateOf[file]}`); continue; }
          for (const c of a.columns) if (String(r[c] ?? '') !== String(twin[c] ?? '')) diffs.push(`${r.Name}: ${c} ${r[c]} vs ${twin[c]}`);
        }
        disclosures.push(`${file}: the same machines as ${dom.duplicateOf[file]} (rates only), not seeded twice. Cells that differ: ${diffs.join('; ') || 'none'}`);
        continue;
      }
      const table = readMachineTable(path.join(dir, file));
      const bare = file.replace(/\.csv$/, '').replace(/^machines?_/i, '').replace(/_machines?$/i, '');
      let proc = dom.alias?.[file] ?? processes.find((p) => normalize(p.name) === normalize(bare))?.name;
      if (dom.categoryColumn && table.columns.includes(dom.categoryColumn)) {
        const vals = [...new Set(table.rows.map((r) => String(r[dom.categoryColumn] ?? '').trim()))];
        if (vals.length === 1 && processNames.has(vals[0])) proc = vals[0];
        else if (vals.length === 1) proc = processes.find((p) => normalize(p.name) === normalize(vals[0]))?.name ?? proc;
      }
      if (!proc || !processNames.has(proc)) {
        disclosures.push(`machine file with no process in the process file (not seeded): ${file}`);
        continue;
      }
      if (!table.columns.includes('Name')) throw new Error(`${dom.dir}/${file}: no machine name column (${table.columns.slice(0, 4).join('|')})`);
      if (table.renames.length) disclosures.push(`${file} headers normalised: ${table.renames.join('; ')}`);
      // Drop the category column so it does not land in specs; the process is
      // the HR Rates category.
      const cols = table.columns.filter((c) => c !== dom.categoryColumn);
      const rows = table.rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
      const hasOh = cols.includes('Direct Overhead Rate (USD / hr)') && cols.includes('Indirect Overhead Rate (USD / hr)');
      // A rated file must be rated on every row; a row with a blank rate in a
      // rated file is a source gap and is disclosed, never zero-filled.
      const unrated = hasOh ? rows.filter((r) => typeof r['Direct Overhead Rate (USD / hr)'] !== 'number' || typeof r['Indirect Overhead Rate (USD / hr)'] !== 'number').map((r) => r.Name) : [];
      if (unrated.length) disclosures.push(`${file}: no overhead rate in the source for ${unrated.join(', ')} (MHR NULL)`);
      files.push({
        table: { columns: cols, rows },
        rel: `${dom.dir}/${dom.machines}/${file}`,
        category: proc,
        machineClass: classOf(proc),
        grade: gradeOf(proc),
        envelope: [null, null, null, null],
        ratesAbsentInSource: !hasOh || unrated.length > 0,
        fileHasNoRates: !hasOh,
      });
    }
  }
  const { columns, rows, report } = buildMachineRows(files, dom.group);
  const machined = new Set(files.map((f) => f.category));
  const noMachine = dom.machines ? processes.map((p) => p.name).filter((n) => !machined.has(n)) : [];

  // India twins: an India row is the USA machine of the same name at India
  // rates (845/848 rule). Matching, in order, each step only when the previous
  // found nothing:
  //   1. same name, ignoring case;
  //   2. the USA name the India name is a truncated prefix of;
  //   3. the USA name within edit distance 2 (screenshot transcription).
  // A "(Burnout group)"-style suffix names the process itself (dom.indiaGroup),
  // never inferred. A name found in several USA processes is one machine only
  // when every one of those USA rows carries the same rates; it is then the
  // twin in each. Anything else (two India rows for one USA name, differing
  // USA rates, no USA name at all) is disclosed and not inserted. The file's
  // own "Process Category (inferred)" column is a transcriber's guess and is
  // not used.
  let india = null;
  if (dom.india) {
    // Inch marks ('36"') are literal, unescaped quotes; no field has a comma,
    // so the file is split on commas rather than CSV-parsed.
    const lines = fs.readFileSync(src(dom.india), 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
    const h = lines[0].split(',').map((x) => x.trim());
    const ix = (name) => { const i = h.indexOf(name); if (i < 0) throw new Error(`${dom.india}: no ${name}`); return i; };
    const [iN, iL, iD, iI] = ['Machine Name', 'Labor Rate (USD/hr)', 'Direct Overhead (USD/hr)', 'Indirect Overhead (USD/hr)'].map(ix);
    const indiaRows = lines.slice(1).map((l) => {
      const c = l.split(',');
      if (c.length !== h.length) throw new Error(`${dom.india}: ${c.length} fields in "${l}"`);
      return { name: c[iN].trim(), rates: [c[iL], c[iD], c[iI]].map(Number) };
    });
    const usa = files.flatMap((f) => f.table.rows.map((r) => ({
      name: String(r.Name), cls: f.machineClass, proc: f.category,
      rateKey: [r['Labor Rate (USD / hr)'], r['Direct Overhead Rate (USD / hr)'], r['Indirect Overhead Rate (USD / hr)']].join('|'),
    })));
    const lc = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const matchesOf = (r) => {
      let name = r.name, pool = usa;
      const g = /^(.*?)\s*\(([^)]*?) group\)$/i.exec(name);
      if (g && dom.indiaGroup?.[g[2]]) { name = g[1]; pool = usa.filter((u) => u.proc === dom.indiaGroup[g[2]]); }
      let hits = pool.filter((u) => lc(u.name) === lc(name)), how = null;
      if (!hits.length) { hits = pool.filter((u) => lc(u.name).startsWith(lc(name))); how = 'prefix'; }
      if (!hits.length) {
        // Only the closest names: "Olympic Kiln FL12E" is one edit from its
        // twin "Olympic Kilns FL12E" and two from the different FL27E.
        const dist = pool.map((u) => [u, levenshtein(lc(u.name), lc(name))]).filter(([, d]) => d <= 2);
        const best = Math.min(...dist.map(([, d]) => d));
        hits = dist.filter(([, d]) => d === best).map(([u]) => u);
        how = 'edit distance';
      }
      return { hits, how };
    };
    const matched = indiaRows.map((r) => ({ r, ...matchesOf(r) }));
    const twins = [], unmatched = [], aliases = [];
    for (const m of matched) {
      const { r, hits, how } = m;
      if (r.rates.some((v) => !Number.isFinite(v))) { unmatched.push(`${r.name} (non-numeric rate)`); continue; }
      if (!hits.length) { unmatched.push(`${r.name} (no USA machine of that name)`); continue; }
      const names = new Set(hits.map((u) => lc(u.name)));
      if (names.size > 1) { unmatched.push(`${r.name} (${names.size} different USA names: ${[...new Set(hits.map((u) => u.name))].join(' / ')})`); continue; }
      const rivals = matched.filter((o) => o !== m && o.hits.some((u) => hits.some((x) => x.cls === u.cls && lc(x.name) === lc(u.name))));
      if (rivals.length) { unmatched.push(`${r.name} (India rows ${[r.name, ...rivals.map((o) => o.r.name)].join(' / ')} name the same USA machine)`); continue; }
      if (new Set(hits.map((u) => u.rateKey)).size > 1) { unmatched.push(`${r.name} (in ${hits.map((u) => u.proc).join(', ')} at different USA rates)`); continue; }
      if (how) aliases.push(`${r.name} -> ${hits[0].name} (${how})`);
      for (const u of hits) twins.push({ cls: u.cls, usa: u.name, labor: r.rates[0], direct: r.rates[1], indirect: r.rates[2] });
    }
    india = { twins, unmatched, aliases, file: dom.india };
  }

  results.push({ dom, processes, keptOps, columns, rows, report, files, noMachine, disclosures, india });
});

// ── SQL ─────────────────────────────────────────────────────────────────────
const num = (v) => String(Math.round(v * 1e6) / 1e6);

function catalogSql(r) {
  const { dom, processes, keptOps, files } = r;
  const machined = new Set(files.map((f) => f.category));
  const cls = (p) => (machined.has(p) ? sqlStr(`${dom.key}_${normalize(p)}`) : 'NULL');
  const tax = processes.map((p) => `  (${sqlStr(dom.group)}, ${sqlStr(p.name)}, ${cls(p.name)}, '${p.roadmap}', ${q(p.machine)}, ${q(p.tool)}, ${p.order})`).join(',\n');
  const ops = keptOps.map((o) => `  (${sqlStr(o.process)}, ${q(o.operationCategory)}, ${q(o.featureType)}, ${sqlStr(o.raw)})`).join(',\n');
  const map = processes.map((p) => `  (${sqlStr(p.name)}, ${p.order}, ${cls(p.name)})`).join(',\n');
  return `-- ── ${dom.group} (memory/${dom.dir}) ──────────────────────────
INSERT INTO process_taxonomy (process_group, process_name, machine_class, roadmap_status, default_machine_name, default_tool_shop_name, display_order)
VALUES
${tax}
ON CONFLICT (process_group, process_name) DO UPDATE
SET machine_class = COALESCE(process_taxonomy.machine_class, EXCLUDED.machine_class),
    default_machine_name = COALESCE(process_taxonomy.default_machine_name, EXCLUDED.default_machine_name),
    default_tool_shop_name = COALESCE(process_taxonomy.default_tool_shop_name, EXCLUDED.default_tool_shop_name);
${keptOps.length ? `
INSERT INTO process_taxonomy_operations (canonical_process_id, operation_category, feature_type, raw_compound_string)
SELECT pt.id, v.operation_category, v.feature_type, v.raw
FROM process_taxonomy pt
JOIN (VALUES
${ops}
) AS v(proc, operation_category, feature_type, raw)
  ON pt.process_group = ${sqlStr(dom.group)} AND pt.process_name = v.proc
ON CONFLICT (canonical_process_id, raw_compound_string) DO NOTHING;
` : ''}
INSERT INTO process_calculator_mappings (process_group, process_route, operation, calculator_id, calculator_name, is_active, display_order, machine_class, canonical_process_id)
SELECT ${sqlStr(dom.group)}, v.name, v.name, NULL, NULL, false, v.display_order, v.machine_class, pt.id
FROM process_taxonomy pt
JOIN (VALUES
${map}
) AS v(name, display_order, machine_class)
  ON pt.process_group = ${sqlStr(dom.group)} AND pt.process_name = v.name
WHERE NOT EXISTS (
  SELECT 1 FROM process_calculator_mappings m WHERE m.process_group = ${sqlStr(dom.group)} AND m.operation = v.name
)
ON CONFLICT (process_group, process_route, operation) DO NOTHING;
`;
}

function indiaSql(r) {
  const { india } = r;
  if (!india || india.twins.length === 0) return '';
  const values = india.twins.map((t) => `      (${sqlStr(t.cls)}, ${sqlStr(t.usa)}, ${num(t.labor)}, ${num(t.direct)}, ${num(t.indirect)})`).join(',\n');
  return `-- ── ${r.dom.group}: India machines, the USA twin at India rates (as 845/848)
DO $india862$
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
${values}
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
  RAISE NOTICE '${r.dom.group} India rows inserted: %', n;
  IF cardinality(missing) > 0 THEN
    RAISE NOTICE 'No USA twin (run the USA machine parts first): %', array_to_string(missing, '; ');
  END IF;
END
$india862$;
`;
}

const summary = results.map((r) => {
  const lines = [
    `-- ${r.dom.group} (memory/${r.dom.dir}): ${r.processes.length} processes, ${r.keptOps.length} operations, ${r.rows.length} USA machines${r.india ? `, ${r.india.twins.length} India twins` : ''}`,
    ...r.report.map((x) => `--     ${path.basename(x.rel).padEnd(44)} -> ${x.category.padEnd(30)} ${String(x.n).padStart(3)}${x.fileHasNoRates ? '  (source has no overhead rates: MHR NULL)' : ''}`),
  ];
  const { noMachine } = r;
  if (noMachine.length) lines.push(`--     processes with no machine file: ${noMachine.join(', ')}`);
  for (const d of r.disclosures) lines.push(`--     ${d}`);
  if (r.india) {
    lines.push(`--     India (${r.india.file}): ${r.india.twins.length} twins`);
    if (r.india.aliases.length) lines.push(`--       transcription resolved: ${r.india.aliases.join('; ')}`);
    if (r.india.unmatched.length) lines.push(`--       not inserted (no single USA twin): ${r.india.unmatched.join('; ')}`);
  }
  return lines.join('\n');
}).join('\n--\n');

const header = (partLabel) => `-- ============================================================================
-- Migration 862 (${partLabel}): Process catalog + HR Rates for the remaining memory/ domains
-- ============================================================================
-- Generated by scripts/gen_862_seed_remaining_memory_domains.js -- do not
-- hand-edit, re-run the generator and diff instead.
--
-- No cost engine exists for any of these domains: catalog rows are
-- roadmap_status not_modeled (stock-issue rows non_mfg), mapping rows
-- INACTIVE, machine_class '<domain>_<process>'. Machines follow the row shape
-- of 845/848/851 (scripts/lib/memory-machine-seed.js): MHR = Direct OH +
-- Indirect OH, LHR = labour rate, every other source column in specs, HR Rates
-- category = benchmark_source_key prefix.
--
-- Run part 1 (catalog) and the USA machine parts before the India part (last).
-- Every statement is idempotent (ON CONFLICT / NOT EXISTS).
-- ============================================================================
`;

const parts = [];
parts.push({ label: 'catalog', body: `${results.map(catalogSql).join('\n')}\nNOTIFY pgrst, 'reload schema';\n`, withSummary: true });
const CHUNK = 60;
const machineChunks = [];
for (const r of results) {
  for (let i = 0; i < r.rows.length; i += CHUNK) {
    machineChunks.push(`-- ── ${r.dom.group}: machines ${i + 1}-${Math.min(i + CHUNK, r.rows.length)} of ${r.rows.length}\n${insertSql(r.columns, r.rows.slice(i, i + CHUNK))}\n`);
  }
}
// Pack machine chunks into parts of ~400 KB so each fits the SQL editor.
let cur = '';
for (const c of machineChunks) {
  if (cur && cur.length + c.length > 400000) { parts.push({ label: 'machines', body: `${cur}\nNOTIFY pgrst, 'reload schema';\n` }); cur = ''; }
  cur += `${c}\n`;
}
if (cur) parts.push({ label: 'machines', body: `${cur}\nNOTIFY pgrst, 'reload schema';\n` });
const indiaBody = results.map(indiaSql).filter(Boolean).join('\n');
if (indiaBody) parts.push({ label: 'India', body: `${indiaBody}\nNOTIFY pgrst, 'reload schema';\n` });

for (const old of fs.readdirSync(OUT_DIR).filter((n) => n.startsWith(`${BASE_NAME}_part`))) fs.unlinkSync(path.join(OUT_DIR, old));
parts.forEach((p, i) => {
  const label = `part ${i + 1} of ${parts.length}, ${p.label}`;
  const text = `${header(label)}${p.withSummary ? `--\n${summary}\n-- ============================================================================\n` : ''}\n${p.body}`;
  fs.writeFileSync(path.join(OUT_DIR, `${BASE_NAME}_part${i + 1}of${parts.length}.sql`), text, 'utf8');
});

console.log(`Wrote ${parts.length} part(s)`);
console.log(summary.replace(/^-- ?/gm, ''));
