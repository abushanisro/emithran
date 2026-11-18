/**
 * Writes migration 1075 (the Assembly machines at India rates, and the Laser Welding and Adhesive Bonding machines) from memory/Countries data:
 *   node scripts/generate-assembly-machines-migration.js
 * Each India row is its USA twin (migration 794, same machine class and exact name) with the India export's overhead rates and the India rate
 * of its process's wage grade (memory/Assembly/wage_grade_associations). Laser Welding and Adhesive Bonding have no USA machine file; see the
 * migration header.
 */
const { writeFileSync } = require('fs');
const { join } = require('path');
const { readCsv, specKey } = require('../migrations/scripts/lib/memory-machine-seed.js');

const MEMORY = join(__dirname, '../../memory');
const OUT = join(__dirname, '../migrations/1075_assembly_machines_india_laser_adhesive.sql');

// The machine class migration 794 gave each Assembly process; Laser Welding and Adhesive Bonding are new here.
const CLASS = {
  'Ultrasonic Welding': 'assembly_ultrasonic_welding', 'Cap Sealing': 'cap_sealing', 'Electron Beam Welding': 'electron_beam_welding',
  'Fay Sealing': 'fay_sealing', 'Fillet Sealing': 'fillet_sealing', 'Lock Bolt': 'lock_bolt', 'Manual MIG Welding': 'manual_mig_welding',
  'Manual Spot Welding': 'manual_spot_welding', 'Manual TIG Welding': 'manual_tig_welding', 'Mechanical Assembly': 'mechanical_assembly',
  'Pick and Place': 'pick_and_place', Rivet: 'rivet', 'Robotic MIG Welding': 'robotic_mig_welding', 'Robotic Spot Welding': 'robotic_spot_welding',
  'Robotic TIG Welding': 'robotic_tig_welding', 'Threaded Insert': 'threaded_insert', 'Weld Clean Up': 'weld_clean_up', 'Weld Prep': 'weld_prep',
  'Laser Welding': 'laser_welding', 'Adhesive Bonding': 'adhesive_bonding',
};
// The new classes, the USA row each is cloned from (same process group and wage grade) and that grade's USA labour (USD/hr).
const NEW = {
  laser_welding: { template: ['electron_beam_welding', 'Electron Beam Welder - 4000 Watts - 0.225m x 0.225m'], usaLabour: 47.36 },
  adhesive_bonding: { template: ['fay_sealing', 'Manual Fay Sealing'], usaLabour: 29.95 },
};
// The India labour rate of each wage grade (USD/hr): the value every India row of that grade already carries in HR Rates
// (SELECT wage_grade, usd_labor_rate_per_hr FROM mhr_records WHERE location = 'India'). 2 - Plastic has no India row anywhere: it is the
// midpoint of the India 1 - Plastic (1.49) and 3 - Plastic (1.65) rates, the grades either side of it in the same wage family.
const INDIA_GRADE_RATE = { '2 - Metal': 1.65, '5 - Metal': 2.75, '6 - Metal': 3.52, '2 - Plastic': 1.57 };

const grades = Object.fromEntries(readCsv(join(MEMORY, 'Assembly/wage_grade_associations (1).csv')).rows.map((r) => [String(r['Process Name']).replace(/^﻿/, ''), r['Wage Grade Name']]));
const num = (v) => { const n = Number(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const q = (s) => `$str$${s}$str$`;
const exportRows = (file) => readCsv(join(MEMORY, `Countries data/${file}`)).rows.filter((r) => r['Commodity'] === 'Assembly');
/** The export's machine-specific fields (beam power, speeds, application rate, ...) as specs keys, for the new classes' calculators. */
const SPEC_FIELDS = ['beamOutputPower', 'maxSpeed', 'maxWeight', 'numHeads', 'partPlacementTime', 'programTimePerWeld', 'workingHeight', 'workingLength', 'workingWidth', 'applicationRate', 'isRobotic', 'isVirtualMachine'];
const SPEC_KEY = {
  beamOutputPower: 'beam_output_power_kw', maxSpeed: 'max_speed_mm_per_s', maxWeight: 'max_weight_kg', numHeads: 'number_of_heads',
  partPlacementTime: 'part_placement_time_s', programTimePerWeld: 'programming_time_per_weld_s', workingHeight: 'working_height_mm',
  workingLength: 'working_length_mm', workingWidth: 'working_width_mm', applicationRate: 'application_rate_m2_per_min', isRobotic: 'is_robotic',
  isVirtualMachine: 'is_virtual_machine',
};
const specsOf = (r, source) => {
  const s = { source, process: r['Machine Type'], machine_life_yr: num(r['machineLife']), setup_time_hr: num(r['setupTime']) };
  for (const f of SPEC_FIELDS) if (r[f] !== undefined && r[f] !== '') s[SPEC_KEY[f]] = /^(TRUE|FALSE)$/i.test(r[f]) ? r[f].toUpperCase() === 'TRUE' : Number(r[f]);
  return s;
};

// The India export spells three robotic spot welders differently from the USA machine file (60'' for 60", Panasonic for Pansonic): the twin
// takes the USA row's exact name.
const INDIA_NAME_TO_USA = {
  "PerformArc 100 (Pansonic- 60'' Turntable)": 'PerformArc 100 (Pansonic- 60" Turntable)',
  "PerformArc 125 (Panasonic- 60'' Turntable)": 'PerformArc 125 (Pansonic- 60" Turntable)',
  'PerformArc 150 (Panasonic- Servo Turntable)': 'PerformArc 150 (Pansonic- Servo Turntable)',
};
const india = exportRows('India_XML_Data_.csv').map((r) => ({ ...r, name: INDIA_NAME_TO_USA[r['name']] ?? r['name'] }));
const nl = exportRows('Netherlands_XML_Data_.csv');
const values = [];
const byProcess = {};
for (const r of india) {
  const process = r['Machine Type'];
  const cls = CLASS[process];
  if (!cls) throw new Error(`no machine class for ${process}`);
  const grade = grades[process];
  const labour = INDIA_GRADE_RATE[grade];
  if (labour == null) throw new Error(`no India rate for wage grade ${grade} (${process})`);
  const neu = NEW[cls];
  const [srcClass, srcName] = neu ? neu.template : [cls, r['name']];
  values.push({ srcClass, srcName, loc: 'India', cc: 'IN', cls, name: r['name'], labour, direct: num(r['customWorkCenterDirectOverheadRate']), indirect: num(r['customWorkCenterIndirectOverheadRate']),
    key: `${process}:${r['name']}:India`, own: neu ? r : null });
  byProcess[process] = (byProcess[process] ?? 0) + 1;
}
// The new classes at USA: the Netherlands export's rates stand in for the USA files memory/Assembly does not have.
const nlCheck = { fay: nl.find((r) => r['name'] === 'Manual Fay Sealing'), mech: nl.find((r) => r['name'] === 'Default Mechanical Assembly') };
for (const r of nl.filter((x) => NEW[CLASS[x['Machine Type']]])) {
  const cls = CLASS[r['Machine Type']];
  values.push({ srcClass: NEW[cls].template[0], srcName: NEW[cls].template[1], loc: 'USA', cc: 'US', cls, name: r['name'], labour: NEW[cls].usaLabour,
    direct: num(r['customWorkCenterDirectOverheadRate']), indirect: num(r['customWorkCenterIndirectOverheadRate']), key: `${r['Machine Type']}:${r['name']}`, own: r });
}
values.sort((a, b) => (a.loc + a.cls + a.name).localeCompare(b.loc + b.cls + b.name));
const usaNew = values.filter((v) => v.loc === 'USA');

const tuple = (v) => {
  const o = v.own;
  const own = o
    ? `${num(o['machinePrice'])}, ${num(o['machineLength'])}::integer, ${num(o['machineWidth'])}::integer, ${num(o['machinePower'])}, ${num(o['numOperators'])}, ${num(o['footprintAllowanceFactor'])}, ${num(o['setupTime'])}, ${q(JSON.stringify(specsOf(o, `memory/Countries data (${v.loc === 'USA' ? 'Netherlands rates for the USA, see migration 1075' : 'India'})`)))}::jsonb`
    : 'NULL::numeric, NULL::integer, NULL::integer, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::jsonb';
  return `  (${q(v.srcClass)}, ${q(v.srcName)}, '${v.loc}', '${v.cc}', ${q(v.cls)}, ${q(v.name)}, ${v.labour}, ${v.direct}, ${v.indirect}, ${q(v.key)}, ${own})`;
};

const sql = `-- ============================================================================
-- Migration 1075: Assembly machines at India rates, and the Laser Welding and Adhesive Bonding machines
-- ============================================================================
-- Generated by scripts/generate-assembly-machines-migration.js; re-run it and diff instead of editing.
--
-- Migration 794 seeded the Assembly machines (memory/Assembly/Machines) for the USA only, so an assembly priced in India had no machine on
-- any step; and Laser Welding and Adhesive Bonding have no machine file in memory/Assembly, so no step of theirs had a machine anywhere.
--
-- India: memory/Countries data/India_XML_Data_.csv, commodity "Assembly" (${india.length} machines): each machine's direct and indirect overhead
-- rate (USD/hr, rounded to cents) on its USA twin (same class, exact name). Labour: the India rate of the process's wage grade
-- (memory/Assembly/wage_grade_associations), the value the India rows of that grade already carry (2 - Metal 1.65, 5 - Metal 2.75,
-- 6 - Metal 3.52 USD/hr), written to usd_labor_rate_per_hr AND usd_lhr_total (the column the machine selector reads; migration 1061).
-- 2 - Plastic (Ultrasonic Welding) has no India rate anywhere: 1.57 USD/hr, the midpoint of the India 1 - Plastic (1.49) and 3 - Plastic
-- (1.65) rates, the grades either side of it in the same family.
${Object.entries(byProcess).sort().map(([p, n]) => `--   ${p.padEnd(24)}${n} machine(s)`).join('\n')}
--
-- Laser Welding and Adhesive Bonding (${usaNew.length} machines at the USA): the country exports have them with their specs (beam power,
-- speed, working envelope and programming time per weld; application rate, robotic or manual). India: its export's rates. USA: there is no
-- USA export (the USA rates are the machine files'); the Netherlands export's rates stand in, the export closest to the USA files: on the
-- Assembly machines both have, Manual Fay Sealing (USA 0.02 / 13.83, Netherlands ${num(nlCheck.fay?.['customWorkCenterDirectOverheadRate'])} / ${num(nlCheck.fay?.['customWorkCenterIndirectOverheadRate'])}) and Default Mechanical
-- Assembly (USA 0.08 / 24.55, Netherlands ${num(nlCheck.mech?.['customWorkCenterDirectOverheadRate'])} / ${num(nlCheck.mech?.['customWorkCenterIndirectOverheadRate'])}), as migration 1070 did for Cleaning. Labour: grade 5 - Metal (Laser
-- Welding) 47.36, 2 - Metal (Adhesive Bonding) 29.95 USD/hr at the USA. Each new row is cloned from a USA row of the same group and grade
-- (an Electron Beam Welder, Manual Fay Sealing) with its own name, class, price, size, power, crew, setup and specs.
--
-- Idempotent: a row already present for a location + machine_class + machine_name is skipped.
-- Verify: SELECT location, machine_class, count(*) FROM mhr_records WHERE process_group = 'Assembly' GROUP BY 1, 2 ORDER BY 1, 2;
-- ============================================================================

DO $assembly_machines$
DECLARE
  cols text; sel text; r record; src_id uuid; n integer := 0; missing text[] := '{}';
BEGIN
  SELECT
    string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position),
    string_agg(
      CASE c.column_name
        WHEN 'location'                                THEN '$5'
        WHEN 'country_code'                            THEN '$6'
        WHEN 'machine_class'                           THEN '$7'
        WHEN 'machine_name'                            THEN '$8'
        WHEN 'direct_overhead_rate'                    THEN '$2'
        WHEN 'indirect_overhead_rate'                  THEN '$3'
        WHEN 'benchmark_direct_overhead_rate_usd_hr'   THEN '$2'
        WHEN 'benchmark_indirect_overhead_rate_usd_hr' THEN '$3'
        WHEN 'total_machine_hour_rate'                 THEN 'ROUND(($2 + $3)::numeric, 2)'
        WHEN 'mhr_usd_per_hour'                        THEN 'ROUND(($2 + $3)::numeric, 2)'
        WHEN 'usd_labor_rate_per_hr'                   THEN '$4'
        WHEN 'usd_lhr_total'                           THEN '$4'
        WHEN 'benchmark_labor_rate_usd_hr'             THEN '$4'
        WHEN 'benchmark_source_key'                    THEN '$9'
        WHEN 'machine_price_usd'                       THEN 'COALESCE($10, src.machine_price_usd)'
        WHEN 'machine_length_mm'                       THEN 'COALESCE($11, src.machine_length_mm)'
        WHEN 'machine_width_mm'                        THEN 'COALESCE($12, src.machine_width_mm)'
        WHEN 'machine_power_kw'                        THEN 'COALESCE($13, src.machine_power_kw)'
        WHEN 'operators'                               THEN 'COALESCE($14, src.operators)'
        WHEN 'footprint_allowance_factor'              THEN 'COALESCE($15, src.footprint_allowance_factor)'
        WHEN 'setup_time_hr'                           THEN 'COALESCE($16, src.setup_time_hr)'
        WHEN 'specs'                                   THEN 'COALESCE($17, src.specs)'
        WHEN 'id'                                      THEN 'gen_random_uuid()'
        WHEN 'created_at'                              THEN 'now()'
        WHEN 'updated_at'                              THEN 'now()'
        ELSE 'src.' || quote_ident(c.column_name)
      END, ', ' ORDER BY c.ordinal_position
    )
  INTO cols, sel
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'mhr_records' AND c.is_generated = 'NEVER';

  -- (source class, source name, location, country, class, name, labour, direct, indirect, source key, a new machine's own values or NULL)
  FOR r IN SELECT * FROM (VALUES
${values.map(tuple).join(',\n')}
  ) AS v(src_class, src_name, location, country, machine_class, machine_name, labor, direct, indirect, source_key, price, length_mm, width_mm, power_kw, operators, footprint, setup_hr, specs)
  LOOP
    SELECT id INTO src_id FROM mhr_records
    WHERE process_group = 'Assembly' AND location = 'USA' AND machine_class = r.src_class AND machine_name = r.src_name
    LIMIT 1;
    IF src_id IS NULL THEN
      missing := array_append(missing, r.src_class || ':' || r.src_name);
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM mhr_records m WHERE m.location = r.location AND m.machine_class = r.machine_class AND m.machine_name = r.machine_name) THEN
      CONTINUE;
    END IF;
    EXECUTE format(
      'INSERT INTO mhr_records (%s) SELECT %s FROM mhr_records src WHERE src.id = $1',
      cols, sel
    ) USING src_id, r.direct, r.indirect, r.labor, r.location, r.country, r.machine_class, r.machine_name, r.source_key,
            r.price, r.length_mm, r.width_mm, r.power_kw, r.operators, r.footprint, r.setup_hr, r.specs;
    n := n + 1;
  END LOOP;

  RAISE NOTICE 'Assembly rows inserted: %', n;
  IF array_length(missing, 1) > 0 THEN
    RAISE NOTICE 'Assembly rows with no USA row to clone (not inserted): %', missing;
  END IF;
END $assembly_machines$;

NOTIFY pgrst, 'reload schema';
`;
writeFileSync(OUT, sql);
console.log(`wrote ${OUT} (${india.length} India rows, ${usaNew.length} new USA rows)`);
