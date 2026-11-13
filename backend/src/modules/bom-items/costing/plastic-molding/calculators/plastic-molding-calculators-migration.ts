import { buildDomainCalculatorsMigrationSql, type DomainMigrationText } from '../../shared/calculators/domain-calculators-migration';
import { loadPlasticMoldingCalculatorSpec } from './plastic-molding-calculator-spec';

/**
 * Migration 975 created the five plastic-molding calculators and is applied wherever the platform runs: it is history and is never edited. A calculator in use is changed by a
 * NEW migration, which writes the calculators whose spec `migration` is its number (and raises their `version` when their formulas change, calculators.version, migration 428).
 *   976  the reaction injection calculator, version 2 (fill time added)
 *   977  the injection, structural foam and LSR calculators: their fill-factor inputs name the reference table they are read from, so the cost dialog's eye opens it
 *        (field metadata only: no formula changes, so no new version)
 */
export const PLASTIC_MOLDING_CALCULATOR_MIGRATIONS = [976, 977] as const;
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
  977: {
    title: 'Injection, structural foam and LSR calculators -- the fill-factor inputs name the reference table they are read from.',
    rootCause: [
      'The two fill factors of the injection cycle time (Fill Factor for Cavities and for Gates) are read from the staged table injectionTimeAdjustmentFactors,',
      'but their calculator fields carried no data source, source table or source field, so the cost dialog had no table to open behind them. They now name',
      'the table (data_source machining_lookup: a table staged in machining_reference_data; source_field adjustment_factor), and the engine reports the row it',
      'used on the line. Field metadata only: no formula, input or unit changes, so the calculators keep their version.',
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
  977: '977_plastic_fill_factor_lookup_tables.sql',
};
