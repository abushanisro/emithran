/**
 * Writes migration 1103 (the Rapid Prototyping machines: their specs under the keys the additive engine reads, their lasers' cost per hour,
 * and their twins at India rates) from memory/Rapid prototyping and memory/Countries data:
 *   node scripts/generate-rapid-prototyping-machines-migration.js
 * Each India row is its USA twin (migration 862, same machine class and exact name) with the India direct and indirect overhead rates of the
 * export and the India rate of the processes' wage grade (memory/Rapid prototyping/wage_grade_associations: every process 2 - Metal).
 */
const { writeFileSync } = require('fs');
const { join } = require('path');
const { readCsv } = require('../migrations/scripts/lib/memory-machine-seed.js');

const MEMORY = join(__dirname, '../../memory');
const RP = join(MEMORY, 'Rapid prototyping');
const OUT = join(__dirname, '../migrations/1103_rapid_prototyping_machines.sql');

// The machine class migration 862 gave each Rapid Prototyping process.
const CLASS = {
  'Laser Sintering': 'rapid_prototyping_laser_sintering', Printing: 'rapid_prototyping_printing', 'Resin Curing': 'rapid_prototyping_resin_curing',
  'Part Curing': 'rapid_prototyping_part_curing', Cleaning: 'rapid_prototyping_cleaning',
};
// The India labour rate of wage grade 2 - Metal (USD/hr): the value the India rows of that grade already carry in HR Rates
// (SELECT DISTINCT usd_labor_rate_per_hr FROM mhr_records WHERE location = 'India' AND wage_grade = '2 - Metal').
const INDIA_LABOUR = 1.65;

for (const g of readCsv(join(RP, 'wage_grade_associations.csv')).rows) {
  if (CLASS[g['Process Name']] && g['Wage Grade Name'] !== '2 - Metal') throw new Error(`${g['Process Name']} is ${g['Wage Grade Name']}, not 2 - Metal`);
}
const num = (v) => { const n = Number(String(v).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const q = (s) => `$str$${s}$str$`;

// ── The specs: the keys migration 862 wrote from the Rapid Prototyping machine files, renamed to the ones the additive engine reads (the same
// columns of memory/Additive Manufacturing's files for the same machines), and each laser's cost per hour from the two lookups.
const RENAME = {
  rapid_prototyping_printing: { layer_speed: 'layer_speed_m_per_s', layer_thickness: 'layer_thickness_mm', scanning_speed: 'scanning_width_mm' },
  rapid_prototyping_resin_curing: { scanning_speed: 'scanning_speed_mm_per_s', wiper_speed: 'wiper_speed_mm_per_s' },
};
const laserRate = (file) => Object.fromEntries(readCsv(join(RP, `Lookup/${file}`)).rows.map((r) => [r['Machine'], Number(r['Laser Cost Per Hour (USD / hr)'])]));
const LASER = { rapid_prototyping_laser_sintering: laserRate('laser_cost_per_hour.csv'), rapid_prototyping_resin_curing: laserRate('laser_replacement.csv') };
const machineFiles = {
  rapid_prototyping_laser_sintering: 'machines_laser_sintering.csv', rapid_prototyping_printing: 'machines_printing.csv',
  rapid_prototyping_resin_curing: 'machines_resin_curing.csv', rapid_prototyping_part_curing: 'machines_part_curing.csv',
};
const specPatches = [];
for (const [cls, file] of Object.entries(machineFiles)) {
  for (const m of readCsv(join(RP, `Machines/${file}`)).rows) {
    const laser = LASER[cls]?.[m['Name']];
    if (LASER[cls] && !(laser > 0)) throw new Error(`${m['Name']}: no laser cost per hour in the lookups`);
    if (RENAME[cls] || laser) specPatches.push({ cls, name: m['Name'], rename: RENAME[cls] ?? {}, set: laser ? { laser_cost_per_hour_usd_per_hr: laser } : {} });
  }
}
// The machine files' flags, stored as JSON booleans whatever the import wrote ("TRUE", "false", true).
const FLAGS = ['can_use_laserform_materials', 'can_use_v_flash_material', 'can_cure_laserform_materials', 'requires_external_nitrogen', 'requires_nitrogen', 'is_preferred'];

// ── India twins ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const india = readCsv(join(MEMORY, 'Countries data/India_XML_Data_.csv')).rows.filter((r) => r['Commodity'] === 'Rapid Prototyping').map((r) => {
  const cls = CLASS[r['Machine Type']];
  if (!cls) throw new Error(`no machine class for ${r['Machine Type']}`);
  return { cls, name: r['name'], direct: num(r['customWorkCenterDirectOverheadRate']), indirect: num(r['customWorkCenterIndirectOverheadRate']), process: r['Machine Type'] };
}).sort((a, b) => (a.cls + a.name).localeCompare(b.cls + b.name));
const fileMachines = Object.values(machineFiles).reduce((n, file) => n + readCsv(join(RP, `Machines/${file}`)).rows.length, 0);
if (india.length !== fileMachines + 1) throw new Error(`India has ${india.length} Rapid Prototyping machines; the machine files ${fileMachines} + Default Cleaning`);
const byProcess = {};
for (const r of india) byProcess[r.process] = (byProcess[r.process] ?? 0) + 1;

const sql = `-- ============================================================================
-- Migration 1103: Rapid Prototyping machines -- their specs as the additive engine reads them, their lasers' cost, and India rates
-- ============================================================================
-- Generated by scripts/generate-rapid-prototyping-machines-migration.js; re-run it and diff instead of editing.
--
-- Rapid Prototyping is priced by the additive engine in its own domain (costing/additive/additive-domain.ts). Migration 862 seeded its 25
-- machines for the USA only, under the column names of memory/Rapid prototyping's machine files, which differ from the ones the engine reads
-- (and memory/Additive Manufacturing's files use) for the same machines:
--   Printing       layer_speed -> layer_speed_m_per_s, layer_thickness -> layer_thickness_mm, scanning_speed -> scanning_width_mm (the
--                  Rapid Prototyping file heads the column "Scanning Speed"; it is the print head's width: 185 mm on the ProJet CP3000, the
--                  value memory/Additive Manufacturing's file gives as "Scanning Width (mm)")
--   Resin Curing   scanning_speed -> scanning_speed_mm_per_s, wiper_speed -> wiper_speed_mm_per_s
-- Each laser's cost per hour (memory/Rapid prototyping/Lookup: laser_cost_per_hour for the sinterers, laser_replacement for the
-- stereolithography machines) is written as laser_cost_per_hour_usd_per_hr, and the machines' flags (${FLAGS.join(', ')}) as booleans.
--
-- India twins. Source: memory/Countries data/India_XML_Data_.csv, commodity "Rapid Prototyping": each machine's direct and indirect overhead
-- rate (USD/hr, rounded to cents). Labour: the India rate of wage grade 2 - Metal (every Rapid Prototyping process's grade,
-- memory/Rapid prototyping/wage_grade_associations), ${INDIA_LABOUR} USD/hr, the value the India rows of that grade already carry, written to
-- usd_labor_rate_per_hr AND usd_lhr_total (the column the machine selector reads). ${india.length} machines, each matched by machine class and exact
-- name to its USA row (whose specs, normalised above, it copies):
${Object.entries(byProcess).sort().map(([p, n]) => `--   ${p.padEnd(18)}${n} machine(s)`).join('\n')}
--
-- Idempotent: the spec renames keep a key already renamed; an India row already present for its class and name is skipped.
-- Verify: SELECT location, machine_class, count(*) FROM mhr_records WHERE machine_class LIKE 'rapid_prototyping_%' GROUP BY 1, 2 ORDER BY 1, 2;
--   -- expect USA ${india.length} rows (5 classes), India ${india.length} rows (5 classes).
-- ============================================================================

-- ── The specs ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
UPDATE mhr_records m SET
  specs = (
    SELECT COALESCE(jsonb_object_agg(COALESCE(p.rename ->> e.key, e.key), e.value), '{}'::jsonb)
    FROM jsonb_each(m.specs) e
    WHERE NOT (p.rename ? e.key AND m.specs ? (p.rename ->> e.key))
  ) || p.set_specs,
  updated_at = now()
FROM (VALUES
${specPatches.map((s) => `  (${q(s.cls)}, ${q(s.name)}, ${q(JSON.stringify(s.rename))}::jsonb, ${q(JSON.stringify(s.set))}::jsonb)`).join(',\n')}
) AS p(machine_class, machine_name, rename, set_specs)
WHERE m.machine_class = p.machine_class AND m.machine_name = p.machine_name AND m.specs IS NOT NULL;

UPDATE mhr_records m SET
  specs = m.specs || (
    SELECT jsonb_object_agg(f.key, to_jsonb(lower(m.specs ->> f.key) = 'true'))
    FROM unnest(ARRAY[${FLAGS.map(q).join(', ')}]) AS f(key)
    WHERE m.specs ? f.key
  ),
  updated_at = now()
WHERE m.machine_class LIKE 'rapid_prototyping_%' AND m.specs ?| ARRAY[${FLAGS.map(q).join(', ')}];

-- ── India twins ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $rapid_prototyping_machines$
DECLARE
  cols text; sel text; r record; usa_id uuid; n integer := 0; missing text[] := '{}';
BEGIN
  SELECT
    string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position),
    string_agg(
      CASE c.column_name
        WHEN 'location'                                THEN '$5'
        WHEN 'country_code'                            THEN '$6'
        WHEN 'direct_overhead_rate'                    THEN '$2'
        WHEN 'indirect_overhead_rate'                  THEN '$3'
        WHEN 'benchmark_direct_overhead_rate_usd_hr'   THEN '$2'
        WHEN 'benchmark_indirect_overhead_rate_usd_hr' THEN '$3'
        WHEN 'total_machine_hour_rate'                 THEN 'ROUND(($2 + $3)::numeric, 2)'
        WHEN 'mhr_usd_per_hour'                        THEN 'ROUND(($2 + $3)::numeric, 2)'
        WHEN 'usd_labor_rate_per_hr'                   THEN '$4'
        WHEN 'usd_lhr_total'                           THEN '$4'
        WHEN 'benchmark_labor_rate_usd_hr'             THEN '$4'
        WHEN 'benchmark_source_key'                    THEN '$7'
        WHEN 'id'                                      THEN 'gen_random_uuid()'
        WHEN 'created_at'                              THEN 'now()'
        WHEN 'updated_at'                              THEN 'now()'
        ELSE 'usa_row.' || quote_ident(c.column_name)
      END, ', ' ORDER BY c.ordinal_position
    )
  INTO cols, sel
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'mhr_records' AND c.is_generated = 'NEVER';

  -- (machine class, machine name, labour, direct, indirect, source key)
  FOR r IN SELECT * FROM (VALUES
${india.map((t) => `  (${q(t.cls)}, ${q(t.name)}, ${INDIA_LABOUR}, ${t.direct}, ${t.indirect}, ${q(`${t.process}:${t.name}:India`)})`).join(',\n')}
  ) AS v(machine_class, machine_name, labor, direct, indirect, source_key)
  LOOP
    SELECT id INTO usa_id FROM mhr_records
    WHERE location = 'USA' AND machine_class = r.machine_class AND machine_name = r.machine_name
    LIMIT 1;
    IF usa_id IS NULL THEN
      missing := array_append(missing, r.machine_class || ':' || r.machine_name);
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM mhr_records m WHERE m.location = 'India' AND m.machine_class = r.machine_class AND m.machine_name = r.machine_name) THEN
      CONTINUE;
    END IF;
    EXECUTE format('INSERT INTO mhr_records (%s) SELECT %s FROM mhr_records usa_row WHERE usa_row.id = $1', cols, sel)
      USING usa_id, r.direct, r.indirect, r.labor, 'India', 'IN', r.source_key;
    n := n + 1;
  END LOOP;

  RAISE NOTICE 'Rapid Prototyping India rows inserted: %', n;
  IF array_length(missing, 1) > 0 THEN
    RAISE EXCEPTION 'Rapid Prototyping machines with no USA row (migration 862): %', missing;
  END IF;
END $rapid_prototyping_machines$;

NOTIFY pgrst, 'reload schema';
`;
writeFileSync(OUT, sql);
console.log(`wrote ${OUT} (${specPatches.length} spec patches, ${india.length} India twins)`);
