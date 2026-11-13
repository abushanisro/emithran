import { buildDomainCalculatorsMigrationSql, type DomainMigrationText } from '../../shared/calculators/domain-calculators-migration';
import { loadPlasticMoldingCalculatorSpec } from './plastic-molding-calculator-spec';

/**
 * Migration 975 created the five plastic-molding calculators and is applied wherever the platform runs: it is history and is never edited. So is 977
 * (the fill-factor tables of injection, structural foam and LSR): its file is kept as committed, and the generator no longer writes it. A calculator in use is changed by a
 * NEW migration, which writes the calculators whose spec `migration` is its number (and raises their `version` when their formulas change, calculators.version, migration 428).
 *   976  the reaction injection calculator, version 2 (fill time added)
 *   977  the injection, structural foam and LSR calculators: their fill-factor inputs name the reference table they are read from, so the cost dialog's eye opens it
 *        (field metadata only: no formula changes, so no new version)
 *   1007 the injection and structural foam calculators, version 2: plasticizing and ejection in the cycle, the injection rate share, no pack phase on top of cooling
 */
export const PLASTIC_MOLDING_CALCULATOR_MIGRATIONS = [976, 1007] as const;
export type PlasticMoldingCalculatorMigration = (typeof PLASTIC_MOLDING_CALCULATOR_MIGRATIONS)[number];

const GENERATOR = 'scripts/generate-plastic-molding-calculators-migration.ts';
const SPEC = 'src/modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculators.json';

const TEXT: Record<PlasticMoldingCalculatorMigration, Pick<DomainMigrationText, 'title' | 'rootCause'>> = {
  976: {
    title: 'Reaction injection molding calculator, version 2 -- the fill time (part volume over the staged machine injection rate).',
    rootCause: [
      'The reaction injection cycle time (migration 975) was the machine dry cycle plus the material cure time: the staged machine injection rate',
      '(rates.injectionRateMm3PerS) was not used, so a larger part filled in no time. The approved fill time is the total shot volume (mm3) over the',
      'injection rate (mm3/s), in seconds (formula registry F-19, ASSUMED: the reference states the rate but no RIM fill formula). The calculator is',
      'replaced under version 2 (a calculator in use is not edited in place under its version); the others are unchanged.',
    ].join('\n'),
  },
  1007: {
    title: 'Injection and structural foam calculators, version 2 -- plasticizing and ejection in the cycle; holding pressure no longer counted twice.',
    rootCause: [
      'The injection cycle (migration 975) was fill + pack + cooling + mold open/close. The Menges cooling time runs from the end of filling to ejection, and',
      'holding pressure acts inside that time, so the separate pack phase (35 % of cooling, at least 2 s) counted it twice. The reference states the inputs of',
      'the phases the cycle left out, read by nothing: the press plasticizing rate (or plasticizingRateByClampForce) with plasticizingRateMultiplier, the',
      'ejector variables (ejectorDistanceFactor, ejectorPercentMaxMachineVelocity, numEjectorCycles, dryCycleStrokeFactor) and injectionRateMultiplier.',
      'Version 2: cycle = injection + cooling + the plasticizing that outlasts cooling + ejection (mold open/close + the ejector stroke), each a calculator',
      'field shown on the line (formula registry F-05 v2, F-08 v2, F-20, F-21). The calculators are replaced under version 2; LSR, compression and RIM are',
      'unchanged.',
    ].join('\n'),
  },
};

/** The SQL of migrations/<number>_*.sql: the calculators of the spec that this migration writes. */
export function buildPlasticMoldingCalculatorsMigrationSql(number: PlasticMoldingCalculatorMigration): string {
  return buildDomainCalculatorsMigrationSql(
    loadPlasticMoldingCalculatorSpec(),
    { number, generator: GENERATOR, specPath: SPEC, ...TEXT[number] },
    (c) => c.migration === number,
  );
}

export const PLASTIC_MOLDING_CALCULATOR_MIGRATION_FILES: Record<PlasticMoldingCalculatorMigration, string> = {
  976: '976_plastic_rim_fill_time_calculator.sql',
  1007: '1007_plastic_injection_cycle_plasticizing_ejection.sql',
};
