#!/usr/bin/env node
// Deterministic, regenerable generator: turns the three checked-in reference
// files below into ONE frontend TS module the HR Rates page uses to drive its
// Process -> Route -> Operation -> Machine drill-down.
//
//   - process/process_machine_data.json  (24 canonical process names, each
//     with its reference default machine — the authoritative process list)
//   - process/process_operations.json    (512 "Process:Route:...Operation//
//     Feature" strings — the real route/operation taxonomy per process)
//   - machine/machine_library.json       (281 real USA machines across 15
//     categories — used to ground-truth which category, if any, actually
//     serves each process)
//
// The process -> category mapping below is NOT guessed: every entry was
// verified by looking up that process's own reference default machine (from
// process_machine_data.json) inside machine_library.json and reading off the
// category it's actually filed under. Where a process's default machine
// ("Default Plasma", "Default Shear", "Default Material Stock") does not
// exist anywhere in machine_library.json, that process is left with an empty
// category list — a genuine, documented capability gap (matches CLAUDE.md's
// Sheet Metal readiness checklist: Plasma has no cost engine yet, Shear and
// Material Stock have no machine_library category at all), not fabricated.
//
// "Generic Press" and "Std Press" share their reference default machine
// ("Default Press") with "Tandem Press", and that exact name is filed under
// BOTH the Progressive Die Press and Tandem Press categories in
// machine_library.json (a real, pre-existing duplicate — also why the specs
// backfill skips it) — so both processes list both categories rather than
// guessing a single one.
//
// Re-run any time machine_library.json / process_operations.json /
// process_machine_data.json changes:
//   node build-process-machine-map.mjs

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const MACHINE_LIBRARY_FILE = path.join(DIR, '../machine/machine_library.json');
const PROCESS_MACHINE_DATA_FILE = path.join(DIR, 'process_machine_data.json');
const PROCESS_OPERATIONS_FILE = path.join(DIR, 'process_operations.json');
const OUT_FILE = path.join(DIR, '../../../lib/data/process-machine-map.generated.ts');

// Ground-truthed via: for each process's reference machine in
// process_machine_data.json, find which machine_library.json category (if
// any) actually contains a machine with that exact name.
const PROCESS_TO_CATEGORIES = {
  '2 Axis Router': ['2-Axis Router'],
  '2 Roll Bending': ['3 Roll Bender'], // reference machine "Faccin HCU 300 X 1" is filed under 3 Roll Bender — a 3-roll bender also performs 2-roll bending
  '3 Roll Bending': ['3 Roll Bender'],
  '3D Laser': ['3D Laser Cutting Machine'],
  '4 Roll Bending': ['4 Roll Bender'],
  'Bend Brake': ['Bend Press Brake'],
  'CTL': ['Cut To Length Line (CTL)'],
  'Deslag': ['Deslag Machine'],
  'Fiber Laser Cut': ['Fiber Laser Cutting Machine'],
  'Generic Press': ['Progressive Die Press', 'Tandem Press'], // no dedicated category — reference machine "Default Press" is filed under both
  'Laser Cut': ['Laser Cutting Machine'],
  'Laser Punch': ['Laser Punch / Punch Press'],
  'Material Stock': [], // genuine gap — raw-material handling, no machine_library category
  'No Cost Feature': [], // by definition, no machine
  'OxyFuel Cut': ['Oxyfuel Cutting Machine'],
  'Plasma Cut': [], // genuine gap — "Default Plasma" does not exist in machine_library.json; matches CLAUDE.md's "Plasma ... no cost engine yet"
  'Plasma Punch': [], // genuine gap — "Whitney 3700 SST" does not exist in machine_library.json
  'Progressive Die': ['Progressive Die Press'],
  'Shear': [], // genuine gap — "Default Shear" does not exist in machine_library.json
  'Std Press': ['Progressive Die Press', 'Tandem Press'], // same ambiguity as Generic Press
  'Tandem Press': ['Tandem Press'],
  'Turret Press': ['Turret Press (Punch Press)'],
  'User-Defined Process': [], // no fixed machine pool by definition
  'Waterjet Cut': ['Waterjet Cutting Machine'],
};

function parseOperationEntry(entry) {
  const [process, ...rest] = entry.split(':');
  const last = rest[rest.length - 1] ?? '';
  const route = rest.length > 1 ? rest.slice(0, -1).join(':') : null;
  const [operation, feature] = last.includes('//') ? last.split('//') : [last, null];
  return { process, route, operation: operation || null, feature: feature ?? null };
}

function main() {
  const machineLibrary = JSON.parse(readFileSync(MACHINE_LIBRARY_FILE, 'utf8'));
  const processMachineData = JSON.parse(readFileSync(PROCESS_MACHINE_DATA_FILE, 'utf8'));
  const processOperations = JSON.parse(readFileSync(PROCESS_OPERATIONS_FILE, 'utf8'));

  // Verify PROCESS_TO_CATEGORIES stays truthful as the source files evolve:
  // every category name referenced must actually exist in machine_library.json.
  const realCategories = new Set(machineLibrary.categories.map((c) => c.machine_category));
  for (const [process, categories] of Object.entries(PROCESS_TO_CATEGORIES)) {
    for (const cat of categories) {
      if (!realCategories.has(cat)) {
        throw new Error(`PROCESS_TO_CATEGORIES["${process}"] references unknown category "${cat}" — machine_library.json categories changed, update the mapping.`);
      }
    }
  }
  const processNames = new Set(processMachineData.map((p) => p.process_name));
  for (const process of Object.keys(PROCESS_TO_CATEGORIES)) {
    if (!processNames.has(process)) {
      throw new Error(`PROCESS_TO_CATEGORIES has stale process "${process}" — not in process_machine_data.json anymore.`);
    }
  }
  for (const process of processNames) {
    if (!(process in PROCESS_TO_CATEGORIES)) {
      throw new Error(`process_machine_data.json has new process "${process}" not yet in PROCESS_TO_CATEGORIES — add it (ground-truth via its reference machine).`);
    }
  }

  // machine name (lowercased) -> category, for tagging real mhr_records rows client-side.
  const machineNameToCategory = {};
  for (const cat of machineLibrary.categories) {
    for (const m of cat.machines ?? []) {
      if (m.name) machineNameToCategory[String(m.name).toLowerCase().trim()] = cat.machine_category;
    }
  }

  // Route/operation taxonomy grouped by process, in source order.
  const operationsByProcess = {};
  for (const entry of processOperations) {
    const parsed = parseOperationEntry(entry);
    (operationsByProcess[parsed.process] ??= []).push(parsed);
  }

  // process_machine_data.json has one duplicate process_name ("2 Axis
  // Router", listed once with a generic "Default Machine" placeholder and
  // once with the real "2 Axis Router - 18,000 RPM") — dedupe by name,
  // preferring a real named machine over a "Default ..." placeholder so
  // SHEET_METAL_PROCESSES has exactly one entry per process (React key
  // uniqueness, and one canonical referenceMachine per process).
  const byName = new Map();
  for (const p of processMachineData) {
    const existing = byName.get(p.process_name);
    if (!existing || (String(existing.machine).startsWith('Default') && !String(p.machine).startsWith('Default'))) {
      byName.set(p.process_name, p);
    }
  }

  const processes = [...byName.values()].map((p) => ({
    name: p.process_name,
    referenceMachine: p.machine || null,
    categories: PROCESS_TO_CATEGORIES[p.process_name] ?? [],
    operations: operationsByProcess[p.process_name] ?? [],
  }));

  const ts = `// GENERATED FILE — do not hand-edit.
// Regenerate with: node memory/sheetmetal/process/build-process-machine-map.mjs
// Sources: memory/sheetmetal/process/process_machine_data.json,
//          memory/sheetmetal/process/process_operations.json,
//          memory/sheetmetal/machine/machine_library.json

export interface ProcessOperation {
  process: string;
  route: string | null;
  operation: string | null;
  feature: string | null;
}

export interface SheetMetalProcess {
  name: string;
  referenceMachine: string | null;
  /** machine_library.json category names that actually serve this process. Empty = documented gap, not fabricated. */
  categories: string[];
  operations: ProcessOperation[];
}

export const SHEET_METAL_PROCESSES: SheetMetalProcess[] = ${JSON.stringify(processes, null, 2)};

/** Lowercased machine name -> machine_library.json category. */
export const MACHINE_NAME_TO_CATEGORY: Record<string, string> = ${JSON.stringify(machineNameToCategory, null, 2)};
`;

  writeFileSync(OUT_FILE, ts, 'utf8');

  const withMachines = processes.filter((p) => p.categories.length > 0).length;
  console.log('=== build-process-machine-map.mjs summary ===');
  console.log(`Processes: ${processes.length} total, ${withMachines} with real machine_library data, ${processes.length - withMachines} documented gaps`);
  console.log(`Machines mapped: ${Object.keys(machineNameToCategory).length}`);
  console.log(`Output: ${OUT_FILE}`);
}

main();
