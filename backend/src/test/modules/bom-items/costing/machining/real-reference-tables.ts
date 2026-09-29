import { readFileSync } from 'fs';
import { join } from 'path';
import type { DrillingTable } from '../../../../../modules/bom-items/costing/machining/lookup/drilling-table';
import { resolveMachiningCapabilityRules, type MachiningCapabilityRules } from '../../../../../modules/bom-items/costing/machining/capability-rules';

// The real machining reference tables, read from the same source files
// migrations 739-751 staged into machining_reference_data
// (memory/machining/lookup/*.csv) — so the engine tests run on the real data,
// not values typed into the test.
const LOOKUP_DIR = join(__dirname, '../../../../../../../memory/machining/lookup');

function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header!.map((h, i) => [h, r[i] ?? ''])));
}

const read = (file: string) => parseCsv(readFileSync(join(LOOKUP_DIR, file), 'utf-8'));
const num = (v: string | undefined) => (v === undefined || v === '' ? undefined : Number(v));

/** tblDrilling, reshaped exactly like its machining_reference_data raw object. */
export function realDrillingTable(): DrillingTable {
  const rows = read('tblDrilling__materials.csv');
  const first = rows[0]!;
  const byDiameter = (prefix: string) =>
    Object.fromEntries(Object.keys(first).filter((k) => k.startsWith(prefix)).map((k) => [k.slice(prefix.length), first[k]!]));
  return {
    tool_series: first['tool_series'],
    construction_by_diameter: byDiameter('construction_by_diameter.'),
    depth_max_mm_by_diameter: Object.fromEntries(
      Object.entries(byDiameter('depth_max_mm_by_diameter.')).map(([k, v]) => [k, Number(v)]),
    ),
    materials: rows.map((r) => ({
      material_cut_code: r['material_cut_code'],
      hardness: num(r['hardness']),
      cutting_speed_m_min: { solid: num(r['cutting_speed_m_min.solid']), insert_based: num(r['cutting_speed_m_min.insert_based']) },
      feed_mm_rev_by_diameter: Object.fromEntries(
        Object.keys(r).filter((k) => k.startsWith('feed_mm_rev_by_diameter.') && r[k] !== '')
          .map((k) => [k.slice('feed_mm_rev_by_diameter.'.length), Number(r[k])]),
      ),
    })),
  };
}

/** tblVirtualPartoffInsertCutData rows (tblParting.csv — the part-off insert cut data). */
export function realPartoffTable(): any[] {
  return read('tblParting.csv').map((r) => ({
    ToolType: r['ToolType'],
    MaterialCutCodeName: r['MaterialCutCodeName'],
    Hardness: num(r['Hardness']),
    LengthMm: num(r['LengthMm']),
    CuttingSpeedMPerMin: num(r['CuttingSpeedMPerMin']),
    DepthMaxMm: num(r['DepthMaxMm']),
    FeedMm: num(r['FeedMm']),
  }));
}

/** The finishing-process capability rules, resolved by the production resolver
 *  from the same files migrations 639 (variables) and 747 (tblGtol) staged. */
export function realCapabilityRules(): MachiningCapabilityRules {
  const variables = parseCsv(readFileSync(join(LOOKUP_DIR, '..', 'variables.csv'), 'utf-8'))
    .map((r) => ({ key: r['variableName']!, value: r['stringValue'] ?? null }));
  const gtol = read('tblGtolProcessCapabilities.csv').map((r) => ({
    ...r, 'Best Achievable': num(r['Best Achievable']), 'Num Repetitions': num(r['Num Repetitions']),
  }));
  const { rules, missing } = resolveMachiningCapabilityRules(variables, gtol);
  if (!rules) throw new Error(`capability rules missing: ${missing.join('; ')}`);
  return rules;
}

/** One material code's grinding values from tblCylindricalGrinding (migration
 *  744, snake_case columns) or tblInternalGrinding (migration 809, source
 *  headers), shaped like MachiningLookupService's grinding params. */
export function realGrindingParams(table: 'tblCylindricalGrinding' | 'tblInternalGrinding', materialCutCode: string) {
  const internal = table === 'tblInternalGrinding';
  const rows = read(internal ? 'tblInternalGrinding.csv' : 'tblCylindricalGrinding__rows.csv');
  const code = internal ? 'Material Cut Code Name' : 'material_cut_code_name';
  const r = rows.find((x) => Number(x[code]) === Number(materialCutCode));
  if (!r) throw new Error(`${table}: no row for material cut code ${materialCutCode}`);
  const v = (i: string, c: string) => Number(r[internal ? i : c]);
  return {
    workSpeedMMin: v('Work Speed (m / min)', 'work_speed_m_min'),
    roughInfeedMm: v('Rough Infeed (mm)', 'rough_infeed_mm'),
    finishInfeedMm: v('Finish Infeed (mm)', 'finish_infeed_mm'),
    roughAxialFeedRevMm: v('Rough Axial Feed (rev^-1)', 'rough_axial_feed_rev_1'),
    finishAxialFeedRevMm: v('Finish Axial Feed (rev^-1)', 'finish_axial_feed_rev_1'),
    dataFound: true,
    materialCutCode,
    match: { table, row: { [code]: internal ? Number(r[code]) : r[code]! } },
  };
}

/** tblTapping rows, typed as migration 809 staged them (numeric cells are numbers). */
export function realTappingTable(): any[] {
  return read('tblTapping.csv').map((r) => ({
    ToolType: r['ToolType'],
    ToolSeries: r['ToolSeries'],
    MaterialCutCodeName: num(r['MaterialCutCodeName']),
    Hardness: num(r['Hardness']),
    HardnessSystem: r['HardnessSystem'],
    CuttingSpeedMPerMin: num(r['CuttingSpeedMPerMin']),
    MetricPitchMm: num(r['MetricPitchMm']),
    ToolLifeMin: num(r['ToolLifeMin']),
    ToolLifeCostUSD: num(r['ToolLifeCostUSD']),
  }));
}

/** The keyway broach reference (tblPullTypeKeywayBroach / tblShimTypeKeywayBroach,
 *  migration 811, plus the two positioning-time variables, migration 639),
 *  typed as staged: numeric cells are numbers, "-" stays text. */
export function realKeywayBroachReference() {
  const typed = (rows: Array<Record<string, string>>) => rows.map((r) => Object.fromEntries(
    Object.entries(r).map(([k, v]) => [k, v !== '' && Number.isFinite(Number(v)) ? Number(v) : v]),
  ));
  const variables = parseCsv(readFileSync(join(LOOKUP_DIR, '..', 'variables.csv'), 'utf-8'));
  const variable = (key: string) => Number(variables.find((v) => v['variableName'] === key)!['stringValue']);
  return {
    pullRows: typed(read('tblPullTypeKeywayBroach_partial.csv')),
    shimRows: typed(read('tblShimTypeKeywayBroach_partial.csv')),
    singlePassPositioningS: variable('singlePassKeywayBroachingPositioningTime'),
    multipassPositioningS: variable('multipassKeywayBroachingPositioningTime'),
  };
}

/** One material code's tblReciprocatingSurfaceGrinding row (migration 749) plus
 *  its wheel's width from tblGrinding (migration 809), shaped like
 *  MachiningLookupService.getSurfaceGrindingParams. */
export function realSurfaceGrindingParams(materialCutCode: string) {
  const r = read('tblReciprocatingSurfaceGrinding.csv').find((x) => Number(x['MaterialCutCodeName']) === Number(materialCutCode));
  if (!r) throw new Error(`tblReciprocatingSurfaceGrinding: no row for ${materialCutCode}`);
  const widths = [...new Set(read('tblGrinding__materials.csv').filter((w) => w['tool_series'] === r['ToolSeries']).map((w) => Number(w['wheel_width_mm'])))];
  return {
    materialCutCode: r['MaterialCutCodeName']!,
    toolSeries: r['ToolSeries']!,
    tableSpeedMPerMin: Number(r['TableSpeedMPerMin']),
    roughDownfeedMm: Number(r['RoughDownfeedMm']),
    finishDownfeedMm: Number(r['FinishDownfeedMm']),
    absoluteCrossfeedMm: Number(r['AbsoluteCrossfeedMm']),
    maxFractionalCrossfeed: Number(r['MaxFractionalCrossfeed']),
    wheelWidthMm: widths.length === 1 ? widths[0]! : null,
  };
}

/** Rows of any memory/Machining CSV (path relative to memory/Machining), as text. */
export function readMachiningMemoryCsv(relativePath: string): Array<Record<string, string>> {
  return parseCsv(readFileSync(join(LOOKUP_DIR, '..', relativePath), 'utf-8'));
}

/** The hobbing reference (tblHobbing 809, tblAnsiHobbing 740, variables defaultNumStarts 639),
 *  typed as staged. */
export function realHobbingReference() {
  const numOrText = (v: string) => (v !== '' && Number.isFinite(Number(v)) ? Number(v) : v);
  const typed = (rows: Array<Record<string, string>>): Array<Record<string, any>> => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, numOrText(v)])));
  const variables = parseCsv(readFileSync(join(LOOKUP_DIR, '..', 'variables.csv'), 'utf-8'));
  return {
    hobRows: typed(read('tblHobbing.csv')),
    ansiRows: typed(read('tblAnsiHobbing__rows.csv')).map((r) => ({ module_mm: r['module_mm'], num_starts: r['num_starts'], hob_diameter_mm: r['hob_diameter_mm'], lead_angle_deg: r['lead_angle_deg'] })),
    defaultNumStarts: Number(variables.find((v) => v['variableName'] === 'defaultNumStarts')!['stringValue']),
  };
}

/** Gear routing and shaving reference: tblGearQuality (739), tblShaving (810),
 *  variables gearQualityDefaultAgmaNewStd / maxShavingWorkpieceSpeed (639), typed as staged. */
export function realGearReference() {
  const numOrText = (v: string) => (v !== '' && Number.isFinite(Number(v)) ? Number(v) : v);
  const variables = parseCsv(readFileSync(join(LOOKUP_DIR, '..', 'variables.csv'), 'utf-8'));
  const v = (k: string) => variables.find((x) => x['variableName'] === k)!['stringValue']!;
  return {
    qualityRows: read('tblGearQuality__qualities.csv').map((r) => ({
      old_agma_quality_number: r['old_agma_quality_number']!, new_agma_quality_number: r['new_agma_quality_number']!,
      din_quality_number: Number(r['din_quality_number']), must_grind: r['must_grind'] === 'True', must_shave: r['must_shave'] === 'True',
    })),
    defaultQuality: v('gearQualityDefaultAgmaNewStd'),
    shaving: {
      rows: read('tblShaving.csv').map((r): Record<string, any> => Object.fromEntries(Object.entries(r).map(([k, x]) => [k, numOrText(x)]))),
      maxWorkpieceRpm: Number(v('maxShavingWorkpieceSpeed')),
    },
  };
}

/** The rotary-broach reference: tblRotaryBroaching (750, raw row array) and variables (639). */
export function realRotaryBroachReference() {
  const variables = parseCsv(readFileSync(join(LOOKUP_DIR, '..', 'variables.csv'), 'utf-8'));
  const v = (k: string) => Number(variables.find((x) => x['variableName'] === k)!['stringValue']);
  return {
    rows: read('tblRotaryBroaching.csv').map((r): Record<string, any> => ({ ...r, Hardness: Number(r['Hardness']), WidthAcrossFlatsMm: Number(r['WidthAcrossFlatsMm']), DepthMaxMm: Number(r['DepthMaxMm']), RPM: Number(r['RPM']), FeedMmPerRev: Number(r['FeedMmPerRev']) })),
    feedAdjustment: v('rotaryBroachFeedAdjustment'),
    pilotDiameterRatio: { 6: v('pilotRotaryBroachHoleDiamPercentIncreaseHex'), 4: v('pilotRotaryBroachHoleDiamPercentIncreaseSquare') },
    pilotLengthRatio: v('pilotRotaryBroachHoleLengthPercentIncrease'),
  };
}
