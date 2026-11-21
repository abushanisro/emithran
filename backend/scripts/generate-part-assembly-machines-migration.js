/**
 * Writes migration 1098 (the Part Assembly machines: the specs their calculators read, the robotic spot welders' crew, and the India twins)
 * from memory/Part Assembly/Machine and memory/Countries data/India_XML_Data_.csv:
 *   node scripts/generate-part-assembly-machines-migration.js
 * Every value is read from those files; a machine or value the files do not have stops the generator instead of being guessed.
 */
const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');
const { readCsv, sqlStr, sqlNum, sqlJsonb, twinMachinesSql } = require('../migrations/scripts/lib/memory-machine-seed.js');

const MEMORY = join(__dirname, '../../memory');
const DIR = 'Part Assembly/Machine';
const EXPORT = 'Countries data/India_XML_Data_.csv';
const OUT = join(__dirname, '../migrations/1098_part_assembly_machines.sql');
const GROUP = 'Part Assembly';

// The HR Rates machine class of each Part Assembly process (migrations 795, 827).
const CLASS = {
  'Bevel Cutting': 'bevel_cutting', 'Finish Grinding': 'finish_grinding', Grinding: 'grinding', 'Laser Seam Welding': 'laser_seam_welding',
  'Manual MIG Welding': 'part_assembly_manual_mig_welding', 'Manual Spot Welding': 'part_assembly_manual_spot_welding',
  'Robotic MIG Welding': 'part_assembly_robotic_mig_welding', 'Robotic Spot Welding': 'part_assembly_robotic_spot_welding',
  'Wire Brushing': 'wire_brushing',
};
// The India labour rate of each wage grade (USD/hr): the rate the India rows of that grade carry in HR Rates, as migration 1075 used.
const INDIA_GRADE_RATE = { '2 - Metal': 1.65, '5 - Metal': 2.75, '6 - Metal': 3.52 };
// The export spells one robotic spot welder differently from HR Rates (migration 795): its twin takes the HR Rates name.
const EXPORT_NAME_TO_USA = { 'PerformArc 52 (Pansonic)': 'PerformArc 52 (Panasonic)' };

const num = (v) => {
  const x = Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return String(v ?? '').trim() !== '' && Number.isFinite(x) ? x : null;
};
const cents = (v) => Math.round(num(v) * 100) / 100;

const grades = Object.fromEntries(
  readCsv(join(MEMORY, 'Part Assembly/wage_grade_associations_welding_group.csv')).rows.map((r) => [r['Process Name'], r['Wage Grade Name']]),
);
const exportRows = readCsv(join(MEMORY, EXPORT)).rows
  .filter((r) => r['Commodity'] === GROUP)
  .map((r) => ({ ...r, name: EXPORT_NAME_TO_USA[r['name']] ?? r['name'] }));

// The specs each welder's calculator reads, by key: from its USA machine file, or (a value that file does not have) from the machine's row
// of the country export. Those are the machine's own parameters (wire, density, tacks), the same in every country export.
const WELDERS = [
  {
    process: 'Manual MIG Welding', file: 'manual_mig_weld_machines.csv',
    usa: {
      wire_feed_rate_mm_s: 'wire_feed_rate_mm_s', arc_time_std: 'arc_time_std', gun_clean_time_per_arc_s: 'gun_clean', gun_placement_time_s: 'gun_pl',
      tack_length_mm: 'tack_length_mm', wire_cost_usd_per_kg: 'wire_cost_usd_kg',
    },
    exported: { wire_diameter_mm: 'wireDiameter', weld_density_kg_per_m3: 'weldDensity', tack_pitch_mm: 'tackPitch' },
  },
  {
    process: 'Robotic MIG Welding', file: 'robotic_mig_weld_machines.csv',
    usa: {
      arc_time_std: 'arc_time_std', gun_clean_time_per_arc_s: 'gun_clean_time_per_arc_s', gun_placement_time_s: 'gun_placement_time_s',
      programming_time_per_weld_s: 'programming_time_per_weld_s', weld_heads: 'number_of_weld_heads', tack_length_mm: 'tack_length_mm',
      tack_pitch_mm: 'tack_pitch_mm', weld_density_kg_per_m3: 'weld_density_kg_m3', wire_diameter_mm: 'wire_diameter_mm', wire_cost_usd_per_kg: 'wire_cost_usd_kg',
    },
    exported: { wire_feed_rate_mm_s: 'wireFeedRate' },
  },
  {
    process: 'Manual Spot Welding', file: 'manual_spot_weld_machines.csv',
    usa: { gun_clean_time_per_arc_s: 'gun_clean_time_per_arc_s', gun_placement_time_s: 'gun_placement_time_s', spot_weld_time_s: 'spot_weld_time_s' },
    exported: {},
  },
  {
    process: 'Robotic Spot Welding', file: 'robotic_spot_weld_machines.csv',
    usa: {
      gun_clean_time_per_arc_s: 'gun_clean_time_per_arc_s', gun_placement_time_s: 'gun_placement_time_s', programming_time_per_weld_s: 'programming_time_per_weld_s',
      spot_weld_time_s: 'spot_weld_time_s', weld_heads: 'number_of_weld_heads',
    },
    exported: {},
    crew: true,
  },
];

const specRows = [];
for (const w of WELDERS) {
  for (const r of readCsv(join(MEMORY, DIR, w.file)).rows) {
    const name = r['name'];
    const specs = { source: `memory/${DIR}/${w.file}` };
    for (const [key, col] of Object.entries(w.usa)) {
      const v = num(r[col]);
      if (v == null) throw new Error(`${w.process} ${name}: no ${col} in ${w.file}`);
      specs[key] = v;
    }
    const keys = Object.keys(w.exported);
    if (keys.length) {
      const x = exportRows.find((e) => e['Machine Type'] === w.process && e['name'] === name);
      if (!x) throw new Error(`${w.process} ${name}: not in ${EXPORT}`);
      for (const [key, field] of Object.entries(w.exported)) {
        const v = num(x[field]);
        if (v == null) throw new Error(`${w.process} ${name}: no ${field} in ${EXPORT}`);
        specs[key] = v;
      }
      specs.source_export = `${keys.join(', ')}: memory/${EXPORT}, the machine's row`;
    }
    const operators = w.crew ? num(r['number_of_operators']) : null;
    if (w.crew && !(operators > 0)) throw new Error(`${w.process} ${name}: no crew in ${w.file}`);
    specRows.push({ cls: CLASS[w.process], name, specs, operators });
  }
}

// The laser seam welder's index time: memory gives "Index Time, 15" with no unit, beside "Load Time, 30, s" and "Unload Time, 15, s".
const laser = Object.fromEntries(
  readFileSync(join(MEMORY, DIR, 'laser_seam_weld_machine.csv'), 'utf8').split(/\r?\n/).slice(1).filter(Boolean)
    .map((l) => l.split(',')).map(([p, v]) => [p, v]),
);
const indexS = num(laser['Index Time']);
if (indexS == null) throw new Error('laser_seam_weld_machine.csv: no Index Time');
specRows.push({
  cls: CLASS['Laser Seam Welding'], name: laser['Name'],
  specs: { index_time_s: indexS, index_time_unit: 'memory gives no unit; read as seconds, as its Load Time (30 s) and Unload Time (15 s)' }, operators: null,
});
// The wire brushing speed under the key its calculator reads (migration 864 wrote it as wire_brushing_speed_mm_s).
const brush = readCsv(join(MEMORY, DIR, 'wire_brushing_machine.csv')).rows[0];
specRows.push({ cls: CLASS['Wire Brushing'], name: brush['name'], specs: { wire_brushing_speed_mm_per_s: num(brush['wire_brushing_speed_mm_s']) }, operators: null });

// The India twins: each machine's overhead (USD/hr, to cents) from its row of the export, labour at the India rate of its process's wage grade.
const byProcess = {};
const twins = exportRows.map((r) => {
  const process = r['Machine Type'];
  const machineClass = CLASS[process];
  if (!machineClass) throw new Error(`no machine class for ${process}`);
  const labour = INDIA_GRADE_RATE[grades[process]];
  if (labour == null) throw new Error(`no India rate for wage grade ${grades[process]} (${process})`);
  byProcess[process] = (byProcess[process] ?? 0) + 1;
  return {
    location: 'India', countryCode: 'IN', machineClass, machineName: r['name'], labour,
    direct: cents(r['customWorkCenterDirectOverheadRate']), indirect: cents(r['customWorkCenterIndirectOverheadRate']), sourceKey: `${process}:${r['name']}:India`,
  };
}).sort((a, b) => (a.machineClass + a.machineName).localeCompare(b.machineClass + b.machineName));
if (twins.length !== 25) throw new Error(`expected the 25 Part Assembly machines in ${EXPORT}, found ${twins.length}`);

const sql = `-- ============================================================================
-- Migration 1098: the Part Assembly machines -- the specs their calculators read, the robotic spot welders' crew, and India
-- ============================================================================
-- Generated by scripts/generate-part-assembly-machines-migration.js; re-run it and diff instead of editing.
--
-- Part Assembly (memory/Part Assembly: welded parts) had its 25 machines in HR Rates for the USA only (migration 795), and the welders
-- were unusable:
--   * no specs: migration 864 wrote the welders' parameters by class name, but migration 827 had already renamed the classes to
--     part_assembly_*, so 864 matched none of them. Here each welder gets the specs its calculator reads (migration 1100), by key: from its
--     USA machine file, and the values that file does not have (manual MIG: wire diameter, weld density, tack pitch; robotic MIG: wire feed
--     rate) from the machine's row of memory/${EXPORT}, the machine's own parameters (the same in every country export).
--   * the robotic spot welders' crew is 0.10 operators in memory; it was inserted as 0 (a smallint column then, migration 971 widened it),
--     so their labour was costed at nothing.
--   * the laser seam welder's Index Time is given with no unit (beside Load Time 30 s and Unload Time 15 s): kept as index_time_s, seconds.
--   * the wire brushing speed is added under the key its calculator reads.
--
-- India: memory/${EXPORT}, commodity "Part Assembly" (${twins.length} machines): each machine's direct and indirect overhead (USD/hr, to
-- cents) on its USA twin (same class, exact name; "PerformArc 52 (Pansonic)" in the export is HR Rates' "PerformArc 52 (Panasonic)").
-- Labour: the India rate of the process's wage grade (memory/Part Assembly/wage_grade_associations_welding_group.csv), the rate the India
-- rows of that grade carry (2 - Metal 1.65, 5 - Metal 2.75, 6 - Metal 3.52 USD/hr), as migration 1075 did for Assembly.
${Object.entries(byProcess).sort().map(([p, k]) => `--   ${p.padEnd(24)}${k} machine(s)`).join('\n')}
--
-- Idempotent. Verify:
--   SELECT location, machine_class, count(*), count(*) FILTER (WHERE specs ? 'gun_placement_time_s') FROM mhr_records
--    WHERE process_group = '${GROUP}' GROUP BY 1, 2 ORDER BY 1, 2;
-- ============================================================================

UPDATE mhr_records m
SET specs = COALESCE(m.specs, '{}'::jsonb) || v.specs,
    operators = COALESCE(v.operators, m.operators),
    updated_at = now()
FROM (VALUES
${specRows.map((r) => `  (${sqlStr(r.cls)}, ${sqlStr(r.name)}, ${sqlJsonb(r.specs)}, ${sqlNum(r.operators)}::numeric)`).join(',\n')}
) AS v(machine_class, machine_name, specs, operators)
WHERE m.process_group = ${sqlStr(GROUP)} AND m.location = 'USA' AND m.machine_class = v.machine_class AND m.machine_name = v.machine_name;

${twinMachinesSql({ tag: 'part_assembly_machines', processGroup: GROUP, twins })}

DO $part_assembly_check$
DECLARE bare text[];
BEGIN
  SELECT array_agg(location || ': ' || machine_class || ' ' || machine_name ORDER BY location, machine_class, machine_name) INTO bare FROM mhr_records
   WHERE process_group = ${sqlStr(GROUP)} AND machine_class LIKE 'part_assembly_%' AND NOT COALESCE(specs ? 'gun_placement_time_s', false);
  IF bare IS NOT NULL THEN RAISE EXCEPTION 'Part Assembly welders still without the specs their calculators read: %', bare; END IF;
  SELECT array_agg(location || ': ' || machine_name ORDER BY location, machine_name) INTO bare FROM mhr_records
   WHERE machine_class IN ('part_assembly_manual_mig_welding', 'part_assembly_robotic_mig_welding')
     AND NOT (COALESCE(specs ? 'wire_feed_rate_mm_s', false) AND COALESCE(specs ? 'wire_diameter_mm', false));
  IF bare IS NOT NULL THEN RAISE EXCEPTION 'Part Assembly MIG welders without a wire feed rate and diameter: %', bare; END IF;
  SELECT array_agg(location || ': ' || machine_name ORDER BY location, machine_name) INTO bare FROM mhr_records
   WHERE machine_class = 'part_assembly_robotic_spot_welding' AND COALESCE(operators, 0) = 0;
  IF bare IS NOT NULL THEN RAISE EXCEPTION 'Robotic spot welders still with no crew: %', bare; END IF;
END $part_assembly_check$;

NOTIFY pgrst, 'reload schema';
`;
writeFileSync(OUT, sql);
console.log(`wrote ${OUT} (${specRows.length} USA spec rows, ${twins.length} India twins)`);
