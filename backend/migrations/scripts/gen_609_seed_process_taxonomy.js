// One-off generator for migration 609's seed data. Not part of the schema
// migration itself -- run manually to produce the SQL, inspect the diff,
// then commit. Same discipline as every other gen_*.js script (offline,
// file-in/file-out, no live DB credentials).
//
// SCHEMA: process_taxonomy is keyed by (process_group, process_name), with
// child table process_taxonomy_operations (operation_category, feature_type,
// raw_compound_string) -- column names deliberately match the vocabulary
// every one of the three source files already uses for a raw compound
// string "Process:OperationCategory//FeatureType"[":OperationCategory2//
// FeatureType2"...]. See migration 609's own header comment for the full
// rationale.
//
// GROUND TRUTH FOR CANONICAL IDENTITY: 609_live_process_calculator_mappings_
// snapshot.json, a verbatim transcription of the live Process Calculator
// Mappings page (270 originally-visible rows + 9 rows confirmed live via a
// direct LEFT JOIN query on 2026-09-01 that the page's rendered pill list
// didn't show -- see the snapshot file's own "_addendum" note). This
// supersedes memory/sheetmetal/process/structured/processes.json wherever
// they disagree.
//
// THREE DOMAINS, THREE DIFFERENT ENRICHMENT SHAPES -- deliberately not
// forced into one algorithm, because the real data isn't shaped the same:
//
//  1. Sheet Metal: process_operations.json's ~25 process names double as
//     BOTH the machine/station type AND the live operation name (e.g.
//     "Bend Brake" is both) -- exact/case-insensitive name matching against
//     live operations works directly. Enrichment source:
//     memory/sheetmetal/process/structured/operations.json (already
//     parsed: process/levels/leaf_operation/leaf_feature).
//
//  2. Plastic & Rubber (Injection Molding digital-factory file): same
//     pattern as Sheet Metal -- process names double as live operation
//     names (Compression Molding, Injection Molding, Structural Foam
//     Molding). Enrichment source: memory/Injection/process/
//     digital_factory_operations.json (already flat: process/
//     operationCategory/featureType, no multi-level chains in this file).
//
//  3. Machining: memory/machining/processes.json's 43 names are
//     MACHINE/STATION types ("3 Axis Mill", "Wire EDM", "Drill Press"),
//     which is a DIFFERENT axis from live Machining's OPERATION-level names
//     ("Drilling", "Turning", "Facing") -- confirmed live only "Wire EDM"
//     is a genuine exact match; a real many-to-many "which stations can
//     run this operation" relationship is a machine-capability-matching
//     concern (a separate architecture layer per CLAUDE.md's platform
//     mandate), not this taxonomy pass. So Machining's 43 stations are
//     seeded as their OWN canonical rows (group="Machining"), each with
//     real operation/feature-type children parsed from
//     memory/machining/operations_full.json's 1174 raw compound strings
//     (parsed here -- unlike Sheet Metal/Injection Molding, this file has
//     no pre-parsed process/operationCategory/featureType columns, only
//     the raw processName string) -- alongside, NOT instead of, the 68
//     canonical rows for Machining's actual live operations. The two sets
//     are deduped by exact name only where they really are the same thing
//     (just "Wire EDM").
//
// Everything else (Assembly, Post Processing, Packing & Delivery, and any
// Sheet Metal/Plastic & Rubber/Machining name with no confident match) is a
// disclosed gap: a bare canonical row with no operation children/aliases/
// default machine, or a listed unresolved candidate for a near-miss that
// needs a human decision -- never guessed.
const fs = require('fs');
const path = require('path');

const SCRIPTS_DIR = __dirname;
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SM_STRUCTURED_DIR = path.join(REPO_ROOT, 'memory', 'sheetmetal', 'process', 'structured');
const IM_PROCESS_DIR = path.join(REPO_ROOT, 'memory', 'Injection', 'process');
const MACHINING_DIR = path.join(REPO_ROOT, 'memory', 'machining');

const liveSnapshot = JSON.parse(fs.readFileSync(path.join(SCRIPTS_DIR, '609_live_process_calculator_mappings_snapshot.json'), 'utf8'));
const smOfflineProcesses = JSON.parse(fs.readFileSync(path.join(SM_STRUCTURED_DIR, 'processes.json'), 'utf8'));
const smOfflineOperations = JSON.parse(fs.readFileSync(path.join(SM_STRUCTURED_DIR, 'operations.json'), 'utf8'));
const imOfflineProcesses = JSON.parse(fs.readFileSync(path.join(IM_PROCESS_DIR, 'digital_factory_processes_and_rates.json'), 'utf8')).digitalFactory_UnionGermany.processes;
const imOfflineOperations = JSON.parse(fs.readFileSync(path.join(IM_PROCESS_DIR, 'digital_factory_operations.json'), 'utf8')).operations;
const machOfflineProcesses = JSON.parse(fs.readFileSync(path.join(MACHINING_DIR, 'processes.json'), 'utf8')).processes;
const machOfflineOperationsRaw = JSON.parse(fs.readFileSync(path.join(MACHINING_DIR, 'operations_full.json'), 'utf8')).operations;

function norm(s) { return s.trim().toLowerCase().replace(/\s+/g, ' '); }
function sqlStr(v) {
  return v === null || v === undefined || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
}

// Parses "Process:Op1//Feat1:Op2//Feat2" into { process, operationCategory,
// featureType } using the LEAF (last) level -- matches how the
// pre-parsed Sheet Metal/Injection Molding files already define
// leaf_operation/leaf_feature and operationCategory/featureType. Each
// ':'-delimited segment after the process name is itself an
// "operation[//feature]" pair; a segment with no "//" is a bare operation
// qualifier (feature = null). No process name in any of these 3 source
// files contains ':' or '//' itself, and Machining's file has no bare
// single-'/' operation names (verified directly), so this is a safe,
// unambiguous split -- not a heuristic guess.
function parseCompoundOperationString(raw) {
  const segments = raw.split(':');
  const process = segments[0];
  const levels = segments.slice(1).map(seg => {
    const slashIdx = seg.indexOf('//');
    return slashIdx === -1
      ? { operation: seg, feature: null }
      : { operation: seg.slice(0, slashIdx), feature: seg.slice(slashIdx + 2) };
  });
  const leaf = levels[levels.length - 1] || { operation: null, feature: null };
  return { process, operationCategory: leaf.operation, featureType: leaf.feature };
}

// Flatten the live snapshot, then dedupe to one row per (group, operation)
// -- collapsing real cross-route duplicates (Waterjet Cutting under both
// Cutting/Sheet Cutting, several Machining/Assembly ops shared across
// routes -- see migration 609's own header for the full confirmed list).
const liveFlat = [];
for (const g of liveSnapshot.groups) {
  for (const r of g.routes) {
    for (const op of r.operations) {
      liveFlat.push({ process_group: g.process_group, process_route: r.process_route, operation: op });
    }
  }
}
const dedupedByKey = new Map();
for (const row of liveFlat) {
  const key = `${row.process_group}||${row.operation}`;
  if (!dedupedByKey.has(key)) {
    dedupedByKey.set(key, { process_group: row.process_group, process_name: row.operation });
  }
}
const liveCanonicalRows = [...dedupedByKey.values()];

const FAMILY_ALIAS = {
  'Sheet Metal||Waterjet Cutting': { family: 'Waterjet Cut', aliasSource: 'process_operations_json' },
  'Sheet Metal||Laser Puch': { family: 'Laser Punch', aliasSource: 'manual' },
};
const ROADMAP_OVERRIDE = {
  // migration 604 ("router_2axis_cost_engine.sql", confirmed in git log)
  // plus this session's own Phase 1 work directly touching
  // router-engine.ts/router-engine.spec.ts as a registered engine --
  // structured/processes.json's "unwired" predates that migration.
  'Sheet Metal||2 Axis Router': 'production',
};

const smByNormName = new Map(smOfflineProcesses.map(p => [norm(p.process_name), p]));
const imByNormName = new Map(imOfflineProcesses.map(p => [norm(p.processName), p]));

function resolveSheetMetal(operation) {
  const key = `Sheet Metal||${operation}`;
  if (FAMILY_ALIAS[key]) {
    const { family, aliasSource } = FAMILY_ALIAS[key];
    return { offlineProc: smByNormName.get(norm(family)), familyName: family, aliasSource };
  }
  const offlineProc = smByNormName.get(norm(operation));
  if (!offlineProc) return null;
  const aliasSource = offlineProc.process_name !== operation ? 'process_operations_json' : null;
  return { offlineProc, familyName: offlineProc.process_name, aliasSource };
}

function resolvePlasticRubber(operation) {
  const offlineProc = imByNormName.get(norm(operation));
  if (!offlineProc) return null;
  const aliasSource = offlineProc.processName !== operation ? 'process_operations_json' : null;
  return { offlineProc, familyName: offlineProc.processName, aliasSource };
}

const operationRows = []; // { process_group, process_name, operation_category, feature_type, raw }
const aliasRows = []; // { process_group, process_name, alias, source }
const unresolvedCandidates = [];

const NEAR_MISS_SUGGESTIONS = {
  'Sheet Metal||Fiber laser Cutting': 'Possible duplicate/legacy spelling of "Fiber Laser Cut" -- confirm live_active + whether this is a dead legacy row before merging operation data onto it.',
  'Sheet Metal||Plasma Cutting': 'Possible duplicate/rename of "Plasma Cut" -- process_operations.json only has a "Plasma Cut" family. Confirm before aliasing.',
  'Sheet Metal||3D Laser Cut': 'Possible duplicate/rename of "3D Laser". Confirm before aliasing.',
  'Sheet Metal||Turret Punching': 'Possible rename of "Turret Press". Confirm before aliasing.',
  'Sheet Metal||Abrasive Waterjet Cutting': 'Likely a real physical variant of Waterjet Cut (abrasive vs. pure), not just a spelling difference. Decide whether it should share Waterjet Cut\'s data or stay a bare row.',
  'Sheet Metal||Pure Waterjet Cutting (for soft materials)': 'Likely a real physical variant of Waterjet Cut. Decide whether it should share Waterjet Cut\'s data or stay a bare row.',
  'Sheet Metal||Gross Usage': 'structured/processes.json has "Material Stock" (now confirmed live, separately, under this same route) -- "Gross Usage" may be an unrelated real operation, not a renamed Material Stock. Confirm before aliasing.',
  'Sheet Metal||Net Usage': 'Same as "Gross Usage" -- confirm before aliasing to anything.',
  'Sheet Metal||Hole Extrusion (Burring)': 'A real registered engine exists (hole-extrusion-engine.ts, Phase 1) but process_operations.json has no top-level family by this name -- a genuine offline-data gap.',
  'Sheet Metal||Shearing': 'Migration 605 documents this as reusing machine_class=press_brake with NO distinct shearing cost path (deliberately deactivated) -- NOT the same as process_operations.json\'s separate "Shear" family (also not_modeled/deactivated, "Shear:Shear//Blank" only). Two dead-end names, not confirmed to be the same real thing. Left unaliased.',
  'Sheet Metal||Shearning': 'Same situation as "Shearing" -- migration 605\'s documented press_brake reuse, not confirmed identical to the "Shear" family. Left unaliased.',
  'Plastic & Rubber||Reaction Foam Molding': 'A real wording difference from the Injection Molding digital-factory file\'s "Reaction Injection Molding" (not just casing) -- could be the same real process under a different name, or genuinely different. Not auto-aliased.',
};

// Live rows indexed by (group, name) -- used below to detect when a row's
// resolved family name is ITSELF a separate live row's own process_name
// (the Laser Punch/Laser Puch shape: two distinctly-spelled live operations
// that are really the same manufacturing process).
const liveRowByKey = new Map(liveCanonicalRows.map(r => [`${r.process_group}||${r.process_name}`, r]));

for (const row of liveCanonicalRows) {
  const resolver = row.process_group === 'Sheet Metal' ? resolveSheetMetal
    : row.process_group === 'Plastic & Rubber' ? resolvePlasticRubber
    : null;
  const resolved = resolver ? resolver(row.process_name) : null;

  if (!resolved) {
    const suggestion = NEAR_MISS_SUGGESTIONS[`${row.process_group}||${row.process_name}`];
    if (suggestion) unresolvedCandidates.push({ process_group: row.process_group, process_name: row.process_name, suggestion });
    continue;
  }

  const { offlineProc, familyName, aliasSource } = resolved;

  // Cross-name family consolidation (fixes the Laser Punch/Laser Puch
  // duplication class of bug). Both resolution paths above (the explicit
  // FAMILY_ALIAS table, and an exact post-normalization match against the
  // trusted offline reference data) are deterministic, already-sourced
  // identity resolutions -- not a new string-similarity guess, per the
  // "use the explicit family/alias mapping as the source of truth, never
  // fuzzy-match" requirement. When this row's real family name is ITSELF a
  // DIFFERENT live row's own process_name, this row is a pure alias of
  // that other, already-canonical row: it must NOT become an independent
  // process_taxonomy row (previously caused two canonical rows, e.g.
  // cfa72275 "Laser Punch" and 5baaf77c "Laser Puch", each independently
  // getting a full copy of the SAME 37 operations) and must NOT own the
  // alias record in the wrong direction (previously the ALIASED row --
  // whichever one happened to trigger FAMILY_ALIAS -- became "canonical"
  // for alias purposes regardless of which spelling was actually correct).
  //
  // When familyName differs from this row's own name but NO separate live
  // row exists under familyName (e.g. a pure case/whitespace variant with
  // only one live representative), this row IS the sole real live
  // instance of that family: unchanged behavior, it keeps its own
  // canonical row and records an alias pointing at itself.
  const trueRowKey = `${row.process_group}||${familyName}`;
  const isAliasOnly = !!aliasSource && familyName !== row.process_name && liveRowByKey.has(trueRowKey);

  if (isAliasOnly) {
    row._isAliasOnly = true;
    row._aliasOfFamilyName = familyName;
    row._aliasSource = aliasSource;
    continue; // no canonical row, no operations copy -- see the alias pass below
  }

  row._roadmapStatus = ROADMAP_OVERRIDE[`${row.process_group}||${row.process_name}`]
    || offlineProc.roadmap_status
    || 'not_modeled';
  row._defaultMachine = offlineProc.default_machine || offlineProc.defaultMachine || null;
  row._defaultToolShop = offlineProc.tool_shop_name || offlineProc.defaultToolShopName || null;

  if (aliasSource) aliasRows.push({ process_group: row.process_group, process_name: row.process_name, alias: familyName, source: aliasSource });

  if (row.process_group === 'Sheet Metal') {
    for (const fr of smOfflineOperations.filter(o => o.process === familyName)) {
      operationRows.push({ process_group: row.process_group, process_name: row.process_name, operation_category: fr.leaf_operation, feature_type: fr.leaf_feature, raw: fr.raw });
    }
  } else if (row.process_group === 'Plastic & Rubber') {
    for (const fr of imOfflineOperations.filter(o => o.process === familyName)) {
      operationRows.push({ process_group: row.process_group, process_name: row.process_name, operation_category: fr.operationCategory, feature_type: fr.featureType, raw: fr.processName });
    }
  }
}

// Second pass: for every alias-only row found above, record the
// CORRECTLY-DIRECTED alias -- canonical = the real live row under
// familyName (used as the JOIN key when this SQL runs), alias text = this
// row's own (non-canonical) name. This is the exact fix for the reversed
// direction the generator used to produce: previously the aliased row's
// OWN name was used as the JOIN key (making the typo "canonical" for
// alias purposes) with the correct spelling stored as its alias.
for (const row of liveCanonicalRows) {
  if (!row._isAliasOnly) continue;
  aliasRows.push({
    process_group: row.process_group,
    process_name: row._aliasOfFamilyName,
    alias: row.process_name,
    source: row._aliasSource,
  });
}

const aliasOnlyCount = liveCanonicalRows.filter(r => r._isAliasOnly).length;
const liveCanonicalRowsFinal = liveCanonicalRows.filter(r => !r._isAliasOnly);

// Machining live rows that happen to be an exact name match to one of the
// 43 offline station/process names (confirmed: only "Wire EDM") still get
// that row's real default machine/tool-shop -- their operation children
// are attached separately below via the parsed raw-ops loop.
const machByNormName = new Map(machOfflineProcesses.map(p => [norm(p.processName), p]));
for (const row of liveCanonicalRows) {
  if (row.process_group !== 'Machining') continue;
  const offlineProc = machByNormName.get(norm(row.process_name));
  if (!offlineProc) continue;
  row._roadmapStatus = 'not_modeled';
  row._defaultMachine = offlineProc.defaultMachine || null;
  row._defaultToolShop = offlineProc.defaultToolShopName || null;
}

// Machining: 43 station/process canonical rows, each enriched from its own
// parsed operations. Deduped against the live-operation canonical rows
// (liveCanonicalRows, Machining group) by exact name only -- confirmed
// live only "Wire EDM" is a genuine overlap; everything else is additive.
const machiningRoadmapStatus = 'not_modeled'; // no live cost-engine linkage claim made for these -- real gap, not guessed
const liveMachiningNames = new Set(liveCanonicalRowsFinal.filter(r => r.process_group === 'Machining').map(r => r.process_name));
const machiningStationRows = [];
for (const proc of machOfflineProcesses) {
  if (liveMachiningNames.has(proc.processName)) continue; // exact overlap (Wire EDM) -- already a canonical row via the live set
  machiningStationRows.push({
    process_group: 'Machining',
    process_name: proc.processName,
    _roadmapStatus: machiningRoadmapStatus,
    _defaultMachine: proc.defaultMachine || null,
    _defaultToolShop: proc.defaultToolShopName || null,
  });
}
for (const raw of machOfflineOperationsRaw) {
  const { process, operationCategory, featureType } = parseCompoundOperationString(raw.processName);
  const targetName = liveMachiningNames.has(process) ? process : process; // same name either way -- station row or live row, whichever exists
  operationRows.push({ process_group: 'Machining', process_name: targetName, operation_category: operationCategory, feature_type: featureType, raw: raw.processName });
}

const canonicalRows = [...liveCanonicalRowsFinal, ...machiningStationRows];

function taxonomyValueRow(r) {
  return `(${sqlStr(r.process_group)}, ${sqlStr(r.process_name)}, NULL, ${sqlStr(r._roadmapStatus || 'not_modeled')}, ${sqlStr(r._defaultMachine)}, ${sqlStr(r._defaultToolShop)})`;
}

const enrichedCount = canonicalRows.filter(r => operationRows.some(o => o.process_group === r.process_group && o.process_name === r.process_name)).length;

const sql = `-- ============================================================================
-- Migration 609 seed: process_taxonomy canonical rows (Phase 2a)
-- Generated by gen_609_seed_process_taxonomy.js -- DO NOT hand-edit, re-run
-- the generator and diff instead.
--
-- ${canonicalRows.length} canonical rows total: ${liveCanonicalRowsFinal.length} from the live
-- process_calculator_mappings snapshot (deduped across cross-route
-- duplicates, then ${aliasOnlyCount} more absorbed as pure aliases of an
-- already-canonical row of the same real family -- e.g. "Laser Puch" onto
-- "Laser Punch" -- rather than becoming independent canonical rows; see
-- the cross-name family consolidation comment inline above) plus
-- ${machiningStationRows.length} Machining station/process-type rows
-- from memory/machining/processes.json (a different, additive axis from
-- live Machining operations -- see the generator's header for why these
-- are NOT merged into the live operation rows except where a name is a
-- genuine exact match).
--
-- ${enrichedCount} of those got real operation/feature-type children (${operationRows.length} rows) from
-- Sheet Metal's process_operations.json, the Injection Molding
-- digital-factory file, or Machining's operations_full.json (parsed here
-- via parseCompoundOperationString). See 609_unresolved_candidates.json
-- for near-miss names that need a human decision before they can be
-- enriched further.
-- ============================================================================

BEGIN;

INSERT INTO process_taxonomy (process_group, process_name, machine_class, roadmap_status, default_machine_name, default_tool_shop_name)
VALUES
${canonicalRows.map(taxonomyValueRow).join(',\n')}
ON CONFLICT (process_group, process_name) DO NOTHING;

-- Operation children (${operationRows.length} rows)
INSERT INTO process_taxonomy_operations (canonical_process_id, operation_category, feature_type, raw_compound_string)
SELECT pt.id, v.operation_category, v.feature_type, v.raw
FROM process_taxonomy pt
JOIN (VALUES
${operationRows.map(r => `(${sqlStr(r.process_group)}, ${sqlStr(r.process_name)}, ${sqlStr(r.operation_category)}, ${sqlStr(r.feature_type)}, ${sqlStr(r.raw)})`).join(',\n')}
) AS v(process_group, process_name, operation_category, feature_type, raw)
  ON pt.process_group = v.process_group AND pt.process_name = v.process_name
ON CONFLICT (canonical_process_id, raw_compound_string) DO NOTHING;

-- Aliases (${aliasRows.length} rows)
INSERT INTO process_taxonomy_aliases (canonical_process_id, alias, source)
SELECT pt.id, v.alias, v.source
FROM process_taxonomy pt
JOIN (VALUES
${aliasRows.map(r => `(${sqlStr(r.process_group)}, ${sqlStr(r.process_name)}, ${sqlStr(r.alias)}, ${sqlStr(r.source)})`).join(',\n')}
) AS v(process_group, process_name, alias, source)
  ON pt.process_group = v.process_group AND pt.process_name = v.process_name
ON CONFLICT DO NOTHING;

COMMIT;

-- Verification (run manually after):
-- SELECT process_group, count(*) FROM process_taxonomy GROUP BY process_group ORDER BY process_group;
-- -- Expect ${canonicalRows.length} total.
-- SELECT pt.process_group, pt.process_name, count(o.id) AS operations FROM process_taxonomy pt
--   LEFT JOIN process_taxonomy_operations o ON o.canonical_process_id = pt.id
--   GROUP BY pt.id, pt.process_group, pt.process_name ORDER BY operations DESC;
`;

fs.writeFileSync(path.join(SCRIPTS_DIR, '..', '609_seed_process_taxonomy.sql'), sql, 'utf8');
fs.writeFileSync(path.join(SCRIPTS_DIR, '609_unresolved_candidates.json'), JSON.stringify(unresolvedCandidates, null, 2), 'utf8');

console.log('Wrote 609_seed_process_taxonomy.sql --', canonicalRows.length, 'canonical rows (', liveCanonicalRowsFinal.length, 'live +', machiningStationRows.length, 'Machining stations;', aliasOnlyCount, 'live rows absorbed as aliases instead of independent canonical rows),', operationRows.length, 'operation children,', aliasRows.length, 'aliases.');
console.log('Wrote 609_unresolved_candidates.json --', unresolvedCandidates.length, 'near-miss names needing human review.');
console.log('Enriched canonical rows:', enrichedCount, 'of', canonicalRows.length);
