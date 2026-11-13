import { buildDomainCalculatorsMigrationSql, type DomainMigrationText } from '../../shared/calculators/domain-calculators-migration';
import { loadPlasticMoldingCalculatorSpec } from './plastic-molding-calculator-spec';

/**
 * Migration 975 created the five plastic-molding calculators and is applied wherever the platform runs: it is history and is never edited. So are 977
 * and 1007: their files are kept as committed, and the generator no longer writes them. A calculator in use is changed by a
 * NEW migration, which writes the calculators whose spec `migration` is its number (and raises their `version` when their formulas change, calculators.version, migration 428).
 *   976  the reaction injection calculator, version 2 (fill time added)
 *   977  the injection, structural foam and LSR calculators: their fill-factor inputs name the reference table they are read from, so the cost dialog's eye opens it
 *        (field metadata only: no formula changes, so no new version)
 *   1007 the injection and structural foam calculators, version 2 (plasticizing and ejection; no pack phase), reverted by 1008
 *   1008 the injection and structural foam calculators, version 3: the version-1 fields and formulas again (fill + pack + cooling + mold open/close)
 *   1010 the injection molding deflashing calculator: the parting line length over the manual flash trimming rate
 */
export const PLASTIC_MOLDING_CALCULATOR_MIGRATIONS = [976, 1008, 1010] as const;
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
  1008: {
    title: 'Injection and structural foam calculators, version 3 -- the version-1 cycle again (reverts 1007).',
    rootCause: [
      'Migration 1007 replaced the injection and structural foam cycle (fill + pack + cooling + mold open/close) with version 2 (injection + cooling +',
      'plasticizing beyond cooling + ejection). That change is reverted by decision: the cycle stays as it was. A migration that has run is never',
      'edited or removed, so this one writes the version-1 fields and formulas again under version 3 (a calculator in use is not changed in place',
      'under its version). A database that never ran 1007 gets the same calculators. LSR, compression and RIM are unchanged.',
    ].join('\n'),
  },
  1010: {
    title: 'Injection molding deflashing calculator -- the parting line length over the manual flash trimming rate.',
    rootCause: [
      'Deflashing is routed for an injection-molded part with a complex parting line, but it was not costed: the engine knew of no rate. The reference stages',
      'cmManualFlashTrimmingRate (75, Length/Time) for compression molding, and the CAD engine measures the parting line length. This calculator times',
      'the trim as length / rate (formula registry F-24, ASSUMED: the rate is borrowed from compression molding and read as mm/s). A helper: no catalog',
      'operation maps to it; the injection engine runs it for the routed deflashing step.',
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
  1008: '1008_plastic_injection_cycle_restore_v1.sql',
  1010: '1010_plastic_deflashing_calculator.sql',
};
