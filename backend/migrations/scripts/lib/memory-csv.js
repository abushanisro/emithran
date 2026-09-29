// memory/ reference exports are CSV (commit 7fd2705 replaced the JSON files).
// The flattening was mechanical, and this reads it back:
//   - one CSV row per record of the file's record list
//   - nested objects -> dotted headers ("accounting.laborRateUsdPerHr")
//   - the file's top-level scalars (section, variableCount, ...) repeated on
//     every row
//   - a list inside a list (machineCategories[].machines[]) -> one row per
//     inner record, carrying the outer record's scalars (categoryName)
//   - a file with several lists -> one CSV per list, <name>__<list>.csv
//   - booleans written as True / False
// Cells are typed (numbers, booleans); a blank cell is absent. A column the
// source kept as text ("stringValue": "1200") is named in `strings` and stays
// text. The licensed vendor's name is rebranded to eMithran inside the text,
// the rule of migrations 639 / 650, so a value keeps its meaning.

const fs = require('fs');
const { parseCsv } = require('./memory-machine-seed');

const debrand = (t) => t.replace(/a\s*priori/gi, 'eMithran');

function typed(v, asString) {
  const t = debrand(String(v ?? '').trim());
  if (t === '') return null;
  if (asString) return t;
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ''));
  if (t === 'true' || t === 'True') return true;
  if (t === 'false' || t === 'False') return false;
  return t;
}

// CSV file -> nested records ("limits.maxDiameterMm" -> r.limits.maxDiameterMm).
function readRecords(file, { strings = [] } = {}) {
  const t = parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const columns = t[0].map((h) => h.trim());
  const asString = new Set(strings);
  return t.slice(1).map((r) => {
    if (r.length !== columns.length) throw new Error(`${file}: row has ${r.length} cells for ${columns.length} columns`);
    const m = {};
    columns.forEach((k, i) => {
      const v = typed(r[i], asString.has(k));
      if (v === null) return;
      const parts = k.split('.');
      let o = m;
      for (const p of parts.slice(0, -1)) o = o[p] ?? (o[p] = {});
      o[parts[parts.length - 1]] = v;
    });
    return m;
  });
}

// A single-list file back as its document: { ...scalars, [list]: records }.
// `scalars` are the repeated top-level columns, taken from the first row and
// removed from every record.
function readDoc(file, { list, scalars = [], strings = [] }) {
  const records = readRecords(file, { strings });
  const doc = {};
  for (const s of scalars) if (records[0]?.[s] !== undefined) doc[s] = records[0][s];
  doc[list] = records.map((r) => { const c = { ...r }; for (const s of scalars) delete c[s]; return c; });
  return doc;
}

// Rows of a list-inside-a-list file regrouped by the outer record's key:
// [{ ...outer columns, [listName]: inner records without them }].
function groupRecords(records, key, listName, outerColumns = [key]) {
  const groups = new Map();
  for (const r of records) {
    const k = r[key];
    if (!groups.has(k)) {
      const outer = {};
      for (const c of outerColumns) if (r[c] !== undefined) outer[c] = r[c];
      groups.set(k, { ...outer, [listName]: [] });
    }
    const inner = { ...r };
    for (const c of outerColumns) delete inner[c];
    groups.get(k)[listName].push(inner);
  }
  return [...groups.values()];
}

// The document-level fields of the per-category Machining machine files
// (memory/Machining/machine/*_usa.csv, *_work_center_data.csv), repeated on
// every row; everything else is the machine record.
const MACHINING_MACHINE_FILE_SCALARS = ['process_name', 'digital_factory', 'work_center', 'sector', 'data_note', 'source_note', 'data_discrepancy_flag'];

module.exports = { readRecords, readDoc, groupRecords, MACHINING_MACHINE_FILE_SCALARS };
