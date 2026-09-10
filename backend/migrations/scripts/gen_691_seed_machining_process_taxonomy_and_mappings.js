// Generator: wires real Machining process/operation data into the live
// Process Calculator Mappings page (process_taxonomy + process_taxonomy_
// operations + process_calculator_mappings), closing the gap migration 613
// deliberately left open ("Machining's 43 station names already exist
// correctly in process_taxonomy... a real route/calculator model for them
// is a separate, later task, not invented in this migration").
//
// That later task is enabled now: memory/machining/processes.json (43 real
// station names) and memory/machining/operations_full.json (1174 real
// "<Station>:<Operation>//<FeatureType>" compound strings) are fully
// staged (migrations 689/690) and every one of the 1174 real operations'
// station prefix matches one of the 43 real station names exactly
// (verified directly, zero unmatched) -- this is the real, sourced
// process/operation identity Machining was missing, not a fabricated
// grouping like the old migration 024 seed's invented "Turning Center" /
// "Drilling" route buckets (deleted for exactly that reason by migration
// 613).
//
// Design, matching how Sheet Metal's own routes work today (post
// migrations 418/419/615: each Sheet Metal process_calculator_mappings
// row is self-referential, process_route === operation, e.g. "Laser Cut" /
// "Laser Cut" -- confirmed live, matches the current Process page's 22-row
// Sheet Metal count exactly):
//
//   1. process_taxonomy: 43 canonical rows, process_group='Machining',
//      process_name = station name, default_machine_name/
//      default_tool_shop_name from processes.json, roadmap_status=
//      'not_modeled' (no cost-engine linkage claimed at this taxonomy
//      layer -- cost-cnc-engine.ts is a real, separately-consumed engine,
//      a different architecture layer per CLAUDE.md's platform mandate,
//      not wired to this process picker).
//
//   2. process_taxonomy_operations: 1174 real operation/feature-type
//      children, parsed from operations_full.json's raw compound strings
//      via the SAME parseCompoundOperationString logic migration 609's
//      generator used for Sheet Metal/Injection Molding/the original
//      (later deleted) Machining pass -- these surface on the Process page
//      as each row's "detailed specifications" (processes.service.ts's
//      getTaxonomyForMappings -> ProcessTaxonomyHint.operations).
//
//   3. process_calculator_mappings: 43 new rows, one per station,
//      process_route = operation = station name (self-referential,
//      matching Sheet Metal's live convention), calculator_id/
//      calculator_name left NULL (genuinely unwired -- no calculator has
//      been built against this taxonomy layer yet, matches roadmap_status).
//      is_active = false: the live chk_machine_class_required constraint
//      (migration 369, tightened 617) rejects any ACTIVE row with
//      machine_class IS NULL unless it matches one of 3 named non-machine
//      exemptions (Raw Material / Material Usage / Packing & Delivery /
//      General-General) -- none apply to a real machine station, and per
//      migration 617's own stated discipline ("not a reason to fabricate a
//      fake machine_class just to satisfy the check"), these 43 rows get
//      is_active=false rather than an invented machine_class. Same
//      treatment Sheet Metal's own "Plasma Cut" row already gets
//      (migration 617) for the identical reason -- still counted in the
//      page's per-group row total, still fully inspectable (real
//      operation/feature-type detail via process_taxonomy_operations),
//      just visually marked not-yet-wired instead of selectable.
//      canonical_process_id resolved via the same taxonomy join pattern
//      migration 609 used for operation children.
//
// NOT a duplicate of cost-cnc-engine.ts's own real, tested CNC costing
// (43 tests, live-wired per this repo's CLAUDE.md) -- that engine
// operates on extracted CAD features (holes/pockets/slots/tool changes),
// a different layer entirely. This migration only makes the real
// station/operation taxonomy selectable and inspectable on the Process
// page, same as Sheet Metal's and Injection Molding's own taxonomy rows
// already are -- it does not attach a calculator to anything, honestly
// reflecting the real current gap (roadmap_status='not_modeled',
// calculator_id=NULL) rather than fabricating a wiring that doesn't exist.
//
// organization_id (migration 625) intentionally omitted from every INSERT
// below -- defaults to NULL, i.e. globally shared catalog data, same as
// every other reference/taxonomy row this platform seeds via a migration
// (run with elevated DB privileges, not through the RLS-scoped app client
// whose INSERT policy requires a real org id).
//
// Offline, file-in/file-out -- matches every other gen_*.js in this codebase.

const fs = require('fs');
const path = require('path');

const PROC_FILE = path.join(__dirname, '../../../memory/machining/processes.json');
const OPS_FILE = path.join(__dirname, '../../../memory/machining/operations_full.json');
const OUT_SQL = path.join(__dirname, '../691_seed_machining_process_taxonomy_and_mappings.sql');

function sqlStr(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  return `$str$${String(v)}$str$`;
}

function parseCompoundOperationString(raw) {
  const segments = raw.split(':');
  const process = segments[0];
  const levels = segments.slice(1).map((seg) => {
    const slashIdx = seg.indexOf('//');
    return slashIdx === -1
      ? { operation: seg, feature: null }
      : { operation: seg.slice(0, slashIdx), feature: seg.slice(slashIdx + 2) };
  });
  const leaf = levels[levels.length - 1] || { operation: null, feature: null };
  return { process, operationCategory: leaf.operation, featureType: leaf.feature };
}

const procData = JSON.parse(fs.readFileSync(PROC_FILE, 'utf8'));
const opsData = JSON.parse(fs.readFileSync(OPS_FILE, 'utf8'));

const stations = procData.processes.map((p) => ({
  name: p.processName,
  defaultMachine: p.defaultMachine || null,
  defaultToolShop: p.defaultToolShopName || null,
}));

const operationRows = opsData.operations.map((o) => {
  const { process, operationCategory, featureType } = parseCompoundOperationString(o.processName);
  return { station: process, operationCategory, featureType, raw: o.processName };
});

// ---------------------------------------------------------------------------
// 1. process_taxonomy (43 canonical rows)
// ---------------------------------------------------------------------------
const taxonomyValuesSql = stations
  .map((s) => `('Machining', ${sqlStr(s.name)}, NULL, 'not_modeled', ${sqlStr(s.defaultMachine)}, ${sqlStr(s.defaultToolShop)})`)
  .join(',\n');

// ---------------------------------------------------------------------------
// 2. process_taxonomy_operations (1174 real operation children)
// ---------------------------------------------------------------------------
const operationsValuesSql = operationRows
  .map((r) => `(${sqlStr(r.station)}, ${sqlStr(r.operationCategory)}, ${sqlStr(r.featureType)}, ${sqlStr(r.raw)})`)
  .join(',\n');

// ---------------------------------------------------------------------------
// 3. process_calculator_mappings (43 self-referential rows, unwired)
// ---------------------------------------------------------------------------
const mappingValuesSql = stations
  .map((s, i) => `(${sqlStr(s.name)}, ${600 + i})`)
  .join(',\n');

const sql = `-- ============================================================================
-- Migration 691: Wire real Machining process/operation taxonomy into the
-- live Process Calculator Mappings page
--
-- Generated by gen_691_seed_machining_process_taxonomy_and_mappings.js.
-- ${stations.length} process_taxonomy rows, ${operationRows.length} process_taxonomy_operations
-- rows, ${stations.length} process_calculator_mappings rows (all currently
-- unwired: calculator_id/calculator_name NULL, is_active=false,
-- roadmap_status 'not_modeled' -- is_active=false because the live
-- chk_machine_class_required constraint (migration 369/617) rejects any
-- ACTIVE row with machine_class IS NULL that isn't one of 3 named
-- non-machine exemptions, and per migration 617's own discipline these
-- rows get is_active=false rather than an invented machine_class. Same
-- honest gap Sheet Metal's own "Plasma Cut" row already carries.).
--
-- Reverses migration 613's deliberate Machining exclusion from this page,
-- now that memory/machining/processes.json (migration 689) and
-- operations_full.json (migration 690) give a real, sourced process/
-- operation identity to build it from -- see generator script header for
-- full detail.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- process_taxonomy: ${stations.length} Machining station canonical rows
-- ----------------------------------------------------------------------------
INSERT INTO process_taxonomy (process_group, process_name, machine_class, roadmap_status, default_machine_name, default_tool_shop_name)
VALUES
${taxonomyValuesSql}
ON CONFLICT (process_group, process_name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- process_taxonomy_operations: ${operationRows.length} real operation/feature-type children
-- ----------------------------------------------------------------------------
INSERT INTO process_taxonomy_operations (canonical_process_id, operation_category, feature_type, raw_compound_string)
SELECT pt.id, v.operation_category, v.feature_type, v.raw
FROM process_taxonomy pt
JOIN (VALUES
${operationsValuesSql}
) AS v(process_name, operation_category, feature_type, raw)
  ON pt.process_group = 'Machining' AND pt.process_name = v.process_name
ON CONFLICT (canonical_process_id, raw_compound_string) DO NOTHING;

-- ----------------------------------------------------------------------------
-- process_calculator_mappings: ${stations.length} self-referential rows
-- (process_route = operation = station name, matching Sheet Metal's own
-- live convention), is_active=false (chk_machine_class_required has no
-- exemption for a real machine station with no machine_class yet -- see
-- generator header), canonical_process_id resolved via the taxonomy join
-- ----------------------------------------------------------------------------
INSERT INTO process_calculator_mappings (process_group, process_route, operation, calculator_id, calculator_name, is_active, display_order, canonical_process_id)
SELECT 'Machining', v.station, v.station, NULL, NULL, false, v.display_order, pt.id
FROM process_taxonomy pt
JOIN (VALUES
${mappingValuesSql}
) AS v(station, display_order) ON pt.process_group = 'Machining' AND pt.process_name = v.station
ON CONFLICT (process_group, process_route, operation) DO NOTHING;

COMMIT;

-- Verification (run manually after):
-- SELECT process_group, count(*) FROM process_calculator_mappings GROUP BY process_group ORDER BY process_group;
-- -- Expect: Injection Molding 4, Sheet Metal 22, Machining ${stations.length}.
-- SELECT pt.process_name, count(o.id) AS operations FROM process_taxonomy pt
--   LEFT JOIN process_taxonomy_operations o ON o.canonical_process_id = pt.id
--   WHERE pt.process_group = 'Machining' GROUP BY pt.id, pt.process_name ORDER BY operations DESC;
-- -- Expect ${operationRows.length} operations total across ${stations.length} stations.
-- SELECT count(*) FROM process_calculator_mappings WHERE process_group = 'Machining' AND canonical_process_id IS NULL; -- expect 0
`;

fs.writeFileSync(OUT_SQL, sql, 'utf8');
console.log(`Wrote ${stations.length} taxonomy rows, ${operationRows.length} operation children, ${stations.length} mapping rows to ${OUT_SQL}`);
