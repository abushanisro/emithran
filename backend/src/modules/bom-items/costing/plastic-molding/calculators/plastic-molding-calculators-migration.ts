import { buildDomainCalculatorsMigrationSql, type DomainMigrationText } from '../../shared/calculators/domain-calculators-migration';
import { loadPlasticMoldingCalculatorSpec } from './plastic-molding-calculator-spec';

/**
 * Migration 975 created the five plastic-molding calculators and is applied wherever the platform runs: it is history and is never edited. So are 977,
 * 1007, 1012, 1013, 1014, 1016, 1017, 1018, 1019, 1020 and 1022: their files are kept as committed, and the generator no longer writes them. A calculator in use is changed by a
 * NEW migration, which writes the calculators whose spec `migration` is its number (and raises their `version` when their formulas change, calculators.version, migration 428).
 *   976  the reaction injection calculator, version 2 (fill time added)
 *   977  the injection, structural foam and LSR calculators: their fill-factor inputs name the reference table they are read from, so the cost dialog's eye opens it
 *        (field metadata only: no formula changes, so no new version)
 *   1007 the injection and structural foam calculators, version 2 (plasticizing and ejection; no pack phase), reverted by 1008
 *   1008 the injection and structural foam calculators, version 3: the version-1 fields and formulas again (fill + pack + cooling + mold open/close)
 *   1010 the injection molding deflashing calculator: the parting line length over the manual flash trimming rate
 *   1012 the injection mold tooling calculator: components + toolroom labour, molds required, cost per part
 *   1013 the injection mold tooling calculator, version 2: the mold base plate steel (standard base, plate stack, default tool steel)
 *   1014 the injection mold tooling calculator, version 3: the cavity and core machining (hours per square inch by complexity) and polish
 *   1016 the injection mold tooling calculator, version 4: the mold assembly extras (ejector pins, sprue bushing, locating ring, try-out)
 *   1017 the injection mold tooling calculator, version 5: the slide and lifter blocks (steel, machining, CMM inspection)
 *   1018 the injection mold tooling calculator, version 6: the heat treatment of the mold steel
 *   1019 the injection mold tooling calculator, version 7: the cooling lines
 *   1020 the injection mold tooling calculator, version 8: the rib inserts and their EDM
 *   1021 the injection molding slide movement calculator: the hydraulic slides' movement in each shot
 *   1022 the injection mold tooling calculator, version 9: heat treatment by steel grade, and the hot drops
 *   1023 the injection molding visual inspection and weight check calculators
 *   1024 the injection molding material drying calculator
 *   1082 the injection mold tooling calculator, version 10: the water baffles (1022, version 9, is now history and kept as committed)
 *   1083 the injection molding gate trimming calculator
 *   1084 the injection molding insert pull test calculator
 */
export const PLASTIC_MOLDING_CALCULATOR_MIGRATIONS = [976, 1008, 1010, 1021, 1023, 1024, 1082, 1083, 1084] as const;
export type PlasticMoldingCalculatorMigration = (typeof PLASTIC_MOLDING_CALCULATOR_MIGRATIONS)[number];

const GENERATOR = 'scripts/generate-plastic-molding-calculators-migration.ts';
const SPEC = 'src/modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculators.json';

const TEXT: Record<PlasticMoldingCalculatorMigration, Pick<DomainMigrationText, 'title' | 'rootCause'>> = {
  1084: {
    title: 'Injection molding insert pull test calculator -- a destructive AQL sample pulled to failure.',
    rootCause: [
      'An insert-molded part is routed an insert pull test, but it was reported as having no sourced data. The costing engineer\'s research found no',
      'published standard time or frequency, so the test is modelled from what is sourced: the AQL special inspection sample sizes of memory/Secondary',
      'process (CMMInspection at defaultCMMInspection; ISO 2859-1 uses special levels for destructive tests), the published pull-out test speed (5 mm/min),',
      'the Mark-10 2026 list price of a pull-test station (rate by the machine-hour pattern of migration 580), with the handling, seating, approach and',
      'recording times as stated estimates (reference/quality-inspection-reference.csv). Each sampled part is scrapped. Formula registry F-40.',
    ].join('\n'),
  },
  1083: {
    title: 'Injection molding gate trimming calculator -- each gate cut at the manual trim rate.',
    rootCause: [
      'A cold-runner edge-gated part is routed gate trimming, but it was reported as not costed: the reference stages manualTrimRate (12.7, mm/s in',
      'memory/Roto & blow molding) but no gate size. This calculator sizes the edge gate by the standard rule w = n x sqrt(A) / 30 (Pye, Injection Mould',
      'Design; n by material in reference/gate-sizing-reference.csv) and times the cut as the gates per cavity x w / manualTrimRate, per part (formula',
      'registry F-38, ASSUMED). A helper: the injection engine runs it for the routed gate trimming and charges it at the bench rate.',
    ].join('\n'),
  },
  1082: {
    title: 'Injection mold tooling calculator, version 10 -- the water baffles.',
    rootCause: [
      'Every mold carried "excludes water baffles (no data yet)": registry gap G-06 read only waterBafflesCost, with no count. memory/Assembly plastic',
      'molding (2026-AssyPlastic) holds the baffle spacing in the cavity and core plates (baffleSpacing 76.2 mm), the price (8 USD), the assembly time (0.15 h)',
      'and the tapping time (0.75 h each, 4 h setup per tool). Version 10 counts one row of baffles along each plate, baffleSpacing apart over the mold base',
      'length (formula registry F-37, ASSUMED: approved 2026-11-18), and prices them with those values. Replaced under version 10 (a calculator in use is',
      'not edited in place).',
    ].join('\n'),
  },
  1024: {
    title: 'Injection molding material drying calculator -- a machine-mounted desiccant dryer running with the press.',
    rootCause: [
      'Material drying is routed for a hygroscopic resin but was reported as having no sourced data. The reference package now holds manufacturer drying',
      'conditions (BASF, Covestro, Celanese, Lotte, Arkema), Bry-Air dryer throughput and rated power, a published (used) dryer price, and the press',
      'economics of memory/. This calculator charges the dryer\'s hour, ownership by the machine-hour rate pattern of migration 580 plus rated power at',
      'the location\'s electricity price, with the press time per part (the costing engineer\'s throughput model; formula registry F-36, ASSUMED).',
    ].join('\n'),
  },
  1023: {
    title: 'Injection molding visual inspection and weight check calculators.',
    rootCause: [
      'Visual inspection is routed for every molded part, but it was reported as having no sourced data. An audit of memory/ found it staged under',
      'Secondary process (2026-Secondary): visualInspectTimeStandard, 5 min per square metre of part surface, and defaultPercentToBeTested, 100 %.',
      'This calculator times the inspection as the surface area x that rate x the share inspected, per part (formula registry F-34). A helper: the',
      'injection engine runs it for the routed visual inspection and charges it at the bench rate. The weight check calculator times one check of 10 s',
      'every 1,000 parts by the press operator (the costing engineer\'s defaults) and derives the bench scale\'s hourly rate from its price (OHAUS',
      'Defender 3000) with the machine-hour rate pattern of migration 580 (formula registry F-35).',
    ].join('\n'),
  },
  1021: {
    title: 'Injection molding slide movement calculator -- the hydraulic slides\' movement in each shot.',
    rootCause: [
      'A part with a slide is routed a side action, but its time was not costed: the engine read no slide speed. The reference stages slideCycleRate',
      '(100, Velocity) and the CAD engine measures each slide bundle\'s stroke. This calculator times the slides moving out and back once per shot, all',
      'together, as 2 x the longest stroke / slideCycleRate (read as mm/s), per part (formula registry F-32, ASSUMED). A helper: no catalog operation',
      'maps to it; the injection engine runs it for the routed side action and charges it at the press rate. Lifters add no time.',
    ].join('\n'),
  },
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
  1021: '1021_plastic_slide_movement_calculator.sql',
  1023: '1023_plastic_inspection_calculators.sql',
  1024: '1024_plastic_material_drying_calculator.sql',
  1082: '1082_plastic_mold_water_baffles.sql',
  1083: '1083_plastic_gate_trimming_calculator.sql',
  1084: '1084_plastic_insert_pull_test_calculator.sql',
};
