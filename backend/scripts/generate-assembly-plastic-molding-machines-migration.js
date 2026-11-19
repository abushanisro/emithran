/**
 * Writes migration 1085 (the Assembly Plastic Molding machines: India twins and the press attributes the engine reads) from memory/:
 *   node scripts/generate-assembly-plastic-molding-machines-migration.js
 *
 * - India: each India row of memory/Countries data/India_XML_Data_.csv (commodity "Assembly Plastic Molding") is its USA twin (migration 862,
 *   same machine class and exact name) with the India export's overhead rates and the India rate of its process's wage grade.
 * - Press attributes: the USA machine export (memory/Assembly plastic molding/Machines) dropped what makes a multi-shot press one (injection
 *   units, mold stations, rotating stack, tool index time, shot size, tie bars); the India export holds them as columns. They are written, by
 *   machine name, to both locations' rows as typed columns (max_tonnage, shot_capacity_grams, press_cycle_time_s, mold heights, tie bars) and
 *   normalized specs keys, and checked against the machine name (a mismatch stops the generator).
 */
const { writeFileSync } = require('fs');
const { join } = require('path');
const { readCsv } = require('../migrations/scripts/lib/memory-machine-seed.js');

const MEMORY = join(__dirname, '../../memory');
const OUT = join(__dirname, '../migrations/1085_assembly_plastic_molding_machines.sql');

const PRESS = 'assembly_plastic_molding_multi_shot_molding';
const LOADER = 'assembly_plastic_molding_pick_and_place';
const CLASS = { 'Multi-Shot Molding': PRESS, 'Pick and Place': LOADER };
// India labour by wage grade (memory/Assembly plastic molding/wage_grade_associations.csv: Multi-Shot Molding 5 - Plastic, Pick and Place
// 2 - Plastic). 2 - Plastic: the 1.57 USD/hr India rows of that grade carry (migration 1075). 5 - Plastic has no India rate anywhere: the India
// 3 - Plastic rate (1.65) scaled by the USA ratio of the grades (5 - Plastic 45.81 / 3 - Plastic 35.12) = 2.15 USD/hr.
const INDIA_GRADE_RATE = { '5 - Plastic': 2.15, '2 - Plastic': 1.57 };
// The USA machine file's name for each India name that differs (one typo in the USA file is fixed instead: see USA_RENAME).
const INDIA_NAME_TO_USA = { 'Espon Flexion N2 - 780mm': 'Epson Flexion N2 - 780mm', 'Fanuc SR-6ia SCARA - 650mm': 'Fanuc SR-6ia - 650mm' };
// The USA molder file writes 1060g for the 2900kN rotary stack press; its accounting file, the India export (maxShotSize 1860, stroke volume
// 1,860,000 mm3) say 1860g.
const USA_RENAME = {
  'Horizontal Injection Molder | 2900kN | 2K | 1060g | 4 Station | Rotary Stack': 'Horizontal Injection Molder | 2900kN | 2K | 1860g | 4 Station | Rotary Stack',
};
const KN_PER_TONNE = 9.80665;

const grades = Object.fromEntries(readCsv(join(MEMORY, 'Assembly plastic molding/wage_grade_associations.csv')).rows
  .map((r) => [String(r['Process Name'] ?? r['﻿Process Name']).replace(/^﻿/, ''), r['Wage Grade Name']]));
const num = (v) => { const n = Number(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : null; };
const cents = (v) => Math.round((num(v) ?? 0) * 100) / 100;
const q = (s) => `$str$${s}$str$`;
const sqlNum = (v) => (v == null ? 'NULL' : String(Math.round(v * 1000) / 1000));

const india = readCsv(join(MEMORY, 'Countries data/India_XML_Data_.csv')).rows
  .filter((r) => r['Commodity'] === 'Assembly Plastic Molding')
  .map((r) => ({ ...r, name: INDIA_NAME_TO_USA[r['name']] ?? r['name'] }));

/** What the press name says: "Orientation | clamp kN | nK | shot | n Station | Rotary Stack | table mm". */
function fromName(name) {
  const parts = name.split('|').map((s) => s.trim());
  const units = Number((parts.find((p) => /^\d+K$/.test(p)) ?? '').replace('K', ''));
  const shot = parts.find((p) => /^[\d.]+k?g$/.test(p)) ?? '';
  const stations = Number((parts.find((p) => /Station$/.test(p)) ?? '1').replace(/\D/g, ''));
  return {
    orientation: parts[0].split(' ')[0],
    units, stations,
    shotG: shot.endsWith('kg') ? Number(shot.replace('kg', '')) * 1000 : Number(shot.replace('g', '')),
    rotatingStack: parts.includes('Rotary Stack'),
    tableMm: (() => { const t = parts.find((p) => /^\d+mm$/.test(p)); return t ? Number(t.replace('mm', '')) : null; })(),
  };
}

const presses = india.filter((r) => r['Machine Type'] === 'Multi-Shot Molding').map((r) => {
  const n = fromName(r.name);
  const a = {
    name: r.name,
    units: num(r['numInjectionBarrels']), stations: num(r['numMoldStations']), rotatingStack: String(r['rotatingStackPlaten']).toUpperCase() === 'TRUE',
    orientation: r['orientation'], indexS: num(r['toolIndexTime']), shotG: num(r['maxShotSize']), clampKn: num(r['clampForce']),
    dryCycleS: num(r['dryCycleTime']), minMoldMm: num(r['minMoldHeight']), maxMoldMm: num(r['maxMoldHeight']),
    tieBarH: num(r['tieBarDistanceH']), tieBarV: num(r['tieBarDistanceV']), injectionRate: num(r['maxInjectionRate']), tableMm: n.tableMm,
  };
  // The name and the columns must agree: a press is only what both say it is.
  const bad = [
    a.units !== n.units && `units ${a.units} vs ${n.units}`, a.stations !== n.stations && `stations ${a.stations} vs ${n.stations}`,
    a.rotatingStack !== n.rotatingStack && 'rotating stack', a.orientation !== n.orientation && `orientation ${a.orientation} vs ${n.orientation}`,
    a.shotG !== n.shotG && `shot ${a.shotG} vs ${n.shotG}`,
  ].filter(Boolean);
  if (bad.length) throw new Error(`${r.name}: the India columns and the name disagree (${bad.join(', ')})`);
  return a;
}).sort((x, y) => x.name.localeCompare(y.name));

const twins = india.map((r) => {
  const process = r['Machine Type'];
  const cls = CLASS[process];
  if (!cls) throw new Error(`no machine class for ${process}`);
  const labour = INDIA_GRADE_RATE[grades[process]];
  if (labour == null) throw new Error(`no India rate for wage grade ${grades[process]} (${process})`);
  return { cls, name: r.name, labour, direct: cents(r['customWorkCenterDirectOverheadRate']), indirect: cents(r['customWorkCenterIndirectOverheadRate']), key: `${process}:${r.name}:India` };
}).sort((a, b) => (a.cls + a.name).localeCompare(b.cls + b.name));

const count = (cls) => twins.filter((t) => t.cls === cls).length;

const sql = `-- ============================================================================
-- Migration 1085: the Assembly Plastic Molding machines -- India twins and the multi-shot press attributes
-- ============================================================================
-- Generated by scripts/generate-assembly-plastic-molding-machines-migration.js; re-run it and diff instead of editing.
--
-- Migration 862 seeded the Assembly Plastic Molding machines (memory/Assembly plastic molding/Machines) for the USA only, and that export
-- dropped what makes a multi-shot press one: its injection units, mold stations, rotating stack, tool index time and shot size are only in the
-- machine name, its typed press columns (clamp, shot, dry cycle, mold heights, tie bars) are empty. So no multi-shot press could be sized,
-- timed or chosen, and a part priced in India had none at all.
--
-- 1. USA: the 2900kN rotary stack press is renamed 1060g -> 1860g (its accounting file and the India export say 1860g).
-- 2. India: memory/Countries data/India_XML_Data_.csv, commodity "Assembly Plastic Molding": each machine on its USA twin (same class, exact
--    name; the export spells two loaders differently: ${Object.entries(INDIA_NAME_TO_USA).map(([a, b]) => `"${a}" is "${b}"`).join(', ')}),
--    with the export's direct and indirect overhead (USD/hr, to cents). Labour: the India rate of the process's wage grade
--    (wage_grade_associations.csv: Multi-Shot Molding 5 - Plastic, Pick and Place 2 - Plastic): 2 - Plastic 1.57 USD/hr (the rate India rows
--    of that grade carry); 5 - Plastic has no India rate anywhere, so 2.15 USD/hr = India 3 - Plastic 1.65 x the USA ratio of the grades
--    (45.81 / 35.12). Written to usd_labor_rate_per_hr AND usd_lhr_total (migration 1061).
--      Multi-Shot Molding  ${count(PRESS)} press(es)
--      Pick and Place      ${count(LOADER)} loader(s)
-- 3. The press attributes, from the India export's columns (checked against each name), on both locations' rows by machine name:
--    typed columns max_tonnage = clampForce kN / ${KN_PER_TONNE}, shot_capacity_grams = maxShotSize (per injection unit, GPPS grams),
--    press_cycle_time_s = dryCycleTime, min/max_mold_height_mm, tie_bar_x/y_mm; specs injection_units, stations, rotating_stack,
--    orientation, tool_index_time_s, injection_rate_mm3_per_s, table_diameter_mm.
-- 4. The loaders' specs get loading and max_payload (from loading_type and max_payload_kg), the keys the insert loading code reads.
--
-- Idempotent: the rename and the twins are skipped when done; the attributes are re-set to the same values.
-- Verify: SELECT location, machine_class, count(*), count(max_tonnage), count(specs->'injection_units')
--           FROM mhr_records WHERE machine_class LIKE 'assembly_plastic_molding%' GROUP BY 1, 2 ORDER BY 1, 2;
-- ============================================================================

-- 1. The USA typo.
${Object.entries(USA_RENAME).map(([from, to]) => `UPDATE mhr_records SET machine_name = ${q(to)}, updated_at = now()
 WHERE location = 'USA' AND machine_class = '${PRESS}' AND machine_name = ${q(from)}
   AND NOT EXISTS (SELECT 1 FROM mhr_records x WHERE x.location = 'USA' AND x.machine_class = '${PRESS}' AND x.machine_name = ${q(to)});`).join('\n')}

-- 2. The India twins.
DO $apm_machines$
DECLARE
  cols text; sel text; r record; src_id uuid; n integer := 0; missing text[] := '{}';
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
        WHEN 'usd_labor_rate_per_hr'                   THEN '$4'
        WHEN 'usd_lhr_total'                           THEN '$4'
        WHEN 'benchmark_labor_rate_usd_hr'             THEN '$4'
        WHEN 'benchmark_source_key'                    THEN '$5'
        WHEN 'id'                                      THEN 'gen_random_uuid()'
        WHEN 'created_at'                              THEN 'now()'
        WHEN 'updated_at'                              THEN 'now()'
        ELSE 'src.' || quote_ident(c.column_name)
      END, ', ' ORDER BY c.ordinal_position
    )
  INTO cols, sel
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'mhr_records' AND c.is_generated = 'NEVER';

  -- (class, name, labour, direct, indirect, source key)
  FOR r IN SELECT * FROM (VALUES
${twins.map((v) => `  (${q(v.cls)}, ${q(v.name)}, ${v.labour}, ${v.direct}, ${v.indirect}, ${q(v.key)})`).join(',\n')}
  ) AS v(machine_class, machine_name, labor, direct, indirect, source_key)
  LOOP
    SELECT id INTO src_id FROM mhr_records WHERE location = 'USA' AND machine_class = r.machine_class AND machine_name = r.machine_name LIMIT 1;
    IF src_id IS NULL THEN
      missing := array_append(missing, r.machine_class || ':' || r.machine_name);
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM mhr_records m WHERE m.location = 'India' AND m.machine_class = r.machine_class AND m.machine_name = r.machine_name) THEN
      CONTINUE;
    END IF;
    EXECUTE format('INSERT INTO mhr_records (%s) SELECT %s FROM mhr_records src WHERE src.id = $1', cols, sel)
      USING src_id, r.direct, r.indirect, r.labor, r.source_key;
    n := n + 1;
  END LOOP;

  RAISE NOTICE 'Assembly Plastic Molding India rows inserted: %', n;
  IF array_length(missing, 1) > 0 THEN
    RAISE EXCEPTION 'Assembly Plastic Molding rows with no USA twin: %', missing;
  END IF;
END $apm_machines$;

-- 3. The multi-shot press attributes (both locations, by name).
UPDATE mhr_records m SET
  max_tonnage = ROUND((v.clamp_kn / ${KN_PER_TONNE})::numeric, 2),
  shot_capacity_grams = v.shot_g,
  press_cycle_time_s = v.dry_cycle_s,
  min_mold_height_mm = v.min_mold_mm,
  max_mold_height_mm = v.max_mold_mm,
  tie_bar_x_mm = v.tie_bar_h,
  tie_bar_y_mm = v.tie_bar_v,
  specs = COALESCE(m.specs, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'injection_units', v.units, 'stations', v.stations, 'rotating_stack', v.rotating_stack, 'orientation', v.orientation,
    'tool_index_time_s', v.index_s, 'injection_rate_mm3_per_s', v.injection_rate, 'table_diameter_mm', v.table_mm)),
  updated_at = now()
FROM (VALUES
${presses.map((p) => `  (${q(p.name)}, ${sqlNum(p.clampKn)}, ${sqlNum(p.shotG)}, ${sqlNum(p.dryCycleS)}, ${sqlNum(p.minMoldMm)}, ${sqlNum(p.maxMoldMm)}, ${sqlNum(p.tieBarH)}, ${sqlNum(p.tieBarV)}, ${p.units}, ${p.stations}, ${p.rotatingStack}, ${q(p.orientation)}, ${sqlNum(p.indexS)}, ${sqlNum(p.injectionRate)}, ${sqlNum(p.tableMm)})`).join(',\n')}
) AS v(machine_name, clamp_kn, shot_g, dry_cycle_s, min_mold_mm, max_mold_mm, tie_bar_h, tie_bar_v, units, stations, rotating_stack, orientation, index_s, injection_rate, table_mm)
WHERE m.machine_class = '${PRESS}' AND m.machine_name = v.machine_name;

-- 4. The loaders: the keys the insert loading code reads (sand-machines machineText 'loading', machineValue 'max_payload').
UPDATE mhr_records SET
  specs = specs || jsonb_strip_nulls(jsonb_build_object('loading', specs->>'loading_type', 'max_payload', (specs->>'max_payload_kg')::numeric)),
  updated_at = now()
WHERE machine_class = '${LOADER}' AND specs ? 'loading_type';

DO $apm_check$
DECLARE bare integer;
BEGIN
  SELECT count(*) INTO bare FROM mhr_records WHERE machine_class = '${PRESS}' AND (max_tonnage IS NULL OR shot_capacity_grams IS NULL OR NOT specs ? 'injection_units');
  IF bare > 0 THEN RAISE EXCEPTION 'Assembly Plastic Molding: % multi-shot press row(s) still have no press attributes', bare; END IF;
END $apm_check$;

NOTIFY pgrst, 'reload schema';
`;
writeFileSync(OUT, sql);
console.log(`wrote ${OUT} (${count(PRESS)} presses + ${count(LOADER)} loaders for India; ${presses.length} press attribute rows)`);
