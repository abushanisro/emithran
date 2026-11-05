// The checks of the plastics data audit (scripts/plastic-data-audit.ts): pure functions over the staged CSV files in memory/ and over the backend's own
// source text, so each finding is reproducible and a rule can be tested on a small synthetic file. memory/ is a licensed dataset kept out of git: a
// finding names the row and the field, and carries the values only where a caller asks for the detail.

export type Row = Record<string, string>;

/** RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes; a leading BOM is dropped. The first record is the header. */
export function parseCsv(text: string): Row[] {
  const src = text.replace(/^﻿/, '');
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { record.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      record.push(field); field = '';
      if (record.some((f) => f !== '')) records.push(record);
      record = [];
    } else field += c;
  }
  record.push(field);
  if (record.some((f) => f !== '')) records.push(record);
  const [header, ...body] = records;
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const num = (v: string | undefined): number | null => {
  if (v == null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ── 1. The same material in the two staged files ────────────────────────────────────────────────────────────────────────────────────────────────

/** [field, column in materials_final.csv, column in raw_materials_full.csv] */
export const MATERIAL_FIELDS: ReadonlyArray<readonly [string, string, string]> = [
  ['price (USD/kg)', 'cost.unitCostUsdPerKg', 'Unit Cost (USD / kg)'],
  ['melt temperature', 'thermalProperties.meltingTempC', 'Melting Temp (C)'],
  ['mold temperature', 'thermalProperties.moldTempC', 'Mold Temp (C)'],
  ['eject deflection temperature', 'thermalProperties.ejectDeflectionTempC', 'Eject Deflection Temp (C)'],
  ['density', 'physicalProperties.densityKgM3', 'Density (kg/m^3)'],
  ['melt density', 'physicalProperties.densityOfMeltKgM3', 'Density of Melt (kg/m^3)'],
  ['specific heat of melt', 'physicalProperties.specificHeatOfMeltJgC', 'Specific Heat (J/g*C)'],
  ['injection pressure max', 'processingParameters.injectionPressureMaxMPa', 'Injection Pressure Max (MPa)'],
  ['flow length ratio', 'processingParameters.flowLengthRatio', 'Flow Length Ratio'],
];

export interface MaterialDifference { material: string; field: string; a: number | null; b: number | null }

const key = (s: string | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** The materials present in both files whose value for a field differs by more than `tolerance` (relative), and the names found in only one. */
export function compareMaterialFiles(finalRows: Row[], fullRows: Row[], tolerance = 0.005) {
  const full = new Map(fullRows.map((r) => [key(r['Source Name'] || r['Name']), r]));
  const seen = new Set<string>();
  const differences: MaterialDifference[] = [];
  const onlyInFinal: string[] = [];
  for (const a of finalRows) {
    const name = a['sourceName'] || a['name'] || '';
    const b = full.get(key(name));
    if (!b) { onlyInFinal.push(name); continue; }
    seen.add(key(name));
    for (const [field, colA, colB] of MATERIAL_FIELDS) {
      const x = num(a[colA]);
      const y = num(b[colB]);
      if (x == null && y == null) continue;
      const differs = x == null || y == null || Math.abs(x - y) > tolerance * Math.max(Math.abs(x), Math.abs(y), 1e-9);
      if (differs) differences.push({ material: name, field, a: x, b: y });
    }
  }
  const onlyInFull = [...full.entries()].filter(([k]) => !seen.has(k)).map(([, r]) => r['Source Name'] || r['Name'] || '');
  return { differences, onlyInFinal, onlyInFull };
}

// ── 2. Does each injection-capable material carry what the engine reads ─────────────────────────────────────────────────────────────────────────

const INJECTION_NEEDS: ReadonlyArray<readonly [string, string, boolean]> = [
  ['injection pressure', 'processingParameters.injectionPressureMaxMPa', false],
  ['flow length ratio', 'processingParameters.flowLengthRatio', false],
  ['melt temperature', 'thermalProperties.meltingTempC', true],
  ['mold temperature', 'thermalProperties.moldTempC', true],
  ['melt density', 'physicalProperties.densityOfMeltKgM3', true],
];

/** The materials flagged injection-capable (canIM_SFM) that lack a value the injection engine reads; a zero counts as missing where it cannot be a value. */
export function injectionGaps(rows: Row[]): Array<{ material: string; missing: string[] }> {
  const out: Array<{ material: string; missing: string[] }> = [];
  for (const r of rows) {
    if (r['processCompatibility.canIM_SFM']?.toLowerCase() !== 'true') continue;
    const missing = INJECTION_NEEDS.filter(([, col, positive]) => {
      const v = num(r[col]);
      return v == null || (positive && v <= 0);
    }).map(([label]) => label);
    if (missing.length > 0) out.push({ material: r['sourceName'] || r['name'] || '', missing });
  }
  return out;
}

// ── 3. Presses ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const median = (xs: number[]) => {
  const s = [...xs].sort((p, q) => p - q);
  return s.length === 0 ? null : s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

export interface PressFinding { press: string; issue: string; value?: number | null }

/** A press whose price per kN of clamp is far from the median of its file (a wrong clamp or a wrong price), and the blanks in the columns the engine uses. */
export function pressFindings(rows: Row[], factor = 4) {
  const findings: PressFinding[] = [];
  const perKn = rows.flatMap((r) => {
    const kn = num(r['limits.clampingForceKn']);
    const price = num(r['machine.machinePriceUsd']);
    return kn && price ? [{ name: r['name'] ?? '', v: price / kn }] : [];
  });
  const mid = median(perKn.map((p) => p.v));
  if (mid) {
    for (const p of perKn) if (p.v > mid * factor || p.v < mid / factor) findings.push({ press: p.name, issue: `price per kN of clamp is ${(p.v / mid).toFixed(1)}x the median`, value: p.v });
  }
  const blanks: Record<string, number> = {};
  for (const col of ['rates.plasticizingRateGppsGPerS', 'rates.injectionRateMm3PerS', 'time.dryCycleTimeS', 'limits.shotSizeGppsG', 'limits.tieBarDistanceHorMm', 'limits.maxMoldHeightMm']) {
    blanks[col] = rows.filter((r) => num(r[col]) == null).length;
  }
  return { findings, blanks, presses: rows.length };
}

// ── 4. Which staged names does the code read ────────────────────────────────────────────────────────────────────────────────────────────────

/** The names (variables, lookup tables) that appear nowhere in the given source text, as whole words. */
export function unreadNames(names: string[], sourceText: string): string[] {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...new Set(names.filter((n) => n && !new RegExp(`(^|[^A-Za-z0-9_])${escape(n)}($|[^A-Za-z0-9_])`).test(sourceText)))];
}

// ── 5. Housekeeping ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Download copies ("name (1).csv") whose original sits beside them, and files that look like another domain's data: by default the machine/India/ folder
 * of the Plastic Modeling set, which holds case-erector rates and steel stock prices, not plastics.
 */
export function housekeeping(paths: string[], foreign: RegExp[] = [/(^|[\\/])India[\\/]/]) {
  const set = new Set(paths);
  const copies = paths.filter((p) => /\s\(\d+\)(\.[A-Za-z0-9]+)?$/.test(p) && set.has(p.replace(/\s\(\d+\)(\.[A-Za-z0-9]+)?$/, '$1')));
  const strayCopies = paths.filter((p) => /\s\(\d+\)(\.[A-Za-z0-9]+)?$/.test(p) && !copies.includes(p));
  const notPlastics = paths.filter((p) => foreign.some((re) => re.test(p)));
  return { copies, strayCopies, notPlastics };
}
