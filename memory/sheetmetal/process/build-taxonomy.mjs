#!/usr/bin/env node
// Deterministic, dependency-free rebuild of the structured Sheet Metal process
// taxonomy from the raw reference export (process_operations.json,
// process_machine_data.json) plus the existing operation_name_reference.json
// lookup table. Re-run any time the raw files change:
//
//   node build-taxonomy.mjs
//
// Everything under structured/ is generated output — do not hand-edit it.
// See README.md for the parsing grammar and schema of each output file.

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(DIR, "structured");

function readJson(relPath) {
  return JSON.parse(readFileSync(path.join(DIR, relPath), "utf8"));
}

function writeJson(relPath, data) {
  writeFileSync(
    path.join(OUT_DIR, relPath),
    JSON.stringify(data, null, 2) + "\n",
    "utf8"
  );
}

// Roadmap status per process, taken from Section 02 (Process coverage matrix)
// of the Sheet Metal v1 Production-Readiness Roadmap (SM-ROADMAP-01). This is
// a snapshot of that document, not re-derived from code — if the roadmap is
// revised, update this table to match.
const ROADMAP_STATUS = {
  "Fiber Laser Cut": ["production", "dedicated cost engine, DB-first capability selector"],
  "Laser Cut": ["production", "dedicated cost engine, DB-first capability selector"],
  "Waterjet Cut": ["production", "dedicated cost engine, DB-first capability selector"],
  "Turret Press": ["production", "dedicated cost engine, DB-first capability selector"],
  "Bend Brake": ["production", "inline cost engine (cost-engine.ts), DB-first capability selector"],
  "2 Roll Bending": ["thin", "substituted through a single-row Roll Forming calculator, no material/thickness axis"],
  "3 Roll Bending": ["thin", "substituted through a single-row Roll Forming calculator, no material/thickness axis"],
  "4 Roll Bending": ["thin", "substituted through a single-row Roll Forming calculator, no material/thickness axis"],
  "Deslag": ["thin", "folded into a generic deburring line, no real formula"],
  "2 Axis Router": ["unwired", "mapping row inactive, no cost path"],
  "3D Laser": ["unwired", "mapping row inactive, no cost path"],
  "Generic Press": ["unwired", "mapping row inactive, no cost path"],
  "Laser Punch": ["unwired", "mapping row inactive, no cost path"],
  "OxyFuel Cut": ["unwired", "mapping row inactive, no cost path"],
  "Plasma Cut": ["unwired", "mapping row inactive, no cost path"],
  "Plasma Punch": ["unwired", "mapping row inactive, no cost path"],
  "Std Press": ["unwired", "mapping row inactive, no cost path"],
  "Tandem Press": ["unwired", "mapping row inactive, no cost path"],
  "CTL": ["not_modeled", "absent from process_calculator_mappings entirely"],
  "Progressive Die": ["not_modeled", "absent + known case-duplication bug"],
  "Shear": ["not_modeled", "deactivated — no distinct shearing path exists"],
  "Material Stock": ["non_mfg", "system marker, not a manufacturing process"],
  "No Cost Feature": ["non_mfg", "system marker, not a manufacturing process"],
  "User-Defined Process": ["non_mfg", "staging-only marker"],
};

function statusFor(processName) {
  const entry = ROADMAP_STATUS[processName];
  if (!entry) {
    throw new Error(
      `No roadmap_status mapping for process "${processName}" — add it to ROADMAP_STATUS before rebuilding.`
    );
  }
  return { roadmap_status: entry[0], status_note: entry[1] };
}

// Verified ground truth: the live "Process Calculator Mappings" page's Sheet
// Metal group, as actually rendered on 2026-08-22 ("Sheet Metal · 68 ops · 13
// routes"). This transcription captures 64 operation rows across 13 routes —
// 4 short of the page's own "68" count, most likely because a few rows were
// missed while copying the screen; it is NOT reconciled to exactly 68 and
// should not be treated as exhaustive. This supersedes the earlier
// 44-op/12-route transcription (kept only in git history). Route = category
// bucket; each operation carries the `active` flag shown on that screen.
// Known duplicate/dirty rows are called out in KNOWN_DUPLICATE_OPERATIONS
// below rather than silently deduplicated — see README.md.
const VERIFIED_ROUTES = {
  "Material Usage": [
    { operation: "Gross Usage", active: true },
    { operation: "Net Usage", active: true },
    { operation: "Material Stock", active: false },
    { operation: "No Cost Feature", active: false },
  ],
  "Forming": [{ operation: "Hole Extrusion (Burring)", active: true }],
  "Drilling": [{ operation: "Tapping", active: true }],
  "Laser Cutting": [
    { operation: "Laser Cut", active: true },
    { operation: "Fiber Laser Cut", active: true },
    { operation: "3D Laser", active: false },
  ],
  "Sheet Cutting": [
    { operation: "Shearning", active: false },
    { operation: "Fiber laser Cutting", active: false },
    { operation: "Co2 Laser Cutting", active: false },
    { operation: "Plasma Cutting", active: false },
    { operation: "Blanking", active: false },
    { operation: "3D Laser Cut", active: false },
    { operation: "Shearing", active: false },
    { operation: "Waterjet Cutting", active: false },
  ],
  "Bending/Floating /Forming": [
    { operation: "Bend Brake", active: true },
    { operation: "Stage Tool Bending", active: true },
    { operation: "Stage Tool Forming", active: true },
    { operation: "Roll Forming", active: true },
    { operation: "Deep Draw", active: true },
    { operation: "Laser Puch", active: false },
    { operation: "Turret Press", active: false },
    { operation: "Progressive die", active: true },
    { operation: "Offline Blank", active: true },
    { operation: "Stretch forming", active: true },
    { operation: "Hemming", active: true },
    { operation: "Flanging", active: true },
    { operation: "2 Roll Bending", active: true },
    { operation: "3 Roll Bending", active: true },
    { operation: "4 Roll Bending", active: true },
    { operation: "Generic Press", active: false },
    { operation: "Std Press", active: false },
    { operation: "Tandem Press", active: false },
  ],
  "Press Brake": [
    { operation: "Bend", active: true },
    { operation: "Form", active: true },
    { operation: "Press Brake Bend", active: true },
  ],
  "Raw Material": [
    { operation: "Sheet", active: true },
    { operation: "Flat", active: true },
    { operation: "Coil", active: true },
    { operation: "I-Beam", active: true },
    { operation: "H-Beam", active: true },
    { operation: "Angle (L-shape)", active: true },
    { operation: "Channel (C-shape / U-shape)", active: true },
    { operation: "T-Sections", active: true },
    { operation: "Z-Sections", active: true },
  ],
  "Finishing": [
    { operation: "Deburr", active: true },
    { operation: "Edge Finish", active: true },
    { operation: "Deslag", active: true },
  ],
  "Inspection": [
    { operation: "Inspect", active: true },
    { operation: "Dimensional Inspect", active: true },
  ],
  "Surface Treatment": [
    { operation: "Powder Coat", active: true },
    { operation: "Paint", active: true },
    { operation: "Anodize", active: true },
  ],
  "Cutting": [
    { operation: "Waterjet Cutting", active: true },
    { operation: "Abrasive Waterjet Cutting", active: true },
    { operation: "Pure Waterjet Cutting (for soft materials)", active: false },
    { operation: "2 Axis Router", active: false },
    { operation: "OxyFuel Cut", active: false },
    { operation: "Plasma Cut", active: false },
  ],
  "Sheet Metal Fabrication": [
    { operation: "Turret Punching", active: true },
    { operation: "Hole Punching", active: true },
    { operation: "Nibbling", active: true },
  ],
};

// Rows that appear more than once (same or near-same operation name) across
// routes on the live screen — genuine data dirtiness on the live side, not a
// transcription error here. Documented, not silently resolved.
const KNOWN_DUPLICATE_OPERATIONS = [
  { operation: "Waterjet Cutting", occurrences: ["Sheet Cutting (inactive)", "Cutting (active)"] },
  { operation: "Plasma Cutting / Plasma Cut", occurrences: ["Sheet Cutting: \"Plasma Cutting\" (inactive)", "Cutting: \"Plasma Cut\" (inactive)"] },
  { operation: "Shearing / Shearning", occurrences: ["Sheet Cutting: \"Shearning\" (inactive)", "Sheet Cutting: \"Shearing\" (inactive)"] },
  { operation: "3D Laser / 3D Laser Cut", occurrences: ["Laser Cutting: \"3D Laser\" (inactive)", "Sheet Cutting: \"3D Laser Cut\" (inactive)"] },
  { operation: "Fiber Laser Cut / Fiber laser Cutting", occurrences: ["Laser Cutting: \"Fiber Laser Cut\" (active)", "Sheet Cutting: \"Fiber laser Cutting\" (inactive)"] },
];

// Route assignment per raw process_name (from process_operations.json /
// process_machine_data.json), matched against VERIFIED_ROUTES above.
// "exact" = literal string match (case/spacing-insensitive) against a live
// operation name. "alias_confident" = same real-world process, different
// string (typo or gerund form, e.g. "Shear" vs. live "Shearing"). `live_active`
// mirrors that live row's active flag — most of these are inactive placeholder
// rows, which is expected: it's exactly the roadmap's unwired/not_modeled tier
// showing up in the live schema now. Only CTL and User-Defined Process still
// have zero evidence anywhere (live screen or migration history) and stay
// "unassigned" — do not guess those; add them here once confirmed.
//
// Laser Punch and Plasma Punch were corrected 2026-08-22 from "unassigned" to
// "Sheet Metal Fabrication" based on migration 503's actual INSERT statements
// (backend/migrations/503_sheet_metal_new_process_operations.sql) — stronger
// evidence than the UI screen, which didn't show either of these two by their
// correctly-spelled name at all.
//
// OPEN QUESTION — Turret Press: the live UI screen (2026-08-22) showed an
// inactive "Turret Press" row under Bending/Floating /Forming, matching the
// entry below. But migration history (024/051/368) shows a "Turret Press"
// row that's ACTIVE with a real calculator (TPP Manufacturing,
// a5d9b23a-5b8c-4d2b-98dd-3fa623458716). Migration files describe intent, not
// live state, so this may be another case-duplication bug like Progressive
// Die's (documented in 440_backfill_case_duplicate_sheet_metal_mappings.sql).
// Unresolved — do not write a migration that assumes either answer without
// checking the live table directly.
const ROUTE_ASSIGNMENT = {
  "2 Axis Router": ["Cutting", "exact", false],
  "2 Roll Bending": ["Bending/Floating /Forming", "exact", true],
  "3 Roll Bending": ["Bending/Floating /Forming", "exact", true],
  "3D Laser": ["Laser Cutting", "exact", false],
  "4 Roll Bending": ["Bending/Floating /Forming", "exact", true],
  "Bend Brake": ["Bending/Floating /Forming", "exact", true],
  "Deslag": ["Finishing", "exact", true],
  "Fiber Laser Cut": ["Laser Cutting", "exact", true],
  "Generic Press": ["Bending/Floating /Forming", "exact", false],
  "Laser Cut": ["Laser Cutting", "exact", true],
  "Laser Punch": ["Sheet Metal Fabrication", "exact", false], // confirmed via migration 503 INSERT, not the UI screen's separate "Laser Puch" typo row
  "Material Stock": ["Material Usage", "exact", false],
  "No Cost Feature": ["Material Usage", "exact", false],
  "OxyFuel Cut": ["Cutting", "exact", false],
  "Plasma Cut": ["Cutting", "exact", false], // also appears as "Plasma Cutting" under Sheet Cutting — see KNOWN_DUPLICATE_OPERATIONS
  "Plasma Punch": ["Sheet Metal Fabrication", "exact", false], // confirmed via migration 503 INSERT
  "Progressive Die": ["Bending/Floating /Forming", "exact", true], // live row spelled "Progressive die"; known case-duplication bug, see migration 440
  "Shear": ["Sheet Cutting", "alias_confident", false], // live rows spelled "Shearing"/"Shearning" — see KNOWN_DUPLICATE_OPERATIONS
  "Std Press": ["Bending/Floating /Forming", "exact", false],
  "Tandem Press": ["Bending/Floating /Forming", "exact", false],
  "Turret Press": ["Bending/Floating /Forming", "exact", false], // see OPEN QUESTION above — conflicts with migration history
  "Waterjet Cut": ["Cutting", "alias_confident", true], // live row "Waterjet Cutting"; also appears inactive under Sheet Cutting — see KNOWN_DUPLICATE_OPERATIONS
};

function routeFor(processName) {
  const entry = ROUTE_ASSIGNMENT[processName];
  if (!entry) {
    return { process_route: null, route_match: "unassigned", live_active: null };
  }
  return { process_route: entry[0], route_match: entry[1], live_active: entry[2] };
}

// --- Parse the raw compound strings -----------------------------------
// Grammar: Process:Level1[:Level2[:Level3...]]
// Each level is either a bare category label or "Operation//Feature".
// This is purely syntactic (no semantic interpretation of what a level chain
// "means") — see README.md.
function parseRaw(raw) {
  const [process, ...rest] = raw.split(":");
  const levels = rest.map((level) => {
    const slashIdx = level.indexOf("//");
    if (slashIdx === -1) {
      return { operation: level, feature: null };
    }
    return {
      operation: level.slice(0, slashIdx),
      feature: level.slice(slashIdx + 2),
    };
  });
  const leaf = levels[levels.length - 1] ?? { operation: null, feature: null };
  return {
    raw,
    process,
    levels,
    leaf_operation: leaf.operation,
    leaf_feature: leaf.feature,
  };
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const rawOperations = readJson("process_operations.json");
  const rawMachines = readJson("process_machine_data.json");
  const operationNameReference = readJson(
    "../lookuptable/operation_name_reference.json"
  );

  const canonicalByRaw = new Map();
  for (const row of operationNameReference.operations) {
    if (!canonicalByRaw.has(row.operation_name)) {
      canonicalByRaw.set(row.operation_name, row.operation_name_reference);
    }
  }

  // ---- operations.json ----
  const operations = rawOperations.map((raw) => {
    const parsed = parseRaw(raw);
    return {
      ...parsed,
      canonical_operation_reference: canonicalByRaw.get(raw) ?? null,
    };
  });
  writeJson("operations.json", operations);

  // ---- processes.json ----
  const machinesByProcess = new Map();
  for (const row of rawMachines) {
    const list = machinesByProcess.get(row.process_name) ?? [];
    list.push({ tool_shop_name: row.tool_shop_name, machine: row.machine });
    machinesByProcess.set(row.process_name, list);
  }

  const opCountByProcess = new Map();
  for (const op of operations) {
    opCountByProcess.set(op.process, (opCountByProcess.get(op.process) ?? 0) + 1);
  }

  const allProcessNames = new Set([
    ...machinesByProcess.keys(),
    ...opCountByProcess.keys(),
  ]);

  const processes = [...allProcessNames]
    .sort()
    .map((process_name) => {
      const machineEntries = machinesByProcess.get(process_name) ?? [];
      const preferredDefault =
        machineEntries.find((m) => m.machine.startsWith("Default")) ??
        machineEntries[0] ??
        null;
      return {
        process_name,
        default_machine: preferredDefault ? preferredDefault.machine : null,
        tool_shop_name: preferredDefault ? preferredDefault.tool_shop_name : null,
        machine_entries: machineEntries,
        operation_count: opCountByProcess.get(process_name) ?? 0,
        ...statusFor(process_name),
        ...routeFor(process_name),
      };
    });
  writeJson("processes.json", processes);

  // ---- process_routes.json ----
  // Verbatim copy of VERIFIED_ROUTES (see above) as its own file, so the
  // ground-truth live hierarchy is inspectable independently of any
  // process_name matching logic.
  writeJson("process_routes.json", {
    process_group: "Sheet Metal",
    source: "live Process Calculator Mappings UI export (Sheet Metal group), captured 2026-08-22",
    live_header_reported: "68 ops · 13 routes",
    transcribed_op_count: Object.values(VERIFIED_ROUTES).flat().length,
    transcription_note: "Transcribed count does not reconcile to the page's reported 68 — treat as best-effort, not exhaustive.",
    routes: VERIFIED_ROUTES,
    known_duplicate_operations: KNOWN_DUPLICATE_OPERATIONS,
  });

  // ---- taxonomy_tree.json ----
  const tree = {};
  for (const op of operations) {
    let node = tree;
    if (!node[op.process]) node[op.process] = {};
    node = node[op.process];
    for (const level of op.levels) {
      if (!node[level.operation]) node[level.operation] = {};
      node = node[level.operation];
      const featureKey = level.feature ?? "_none";
      if (!node[featureKey]) node[featureKey] = {};
      node = node[featureKey];
    }
    if (!node._raw) node._raw = [];
    node._raw.push(op.raw);
  }
  writeJson("taxonomy_tree.json", tree);

  // ---- process_calculator_mapping_candidates.json ----
  // Shaped to match the live process_calculator_mappings table exactly:
  // process_group (always "Sheet Metal" here), process_route (the category
  // bucket — e.g. "Bending/Floating /Forming"), operation (the specific
  // process/machine route — e.g. "Bend Brake"). This is the process-level
  // hierarchy — it does NOT include CAD features (StraightBend, ComplexHole,
  // etc.); those live separately in operations.json/taxonomy_tree.json,
  // because the live schema has no feature concept at all (confirmed by
  // reading the actual table/DTO).
  //
  // Every process_name from both raw files is included — nothing is dropped
  // for being unwired/thin/not_modeled. Rows with no verified route
  // (route_match: "unassigned") are included with process_route: null,
  // pending user-confirmed route data in a later phase — never guessed here.
  // Does NOT invent calculator_id or machine_class; those remain a human
  // decision (see README.md).
  const mappingCandidates = processes.map((p) => ({
    process_group: "Sheet Metal",
    process_route: p.process_route,
    operation: p.process_name,
    machine: p.default_machine,
    route_match: p.route_match,
    live_active: p.live_active,
    roadmap_status: p.roadmap_status,
  }));
  writeJson("process_calculator_mapping_candidates.json", mappingCandidates);

  // ---- sanity checks / summary ----
  if (operations.length !== rawOperations.length) {
    throw new Error(
      `operations.json row count (${operations.length}) != raw process_operations.json length (${rawOperations.length})`
    );
  }
  const statusCounts = {};
  const routeCounts = {};
  for (const p of processes) {
    statusCounts[p.roadmap_status] = (statusCounts[p.roadmap_status] ?? 0) + 1;
    routeCounts[p.route_match] = (routeCounts[p.route_match] ?? 0) + 1;
  }
  console.log(`processes.json:                          ${processes.length} processes`);
  console.log(`  by roadmap_status:                     ${JSON.stringify(statusCounts)}`);
  console.log(`  by route_match:                        ${JSON.stringify(routeCounts)}`);
  console.log(`operations.json:                         ${operations.length} rows`);
  console.log(`process_routes.json:                     ${Object.keys(VERIFIED_ROUTES).length} routes, ${Object.values(VERIFIED_ROUTES).flat().length} ops transcribed (live page reports 68)`);
  console.log(`process_calculator_mapping_candidates.json: ${mappingCandidates.length} rows (all processes, none dropped)`);
  console.log(`taxonomy_tree.json:                      ${Object.keys(tree).length} top-level processes`);
}

main();
