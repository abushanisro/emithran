// Generator: stages real per-machine capability (work envelope) into
// mhr_records for the 7 real Machining categories that selector.ts's
// MACHINING_CATEGORY_ALIAS routes into the live cnc_* pricing buckets
// (2/3 Axis Lathe, 2/3 Axis Bar Feed Lathe with Sub Spindle, 3/4/5 Axis
// Mill) -- the only Machining categories the cost engine can actually
// select a specific machine for today.
//
// Root cause this closes: checkCNCCapability (cost-cnc-engine.ts) used a
// single hardcoded per-CLASS envelope (MACHINE_ENVELOPE) for ALL machines
// in a class, never the specific selected machine's real dimensions --
// unlike every other domain's checkMachineCapability, which hydrates real
// per-machine capability from mhr_records.max_x_mm/max_y_mm/max_z_mm/
// max_diameter_mm/max_length_mm. Those columns were never populated for
// CNC machines (migration 692/693 staged accounting/rate/machine-price
// data only -- no capability columns at all). This migration is that
// missing piece, for the 7 categories that can actually use it.
//
// Field mapping verified directly against the real source data (memory/
// machining/machine/machiningusa.json), NOT guessed -- confirmed uniform
// within each family (all machines in a category share the same limits
// key set):
//   Lathe family (2 Axis Lathe, 3 Axis Lathe, 2/3 Axis Bar Feed Lathe with
//   Sub Spindle): limits.maxDiameterMm -> max_diameter_mm (chuck swing /
//   turning capacity), limits.maxLengthMm -> max_length_mm (bar/part
//   length capacity).
//   Mill family (3/4/5 Axis Mill): limits.travelXAxisMm/travelYAxisMm/
//   travelZAxisMm -> max_x_mm/max_y_mm/max_z_mm (real table travel, the
//   same generic columns Sheet Metal's own bed-fit capability check
//   already reads).
//
// Deliberately NOT machine_length_mm/machine_width_mm (already staged by
// migration 738) -- those are the machine's own physical FOOTPRINT
// (floor space), confirmed by cross-checking migration 505's Sheet Metal
// staging (e.g. a 2-Axis Router's bed_length_mm=2438.4/bed_width_mm=1219.2
// -- the real work envelope -- vs its OWN machine_length_mm=3020/
// machine_width_mm=2970 -- the larger physical footprint including
// control cabinets etc.). Using footprint as a stand-in for work envelope
// would have been a NEW bug (comparing a part against the wrong real
// quantity), not a fix -- caught before writing this migration.
//
// Matches existing mhr_records rows by (machine_class, machine_name) --
// migration 693 already inserted these 118 real rows; this only adds the
// capability columns that were missing, via UPDATE.
//
// Offline, file-in/file-out -- matches every other gen_*.js in this codebase.

const fs = require('fs');
const path = require('path');

const { readRecords, groupRecords } = require('./lib/memory-csv');

const SRC_FILE = path.join(__dirname, '../../../memory/Machining/machine/machiningusa.csv');
const OUT_SQL = path.join(__dirname, '../755_stage_cnc_machine_capability.sql');

const LATHE_CLASS_BY_CATEGORY = {
  '2 Axis Lathe': '2_axis_lathe',
  '3 Axis Lathe': '3_axis_lathe',
  '2 Axis Bar Feed Lathe with Sub Spindle': '2_axis_bar_feed_lathe_with_sub_spindle',
  '3 Axis Bar Feed Lathe with Sub Spindle': '3_axis_bar_feed_lathe_with_sub_spindle',
};
const MILL_CLASS_BY_CATEGORY = {
  '3 Axis Mill': '3_axis_mill',
  '4 Axis Mill': '4_axis_mill',
  '5 Axis Mill': '5_axis_mill',
};

function sqlStr(v) {
  if (v === null || v === undefined) return 'NULL';
  return `$str$${String(v)}$str$`;
}
function sqlNum(v) {
  if (v === null || v === undefined) return 'NULL';
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : 'NULL';
}

const data = { machineCategories: groupRecords(readRecords(SRC_FILE), 'categoryName', 'machines', ['categoryName', 'digitalFactory', 'sector']) };

const lathRows = [];
const millRows = [];

for (const cat of data.machineCategories) {
  const lathClass = LATHE_CLASS_BY_CATEGORY[cat.categoryName];
  const millClass = MILL_CLASS_BY_CATEGORY[cat.categoryName];
  if (!lathClass && !millClass) continue;

  for (const m of cat.machines) {
    // machiningusa.json (the original 12-category file) is camelCase
    // throughout and uses a plain top-level "name" string -- unlike the 26
    // _usa.json/_work_center_data.json files (migration 738) which nest
    // {primary_id: {name, description}}. Different source file, different
    // real shape; handle both rather than assuming one.
    const name = m.name || (m.primary_id && m.primary_id.name);
    if (!name) continue;
    const limits = m.limits || {};

    if (lathClass) {
      if (limits.maxDiameterMm == null || limits.maxLengthMm == null) continue; // real gap, not fabricated
      lathRows.push(`  (${sqlStr(lathClass)}, ${sqlStr(name)}, ${sqlNum(limits.maxDiameterMm)}, ${sqlNum(limits.maxLengthMm)})`);
    } else {
      if (limits.travelXAxisMm == null || limits.travelYAxisMm == null || limits.travelZAxisMm == null) continue;
      millRows.push(`  (${sqlStr(millClass)}, ${sqlStr(name)}, ${sqlNum(limits.travelXAxisMm)}, ${sqlNum(limits.travelYAxisMm)}, ${sqlNum(limits.travelZAxisMm)})`);
    }
  }
}

console.log(`lathe rows: ${lathRows.length}, mill rows: ${millRows.length}, total: ${lathRows.length + millRows.length}`);

const sql = `-- ============================================================================
-- Migration 755: Stage real per-machine capability (work envelope) for the
-- 7 CNC Machining categories the cost engine can actually select a
-- specific machine for (selector.ts's MACHINING_CATEGORY_ALIAS)
--
-- Generated by gen_755_stage_cnc_machine_capability.js. See that script's
-- header for the full field-mapping rationale and why this is deliberately
-- NOT machine_length_mm/machine_width_mm (that's real data too, but it's
-- the machine's physical footprint, not its work envelope -- a different
-- real quantity, verified against Sheet Metal's own staging convention
-- before use).
--
-- Scoped to these 7 of the real 38 Machining categories because they are
-- the only ones selector.ts's classifyMachineRecord can currently route a
-- real quote to (see MACHINING_CATEGORY_ALIAS) -- the other 31 have no
-- dedicated cost engine yet, so per-machine capability data for them isn't
-- consumable by anything today; scoping it here avoids staging real data
-- that nothing reads (same discipline as everywhere else this session
-- disclosed a gap rather than doing unconsumed work).
-- ============================================================================

UPDATE mhr_records m
SET max_diameter_mm = v.max_diameter_mm,
    max_length_mm = v.max_length_mm
FROM (VALUES
${lathRows.join(',\n')}
) AS v(machine_class, machine_name, max_diameter_mm, max_length_mm)
WHERE m.machine_class = v.machine_class AND m.machine_name = v.machine_name;

UPDATE mhr_records m
SET max_x_mm = v.max_x_mm,
    max_y_mm = v.max_y_mm,
    max_z_mm = v.max_z_mm
FROM (VALUES
${millRows.join(',\n')}
) AS v(machine_class, machine_name, max_x_mm, max_y_mm, max_z_mm)
WHERE m.machine_class = v.machine_class AND m.machine_name = v.machine_name;

NOTIFY pgrst, 'reload schema';

-- ── Verification (run manually after) ───────────────────────────────────────
-- SELECT machine_class, count(*) FROM mhr_records
--   WHERE machine_class IN ('2_axis_lathe','3_axis_lathe','2_axis_bar_feed_lathe_with_sub_spindle','3_axis_bar_feed_lathe_with_sub_spindle')
--   AND max_diameter_mm IS NOT NULL GROUP BY machine_class;
-- -- Expect: 2_axis_lathe 24, 3_axis_lathe 23, 2_axis_bar_feed... 2, 3_axis_bar_feed... 2
-- SELECT machine_class, count(*) FROM mhr_records
--   WHERE machine_class IN ('3_axis_mill','4_axis_mill','5_axis_mill') AND max_x_mm IS NOT NULL GROUP BY machine_class;
-- -- Expect: 3_axis_mill 22, 4_axis_mill 21, 5_axis_mill 24
`;

fs.writeFileSync(OUT_SQL, sql, 'utf8');
console.log(`Wrote ${OUT_SQL}`);
