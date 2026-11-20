/**
 * Writes migration 1089 (the Bar and Tube Fabrication machines at India rates, and the Circular Saw machines) from memory/Countries data:
 *   node scripts/generate-bar-tube-machines-migration.js
 * Each India row is its USA twin (migration 862, same machine class and exact name) with the India export's direct and indirect overhead rates
 * and the India rate of the process's wage grade (memory/Bar and tube fab/wage_grade_associations.csv). Circular Saw has no USA machine file;
 * see the migration header.
 */
const { writeFileSync } = require('fs');
const { join } = require('path');
const { readCsv } = require('../migrations/scripts/lib/memory-machine-seed.js');

const MEMORY = join(__dirname, '../../memory');
const OUT = join(__dirname, '../migrations/1089_bar_tube_machines_india_and_circular_saw.sql');
const GROUP = 'Bar and Tube Fabrication';

// The export's machine type -> the process (wage grade file) and the machine class migration 862 gave it.
const TYPE = {
  '2 Roll Bending': '2 Roll Bending', '3 Roll Bending': '3 Roll Bending', '4 Roll Bending': '4 Roll Bending', BandSawing: 'Band Saw',
  'Bar Bend Brake': 'Bar Bend Brake', BarPunching: 'Punching', 'Billet Preheat': 'Billet Preheat', CircularSawing: 'Circular Saw',
  CompressionBending: 'Compression Bending', 'Die Preheat': 'Die Preheat', Expansion: 'Expansion', Extrusion: 'Extrusion', Flanging: 'Flanging',
  Flaring: 'Flaring', Flattening: 'Flattening', Forming: 'Bar Forming', Knurling: 'Knurling', 'Material Stock': 'Material Stock', Notching: 'Notching',
  'Oxyfuel Torch Cut': 'Oxyfuel Torch Cut', 'Plasma CNC Cut': 'Plasma CNC Cut', 'Plasma Torch Cut': 'Plasma Torch Cut', 'Profile 3 Roll Bend': 'Profile 3 Roll Bend',
  'Profile CNC Bend': 'Profile CNC Bend', ReciprocatingSawing: 'Reciprocating Saw', Reduction: 'Reduction', RotaryDrawBending: 'Rotary Draw Bending',
  Shearing: 'Shear', 'Sheet Laser Cut': 'Sheet Laser Cut', 'Sheet OxyFuel Cut': 'Sheet OxyFuel Cut', 'Sheet Plasma Cut': 'Sheet Plasma Cut',
  'Sheet Stock': 'Sheet Stock', Slotting: 'Slotting', 'Tube Laser': 'Tube Laser',
};
// Export names that differ from the USA machine file's name for the same machine: the file's spelling is kept.
const SAME_MACHINE = { 'Criterion P-D-2B 76': 'Criterion P-D-28 76' };
const classOf = (process) => `bar_tube_fab_${process.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;

// The India labour rate of each Metal wage grade (USD/hr): the value the India rows of that grade already carry in HR Rates
// (SELECT wage_grade, DISTINCT usd_labor_rate_per_hr FROM mhr_records WHERE location = 'India' AND wage_grade LIKE '% - Metal').
const INDIA_LABOUR = { '0 - Metal': 0, '1 - Metal': 1.57, '2 - Metal': 1.65, '3 - Metal': 1.73, '4 - Metal': 2.3, '5 - Metal': 2.75 };
// The USA labour of grade 2 - Metal, the Circular Saw's grade: what the 862 rows of that grade carry (their files' Labor Rate).
const USA_LABOUR_GRADE_2 = 30.49;

const grade = {};
for (const g of readCsv(join(MEMORY, 'Bar and tube fab/wage_grade_associations.csv')).rows) grade[g['Process Name']] = g['Wage Grade Name'];
const num = (v) => { const n = Number(String(v).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const q = (s) => `$str$${s}$str$`;
const exportRows = (file) => readCsv(join(MEMORY, `Countries data/${file}`)).rows.filter((r) => r['Commodity'] === 'Bar & Tube Fab');

const india = exportRows('India_XML_Data_.csv').map((r) => {
  const process = TYPE[r['Machine Type']];
  if (!process) throw new Error(`no process for machine type ${r['Machine Type']}`);
  const g = grade[process];
  if (!(g in INDIA_LABOUR)) throw new Error(`${process}: no India labour for wage grade ${g}`);
  return { process, cls: classOf(process), name: SAME_MACHINE[r['name']] ?? r['name'], direct: num(r['customWorkCenterDirectOverheadRate']), indirect: num(r['customWorkCenterIndirectOverheadRate']), labour: INDIA_LABOUR[g], row: r };
}).sort((a, b) => (a.cls + a.name).localeCompare(b.cls + b.name));
const twins = india.filter((r) => r.process !== 'Circular Saw');
const byProcess = {};
for (const r of twins) byProcess[r.process] = (byProcess[r.process] ?? 0) + 1;

// Circular Saw: no machine file in memory/Bar and tube fab (its default machine, Behringer PSU-450-A, is named in processes_default_machines.csv).
const nl = exportRows('Netherlands_XML_Data_.csv').filter((r) => r['Machine Type'] === 'CircularSawing');
const circular = india.filter((r) => r.process === 'Circular Saw').map((r) => {
  const usa = nl.find((x) => x['name'] === r.name);
  if (!usa) throw new Error(`${r.name} is not in the Netherlands export`);
  const s = r.row;
  const spec = {
    price: num(s['machinePrice']), length: Number(s['machineLength']), width: Number(s['machineWidth']), power: Number(s['machinePower']), life: Number(s['machineLife']),
    operators: Number(s['numOperators']), footprint: Number(s['footprintAllowanceFactor']), setup: Number(s['setupTime']), lts: Number(s['laborTimeStandard']),
    specs: {
      source: 'memory/Countries data (CircularSawing; USA rates from the Netherlands export, see migration 1089)', process: 'Circular Saw',
      is_preferred: String(s['isPreferred']).toUpperCase() === 'TRUE', axial_feed_rate_mm_per_s: Number(s['axialFeedRate']),
      load_plus_unload_time_s: Number(s['loadTime']), unload_time_s: Number(s['unloadTime']), max_cut_angle_deg: Number(s['maxCutAngle']),
      max_stock_diameter_mm: Number(s['maxStockDiameter']), max_stock_height_mm: Number(s['maxStockHeight']), max_stock_width_mm: Number(s['maxStockWidth']),
      machine_life_yr: Number(s['machineLife']), installation_factor_pct: Number(s['installationFactor']) * 100,
      annual_maintenance_factor_pct: Number(s['annualMaintenanceFactor']) * 100, machine_uptime_pct: Number(s['machineUptime']) * 100,
    },
  };
  return { name: r.name, india: { direct: r.direct, indirect: r.indirect }, usa: { direct: num(usa['customWorkCenterDirectOverheadRate']), indirect: num(usa['customWorkCenterIndirectOverheadRate']) }, spec };
});
if (circular.length === 0) throw new Error('no CircularSawing rows in the India export');

const row = (src, loc, cc, cls, name, labour, direct, indirect, key, s) => `  (${q('bar_tube_fab_band_saw')}, ${src}, '${loc}', '${cc}', ${q(cls)}, ${q(name)}, ${labour}, ${direct}, ${indirect}, ${q(key)}, ${s ? `${s.price}, ${s.length}, ${s.width}, ${s.power}, ${s.operators}, ${s.footprint}, ${s.setup}, ${s.life}, ${s.lts}, ${q(JSON.stringify(s.specs))}::jsonb` : 'NULL::numeric, NULL::integer, NULL::integer, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::jsonb'})`;

const sql = `-- ============================================================================
-- Migration 1089: Bar and Tube Fabrication machines at India rates, and the Circular Saw machines
-- ============================================================================
-- Generated by scripts/generate-bar-tube-machines-migration.js; re-run it and diff instead of editing.
--
-- Migration 862 seeded the ${twins.length} Bar and Tube machines for the USA only, so a bar or tube part priced in India had no machine on any step;
-- and no Circular Saw machine anywhere (memory/Bar and tube fab has no file for it), so a round tube or bar could not be cut on the process the
-- reference data routes it to (lookup saw_routing_evaluation).
--
-- India twins. Source: memory/Countries data/India_XML_Data_.csv, commodity "Bar & Tube Fab": each machine's direct and indirect overhead rate
-- (USD/hr, rounded to cents). Labour: the India rate of the process's wage grade (memory/Bar and tube fab/wage_grade_associations.csv:
-- 0 - Metal 0, 1 - Metal 1.57, 2 - Metal 1.65, 3 - Metal 1.73, 4 - Metal 2.30, 5 - Metal 2.75 USD/hr, the values the India rows of each grade
-- already carry), written to usd_labor_rate_per_hr AND usd_lhr_total (the column the machine selector reads; migration 1061 had to repair twins
-- that kept the USA value there). ${twins.length} machines, each matched by machine class and exact name to its USA row (the export's
-- "Criterion P-D-2B 76" is the file's "Criterion P-D-28 76", an 8 read as a B; the file's name is kept):
${Object.entries(byProcess).sort().map(([p, n]) => `--   ${p.padEnd(22)}${n} machine(s)`).join('\n')}
--
-- Circular Saw: the ${circular.length} machines of the exports (CircularSawing), class bar_tube_fab_circular_saw, grade 2 - Metal. India: the India export's
-- rates. USA: there is no USA export (the USA rates are the machine files'); the Netherlands export's rates stand in, as migrations 1070 and
-- 1075 did: on the Bar and Tube machines both have, their totals are the USA files' within about 1 to 3 % (Pines Model 1: USA 5.24 + 15.15,
-- Netherlands 6.03 + 14.85 USD/hr; DoAll 3613-1 Vert: USA 1.60 + 15.13, Netherlands 1.86 + 14.84). Labour ${USA_LABOUR_GRADE_2} USD/hr (USA), 1.65 (India).
-- Each row is cloned from a USA band saw (the same group, grade and source columns) with the saw's own price, size, power, setup and specs.
--
-- Idempotent: a row already present for a location + machine_class + machine_name is skipped.
-- Verify: SELECT location, count(*) FROM mhr_records WHERE process_group = '${GROUP}' GROUP BY 1;
--   -- expect USA ${twins.length + circular.length}, India ${twins.length + circular.length}.
-- ============================================================================

DO $bar_tube_machines$
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
        WHEN 'machine_life_yr'                         THEN 'COALESCE($17, src.machine_life_yr)'
        WHEN 'labor_time_standard'                     THEN 'COALESCE($18, src.labor_time_standard)'
        WHEN 'specs'                                   THEN 'COALESCE($19, src.specs)'
        WHEN 'id'                                      THEN 'gen_random_uuid()'
        WHEN 'created_at'                              THEN 'now()'
        WHEN 'updated_at'                              THEN 'now()'
        ELSE 'src.' || quote_ident(c.column_name)
      END, ', ' ORDER BY c.ordinal_position
    )
  INTO cols, sel
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'mhr_records' AND c.is_generated = 'NEVER';

  -- (circular-saw source class, source name (NULL: the twin's own USA row), location, country, class, name, labour, direct, indirect, source key,
  --  the Circular Saw's own values or NULL)
  FOR r IN SELECT * FROM (VALUES
${[
  ...twins.map((t) => row('NULL::text', 'India', 'IN', t.cls, t.name, t.labour, t.direct, t.indirect, `${t.process}:${t.name}:India`, null)),
  ...circular.flatMap((c) => [
    row(q('DoAll 3613-1 Vert'), 'USA', 'US', 'bar_tube_fab_circular_saw', c.name, USA_LABOUR_GRADE_2, c.usa.direct, c.usa.indirect, `Circular Saw:${c.name}`, c.spec),
    row(q('DoAll 3613-1 Vert'), 'India', 'IN', 'bar_tube_fab_circular_saw', c.name, INDIA_LABOUR['2 - Metal'], c.india.direct, c.india.indirect, `Circular Saw:${c.name}:India`, c.spec),
  ]),
].join(',\n')}
  ) AS v(src_class, src_name, location, country, machine_class, machine_name, labor, direct, indirect, source_key, price, length_mm, width_mm, power_kw, operators, footprint, setup_hr, life_yr, lts, specs)
  LOOP
    SELECT id INTO src_id FROM mhr_records
    WHERE process_group = '${GROUP}' AND location = 'USA'
      AND machine_class = CASE WHEN r.src_name IS NULL THEN r.machine_class ELSE r.src_class END
      AND machine_name = COALESCE(r.src_name, r.machine_name)
    LIMIT 1;
    IF src_id IS NULL THEN
      missing := array_append(missing, r.machine_class || ':' || r.machine_name);
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM mhr_records m WHERE m.location = r.location AND m.machine_class = r.machine_class AND m.machine_name = r.machine_name) THEN
      CONTINUE;
    END IF;
    EXECUTE format(
      'INSERT INTO mhr_records (%s) SELECT %s FROM mhr_records src WHERE src.id = $1',
      cols, sel
    ) USING src_id, r.direct, r.indirect, r.labor, r.location, r.country, r.machine_class, r.machine_name, r.source_key,
            r.price, r.length_mm, r.width_mm, r.power_kw, r.operators, r.footprint, r.setup_hr, r.life_yr, r.lts, r.specs;
    n := n + 1;
  END LOOP;

  RAISE NOTICE 'Bar and Tube Fabrication rows inserted: %', n;
  IF array_length(missing, 1) > 0 THEN
    RAISE NOTICE 'Bar and Tube Fabrication rows with no USA source row (not inserted): %', missing;
  END IF;
END $bar_tube_machines$;

NOTIFY pgrst, 'reload schema';
`;
writeFileSync(OUT, sql);
console.log(`wrote ${OUT} (${twins.length} India twins + ${circular.length} Circular Saws at USA and India)`);
