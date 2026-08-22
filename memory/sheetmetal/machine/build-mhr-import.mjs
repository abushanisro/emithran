#!/usr/bin/env node
// Deterministic, regenerable conversion of machine_library.csv (281 real USA
// sheet-metal machines across 15 categories, flattened into one wide table —
// 120 columns, most blank per row since they're category-specific) into an
// .xlsx workbook shaped exactly as backend/src/modules/mhr/mhr.service.ts's
// importFromExcel() expects — so the user can seed real MHR/LHR data via the
// app's own existing "Import Excel" button (/hr-rates), reusing the real,
// tested MHR calculation engine instead of a hand-duplicated rate formula in
// a SQL migration.
//
// CSV, not machine_library.json, is the source of truth here: same
// underlying 281 machines, but the CSV already flattens every category's
// fields into one row shape, so one data-driven common/specific split
// (below) covers all of them without per-category extraction logic.
//
// Re-run any time machine_library.csv changes:
//   node build-mhr-import.mjs [path/to/existing-usa-machines.json]
//
// The optional argument is a JSON array of machine names already present in
// mhr_records for USA (case-insensitive exact match) — rows matching one are
// skipped so re-running the real importer's own (machine_name, location,
// machine_class) dedup isn't the only thing standing between this and
// duplicate rows. Without it, no dedup is applied here and the summary says
// so explicitly (the importer's own dedup still applies at import time).
//
// Everything under generated/ is generated output — do not hand-edit it.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
// exceljs lives in backend/node_modules (this directory has no package.json
// / node_modules of its own) — referenced by relative path, not a bare
// import, since Node's module resolution never walks into a sibling
// directory tree. Confirmed reachable: backend/node_modules/exceljs, main
// entry ./excel.js (package.json), version 4.4.0.
import ExcelJS from '../../../backend/node_modules/exceljs/excel.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_FILE = path.join(DIR, 'machine_library.csv');
const OUT_DIR = path.join(DIR, 'generated');

// Real MachineClass strings from backend/src/modules/bom-items/costing/
// default-rates.ts's MACHINE_REGISTRY — confirmed exact (not guessed) by
// reading that file. Every other machine_library.csv category has no real
// cost/selection engine behind it today (confirmed against
// manufacturing-process-registry.ts's MANUFACTURING_PROCESS_REGISTRY) — left
// `null` deliberately, visible in the admin UI, inert for costing until real
// engine work happens. Not fabricating engine coverage that doesn't exist.
const CATEGORY_TO_MACHINE_CLASS = {
  'Bend Press Brake': 'press_brake',
  'Fiber Laser Cutting Machine': 'fiber_laser',
  'Laser Cutting Machine': 'co2_laser',
  'Waterjet Cutting Machine': 'waterjet',
  'Turret Press (Punch Press)': 'turret_punch',
  'Deslag Machine': 'deburring',
  // Explicitly unmapped (no real engine) — listed so a category typo above
  // fails loudly instead of silently falling through to "unmapped":
  '2-Axis Router': null,
  '3 Roll Bender': null,
  '3D Laser Cutting Machine': null,
  '4 Roll Bender': null,
  'Cut To Length Line (CTL)': null,
  'Laser Punch / Punch Press': null,
  'Oxyfuel Cutting Machine': null,
  'Progressive Die Press': null,
  'Tandem Press': null,
};

function machineClassFor(category) {
  if (!(category in CATEGORY_TO_MACHINE_CLASS)) {
    throw new Error(
      `Unknown machine_category "${category}" — not in CATEGORY_TO_MACHINE_CLASS. ` +
      `Add it (with a real machine_class or null) before regenerating.`,
    );
  }
  return CATEGORY_TO_MACHINE_CLASS[category];
}

function loadExistingNames(argPath) {
  if (!argPath) return null;
  const resolved = path.isAbsolute(argPath) ? argPath : path.join(process.cwd(), argPath);
  if (!existsSync(resolved)) {
    console.warn(`Dedup file "${resolved}" not found — proceeding WITHOUT dedup.`);
    return null;
  }
  const raw = JSON.parse(readFileSync(resolved, 'utf8'));
  const names = Array.isArray(raw) ? raw : (raw.names ?? []);
  return new Set(names.map((n) => String(n).toLowerCase().trim()));
}

// Minimal RFC4180-ish CSV parser (quoted fields, escaped "" inside quotes,
// \r\n or \n line endings) — no external dependency needed for a 281-row file.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c === '\r') {
      // skip — paired \n handles the row break
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// A raw CSV cell is '' for both "genuinely blank" and "the string zero" —
// coerce to a real JS value once here (number when it parses as one, `undefined`
// when blank) so every downstream `?? ''` / `!= null` check the rest of this
// script already relies on behaves exactly as it did against the JSON source's
// real `undefined`-for-missing-key semantics. Never fabricates a value: a
// blank cell stays blank (undefined), never defaults to 0.
function coerceCell(raw) {
  if (raw === '' || raw === undefined) return undefined;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw === 'TRUE') return true;
  if (raw === 'FALSE') return false;
  return raw;
}

// The CSV's `data_source` column carries the licensed third-party reference
// vendor's own product name verbatim ("aPriori Baseline") in 87 of 281 rows —
// machine_library.json's own export already sanitized this exact field to
// neutral wording ("the system Baseline"); reused verbatim here for
// consistency rather than inventing new phrasing. Per standing project
// convention: never let a licensed vendor name reach code, comments,
// migrations, or DB values.
function sanitizeVendorName(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/apriori baseline/gi, 'the system Baseline').replace(/apriori/gi, 'the system');
}

function loadMachinesFromCsv() {
  const raw = readFileSync(SOURCE_FILE, 'utf8');
  const rows = parseCsv(raw);
  const headers = rows[0];
  const dataRows = rows.slice(1).filter((r) => r.length > 1 && r.some((c) => c !== ''));

  // Fully-blank columns (no row has a value) are dead weight — dropped
  // entirely rather than carried through as always-empty specs keys.
  const blankColumns = headers.filter((_, i) => dataRows.every((r) => (r[i] ?? '').trim() === ''));

  const machines = dataRows.map((r) => {
    const obj = {};
    headers.forEach((h, i) => {
      if (blankColumns.includes(h)) return;
      const value = coerceCell(r[i]);
      if (value === undefined) return;
      obj[h] = h === 'data_source' || h === 'note' || h === 'category_data_note'
        ? sanitizeVendorName(value)
        : value;
    });
    return obj;
  });

  // Group by category to keep the rest of this script's shape (iterate
  // category -> machines) unchanged from the JSON-sourced version.
  const byCategory = new Map();
  for (const m of machines) {
    const cat = m.machine_category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(m);
  }

  return { blankColumns, categories: [...byCategory.entries()].map(([machine_category, ms]) => ({ machine_category, machines: ms })) };
}

// Every one of the 15 categories carries these fields consistently (verified
// by enumerating field sets across all 281 machines, not assumed) — a single
// uniform mapping covers all of them. Category-specific fields (bed_length_mm,
// press_force_kn, max_thickness_steel_mm, etc.) are NOT mapped here — they
// ride through as Specs JSON below.
const ECONOMICS_FIELDS = [
  'direct_overhead_rate_usd_hr',
  'indirect_overhead_rate_usd_hr',
  'labor_rate_usd_hr',
  'machine_price_usd',
  'machine_power_kw',
  'avg_utilization',
  'number_of_operators',
  'setup_time_hr',
  'machine_manufacturer_location',
  'annual_maintenance_factor_pct',
  'installation_factor_pct',
];

// Column headers chosen to match importFromExcel()'s real getCol(...) alias
// lists exactly (verified by reading mhr.service.ts, not guessed) — 'Direct
// Overhead Rate' + 'Indirect Overhead Rate' together trigger the importer's
// "Combined format" path (isCombinedFormat), which is specifically designed
// for USD-denominated per-machine benchmark data with a direct/indirect
// overhead split: forces manual-entry MHR = direct+indirect (no separate
// "Total OH" column provided here, so the importer sums the breakdown), and
// FX-converts USD -> the row's location currency live (identity conversion
// for USA, since location=USD=USD here — no distortion risk).
const HEADERS = [
  'Machine Name', 'Location', 'Manufacturer Country', 'Process Group', 'Machine Class',
  'Direct Overhead Rate', 'Indirect Overhead Rate',
  'Labor Rate USD Hr', 'LHR Total USD Hr',
  'Setup Time Hr', 'Operators', 'Avg Utilization',
  'Machine Price USD', 'Power Kwh Per Hour',
  'Maintenance Cost', 'Installation Cost',
  'Bed Length Mm', 'Bed Width Mm', 'Bed Height Mm',
  'Max Thickness MS Mm', 'Max Thickness SS Mm', 'Max Thickness Al Mm', 'Max Thickness Cu Mm',
  'Specs JSON',
];

// Category-specific fields (press_force_kn, roll_working_length_mm,
// bed_length_mm, etc.) ride through as one JSON blob per row via the
// importer's generic "Specs JSON" column (mhr.service.ts importFromExcel())
// instead of a one-off SQL backfill — this is the durable, re-importable
// path: any future re-run of this script against an updated
// machine_library.csv carries new/changed category-specific data straight
// through the app's own Import Excel button. "Common vs category-specific"
// is computed data-driven (frequency across all 281 machines), not guessed —
// a field present on nearly every machine regardless of category is either
// already an ECONOMICS_FIELDS column, a physical dimension with its own
// dedicated mhr_records column (bed/thickness fields, promoted to real
// columns above instead of Specs JSON), or bookkeeping metadata; anything
// narrower is a real capability field that belongs in specs. No value is
// ever fabricated: a machine only gets the keys it actually has in the
// source file, and a fully-blank column (wage_grade_name, in this export)
// never appears anywhere in the output.
const PROMOTED_TO_DEDICATED_COLUMNS = new Set([
  'bed_length_mm', 'bed_width_mm', 'bed_height_mm',
  'max_thickness_steel_mm', 'max_thickness_stainless_steel_mm',
  'max_thickness_aluminum_mm', 'max_thickness_copper_mm',
]);
const KNOWN_COMMON_FIELDS = new Set([
  'machine_category', 'category_data_note', 'name', 'description', 'data_source', 'note',
  ...ECONOMICS_FIELDS, ...PROMOTED_TO_DEDICATED_COLUMNS,
  'overhead_multiplier', 'labor_time_standard', 'wage_grade_name',
  'work_center_labor_rate_factor', 'shuttle_time_s', 'number_of_heads',
  'is_preferred', 'good_part_yield', 'machine_life_yr', 'machine_uptime_pct',
  'supplies_cost_usd_yr', 'salvage_value_factor_pct', 'footprint_allowance_factor',
  'machine_length_mm', 'machine_width_mm',
]);
const COMMON_FREQUENCY_THRESHOLD = 0.9;

function computeCommonFields(allMachines) {
  const fieldCounts = new Map();
  for (const m of allMachines) {
    for (const key of Object.keys(m)) fieldCounts.set(key, (fieldCounts.get(key) ?? 0) + 1);
  }
  const commonFields = new Set(KNOWN_COMMON_FIELDS);
  for (const [key, count] of fieldCounts) {
    if (count / allMachines.length >= COMMON_FREQUENCY_THRESHOLD) commonFields.add(key);
  }
  return commonFields;
}

function specsFor(machine, commonFields) {
  const specs = {};
  for (const [key, value] of Object.entries(machine)) {
    if (commonFields.has(key)) continue;
    if (value === null || value === undefined) continue;
    specs[key] = value;
  }
  return specs;
}

// 12 machine names in this export are shared by two different real machines
// filed under two different categories (e.g. "Default Press" exists under
// both Progressive Die Press and Tandem Press — a real, pre-existing
// duplicate in the source data, not something this script introduces).
// Since both would otherwise get machine_class=null (neither category maps
// to a real engine) and the same location, the app's own (machine_name,
// location, machine_class) import dedup would treat the second as a repeat
// of the first and silently drop a real machine. Disambiguating by
// appending the category preserves both as distinct rows without
// fabricating any data.
function disambiguatedName(name, category, duplicateNames) {
  return duplicateNames.has(name.toLowerCase().trim()) ? `${name} (${category})` : name;
}

function buildRow(machine, category, commonFields, duplicateNames) {
  const machineClass = machineClassFor(category);
  const specs = specsFor(machine, commonFields);
  return [
    disambiguatedName(machine.name, category, duplicateNames),
    'USA',
    machine.machine_manufacturer_location ?? '',
    'Sheet Metal', // descriptive grouping only — every machine_library category is genuinely sheet-metal-domain; not a capability/engine trigger
    machineClass ?? '',
    machine.direct_overhead_rate_usd_hr ?? '',
    machine.indirect_overhead_rate_usd_hr ?? '',
    machine.labor_rate_usd_hr ?? '',
    machine.labor_rate_usd_hr ?? '', // same real value, also populates usd_lhr_total (economics-resolver.ts's labor tier) — not a second fabricated number
    machine.setup_time_hr ?? '',
    machine.number_of_operators ?? '',
    machine.avg_utilization ?? '', // 0-1 fraction; importer auto-detects and multiplies by 100
    machine.machine_price_usd ?? '',
    machine.machine_power_kw ?? '', // nameplate rating used as the closest real analog to "power per operating hour" — same convention already used this session (e.g. migration 511)
    machine.annual_maintenance_factor_pct ?? '',
    machine.installation_factor_pct ?? '',
    machine.bed_length_mm ?? '',
    machine.bed_width_mm ?? '',
    machine.bed_height_mm ?? '',
    machine.max_thickness_steel_mm ?? '',
    machine.max_thickness_stainless_steel_mm ?? '',
    machine.max_thickness_aluminum_mm ?? '',
    machine.max_thickness_copper_mm ?? '',
    Object.keys(specs).length ? JSON.stringify(specs) : '',
  ];
}

async function main() {
  const dedupArg = process.argv[2];
  const existingNames = loadExistingNames(dedupArg);

  const { blankColumns, categories } = loadMachinesFromCsv();
  const allMachines = categories.flatMap((c) => (c.machines ?? []).filter((m) => m.name));
  const commonFields = computeCommonFields(allMachines);

  const nameCounts = new Map();
  for (const m of allMachines) {
    const key = String(m.name).toLowerCase().trim();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const duplicateNames = new Set([...nameCounts.entries()].filter(([, c]) => c > 1).map(([n]) => n));

  mkdirSync(OUT_DIR, { recursive: true });

  let totalMachines = 0;
  let mappedToRealClass = 0;
  let skippedAsExisting = 0;
  let missingCoreField = 0;
  let rowsWithSpecs = 0;
  const perCategoryCounts = {};
  const rows = [];

  for (const cat of categories) {
    const category = cat.machine_category;
    const machineClass = machineClassFor(category); // throws loudly on an unknown category
    let catCount = 0;

    for (const machine of cat.machines ?? []) {
      totalMachines++;
      catCount++;

      if (!machine.name) {
        console.warn(`Skipping a "${category}" row with no name.`);
        continue;
      }
      if (existingNames && existingNames.has(String(machine.name).toLowerCase().trim())) {
        skippedAsExisting++;
        continue;
      }
      // Not fabricating: a machine missing BOTH overhead fields would import
      // as an effectively-zero-rate row (Combined format sums whatever is
      // present, defaulting missing cells to 0 via the importer's own toNum
      // fallback) — flagged here for visibility, not silently dropped or guessed.
      if (machine.direct_overhead_rate_usd_hr == null && machine.indirect_overhead_rate_usd_hr == null) {
        missingCoreField++;
        console.warn(`"${machine.name}" (${category}) has no direct/indirect overhead rate at all — will import at $0/hr MHR unless you add data.`);
      }

      if (machineClass) mappedToRealClass++;
      if (Object.keys(specsFor(machine, commonFields)).length) rowsWithSpecs++;
      rows.push(buildRow(machine, category, commonFields, duplicateNames));
    }
    perCategoryCounts[category] = { count: catCount, machineClass: machineClass ?? '(none — no real engine)' };
  }

  // Size check: an Excel upload has no meaningful row-count ceiling comparable
  // to the SQL-editor character limits hit elsewhere this session (that was a
  // paste-buffer constraint specific to the Supabase SQL Editor, not a real
  // constraint of this upload path) — 281 rows in one sheet is trivial for
  // ExcelJS/the app's own import endpoint. One file is sufficient; splitting
  // is not needed and would just add unnecessary re-assembly steps for the user.
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('MHR'); // exact name match -> importer's `namedSheet` branch, unambiguous
  sheet.addRow(HEADERS);
  for (const row of rows) sheet.addRow(row);

  const outFile = path.join(OUT_DIR, 'usa_machine_library_mhr_import.xlsx');
  await workbook.xlsx.writeFile(outFile);

  console.log('');
  console.log('=== build-mhr-import.mjs summary ===');
  console.log(`Source: ${SOURCE_FILE}`);
  console.log(`Total machines in machine_library.csv: ${totalMachines}`);
  console.log(`Rows written to workbook: ${rows.length}`);
  console.log(`Mapped to a real machine_class (costing-active): ${mappedToRealClass}`);
  console.log(`Left machine_class blank (no real engine yet): ${totalMachines - mappedToRealClass - skippedAsExisting}`);
  console.log(`Skipped as already-existing: ${skippedAsExisting}${existingNames ? '' : '  (NO DEDUP FILE PROVIDED — this is always 0; rely on the importer\'s own (machine_name, location, machine_class) dedup at import time)'}`);
  console.log(`Rows with no direct/indirect overhead rate at all (would import at $0/hr): ${missingCoreField}`);
  console.log(`Rows carrying category-specific Specs JSON (press force, roll diameter, etc. — bed/thickness dims are now dedicated columns): ${rowsWithSpecs}`);
  console.log(`Fully-blank columns dropped from the source (present in header, empty in all ${totalMachines} rows): ${blankColumns.join(', ') || '(none)'}`);
  console.log(`Duplicate machine names disambiguated by category (real machines sharing a name across categories): ${duplicateNames.size}`);
  if (duplicateNames.size) console.log(`  ${[...duplicateNames].join(', ')}`);
  console.log('');
  console.log('Per-category breakdown:');
  for (const [cat, info] of Object.entries(perCategoryCounts)) {
    console.log(`  ${cat}: ${info.count} machines -> machine_class=${info.machineClass}`);
  }
  console.log('');
  console.log(`Output: ${outFile}`);
  console.log('Upload this file via the "Import Excel" button on /hr-rates (or POST /api/mhr/import-excel directly).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
