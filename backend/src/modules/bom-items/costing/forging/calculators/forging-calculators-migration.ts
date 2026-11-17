import { buildDomainCalculatorsMigrationSql } from '../../shared/calculators/domain-calculators-migration';
import { loadForgingCalculatorSpec } from './forging-calculator-spec';

export const FORGING_CALCULATORS_MIGRATION = 1053;

/** The SQL of migrations/1053_forging_calculators.sql, built from the spec. */
export function buildForgingCalculatorsMigrationSql(): string {
  // The calculators 1053 created; a calculator added later ships in its own migration (it names it), so 1053 never changes once applied.
  return buildDomainCalculatorsMigrationSql(loadForgingCalculatorSpec(), {
    number: FORGING_CALCULATORS_MIGRATION,
    title: 'Forging calculators -- every step time and sizing rule of the closed-die hot forging route as a real database calculator.',
    generator: 'scripts/generate-forging-calculators-migration.ts',
    specPath: 'src/modules/bom-items/costing/forging/calculators/forging-calculators.json',
    rootCause: [
      'The forging process catalog (migration 823) was seeded with calculator_id NULL ("no cost engine built"), and no calculator',
      'held a forging formula, so a part whose Process is Forging was not costed at all. This creates the calculators of the',
      'closed-die route: band saw, induction heating, press and trim compute their catalog operations; the forged volume, the',
      'flash land, the bar stock, the press and trim forces and the dies are helper calculators no operation maps to.',
    ].join('\n'),
  }, (c) => c.migration == null);
}

export const FORGING_ROUTES_CALCULATORS_MIGRATION = 1054;

/** The SQL of migrations/1054_forging_routes_calculators.sql: the calculators of the routes beside the closed-die screw press. */
export function buildForgingRoutesCalculatorsMigrationSql(): string {
  // An entry 1054 shipped and a later migration replaced is still generated here, as it was.
  return buildDomainCalculatorsMigrationSql(loadForgingCalculatorSpec({ includeSuperseded: true }), {
    number: FORGING_ROUTES_CALCULATORS_MIGRATION,
    title: 'Forging route calculators -- furnace heating, the die hammer, the mechanical press, the open die press and ring rolling.',
    generator: 'scripts/generate-forging-calculators-migration.ts',
    specPath: 'src/modules/bom-items/costing/forging/calculators/forging-calculators.json',
    rootCause: [
      'Migration 1053 costed one forging route: closed-die forging on a screw press, its mult induction heated. A mult too thick or',
      'short for a coil had no heating step, and the hammer, the mechanical press, open die forging and ring rolling were not',
      'routes at all, although memory/Forging has their machines and rules. These calculators make each one a route the',
      'forging engine prices beside the screw press, and gas furnace heating the step for a mult no coil takes.',
    ].join('\n'),
  }, (c) => c.migration === FORGING_ROUTES_CALCULATORS_MIGRATION);
}

export const FORGING_HAMMER_ENERGY_MIGRATION = 1057;

/** The SQL of migrations/1057_forging_hammer_energy.sql: the hammer blow energy without the material counted twice. */
export function buildForgingHammerEnergyMigrationSql(): string {
  return buildDomainCalculatorsMigrationSql(loadForgingCalculatorSpec(), {
    number: FORGING_HAMMER_ENERGY_MIGRATION,
    title: 'Forging - Hammer energy, version 2 -- the material counted once, through its own flow law.',
    generator: 'scripts/generate-forging-calculators-migration.ts',
    specPath: 'src/modules/bom-items/costing/forging/calculators/forging-calculators.json',
    rootCause: [
      'Migration 1054 multiplied the hammer blow energy by materialTypeFactor\'s impact energy factor as well as by the material\'s own',
      'flow stress. That factor is the material\'s flow stress relative to carbon steel (stainless 0.59, aluminium 2.68, titanium and',
      'Inconel 0.47), so the material was counted twice and the wrong way round: a magnesium forging needed more blow energy than the',
      'same part in Inconel. The energy is now the deformation work at the material\'s own flow stress, times the plant\'s adjustment.',
    ].join('\n'),
  }, (c) => c.migration === FORGING_HAMMER_ENERGY_MIGRATION);
}
