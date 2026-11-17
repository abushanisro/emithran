// The forging reference data (memory/Forging), staged by migration 823 under its own source version: the named variables of
// forging_variables.csv and the lookup tables of Lookup/. It is read with the same reader as the sand reference (sand-reference.ts): what the
// data says for a name, never a substitute for a value it lacks.
import MANIFEST from '../../../processes/memory-reference-domains.json';

/** The reference-data domain of memory/Forging (processes/memory-reference-domains.json). */
export const FORGING_DOMAIN = 'forging';
const DOMAIN = MANIFEST.domains.find((d) => d.key === FORGING_DOMAIN)!;
export const FORGING_SOURCE_VERSION: string = DOMAIN.sourceVersion;
export const FORGING_PROCESS_GROUP = 'Forging';
/** The migration that staged memory/Forging. */
export const FORGING_STAGED_BY = Number(DOMAIN.stagedBy);

/** The HR Rates machine classes of the closed-die route's steps (migration 824; Preheat and Reheat share the oven furnaces). */
export const FORGING_CLASS = {
  bandSaw: 'forging_band_saw',
  induction: 'forging_conveyor_induction_heat',
  furnace: 'forging_oven_furnace',
  press: 'forging_press',
  mechanicalPress: 'forging_mechanical_press',
  hammer: 'forging_hammer',
  trim: 'forging_trim',
} as const;

export const FORGING_ROUTE_CLASSES: readonly string[] = Object.values(FORGING_CLASS);

/**
 * The two tables the forging calculators read that memory/Forging does not have: published rules, staged beside the reference data by
 * migration 1050 with their source in the row's notes.
 */
export const FORGING_PUBLISHED_TABLES = {
  /** Flash mass per length of parting line by forging mass, steel (National Association of Drop Forgings). */
  flashMass: 'forging_tblFlashMassPerPeriphery',
  /** The ram speed range of each kind of forging machine (Altan; Kalpakjian). */
  equipmentSpeed: 'forging_tblEquipmentSpeed',
} as const;
