// The investment-casting reference data (memory/Casting Investment), staged by migration 874 under its own source version: the named
// variables of investment_casting_variables.csv and the lookup tables of Lookup/. It is read with the same reader as the sand reference
// (sand-reference.ts): what the data says for a name, never a substitute for a value it lacks.
import MANIFEST from '../../../../processes/memory-reference-domains.json';

/** The reference-data domain of memory/Casting Investment (processes/memory-reference-domains.json). */
export const INVESTMENT_DOMAIN = 'casting_investment';
const DOMAIN = MANIFEST.domains.find((d) => d.key === INVESTMENT_DOMAIN)!;
export const INVESTMENT_SOURCE_VERSION: string = DOMAIN.sourceVersion;
export const INVESTMENT_PROCESS_GROUP = 'Casting Investment';

const machineClass = (process: string) => `casting_investment_${process}`;

/** The HR Rates machine classes of the route's steps (migrations 869 and 872). */
export const INVESTMENT_CLASS = {
  waxPattern: machineClass('wax_pattern_molding'),
  bench: machineClass('bench_operation'),
  primaryDip: machineClass('primary_slurry_dipping'),
  primarySand: machineClass('primary_sand_coating'),
  secondaryDip: machineClass('secondary_slurry_dipping'),
  secondarySand: machineClass('secondary_sand_coating'),
  robot: machineClass('robotic_assist'),
  flashFire: machineClass('flash_fire_de_waxing'),
  autoclave: machineClass('steam_autoclave_de_waxing'),
  burnout: machineClass('mold_burnout'),
  preheat: machineClass('mold_preheating'),
  pouring: machineClass('metal_pouring'),
  cooling: machineClass('cooling'),
  knockout: machineClass('knockout'),
  bandSaw: machineClass('band_saw'),
  beltSand: machineClass('belt_sand'),
} as const;

export const INVESTMENT_ROUTE_CLASSES: readonly string[] = Object.values(INVESTMENT_CLASS);
