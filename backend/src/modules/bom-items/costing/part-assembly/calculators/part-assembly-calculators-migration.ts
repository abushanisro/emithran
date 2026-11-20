import { loadPartAssemblyCalculatorSpec } from './part-assembly-calculator-spec';
import { buildDomainCalculatorsMigrationSql } from '../../shared/calculators/domain-calculators-migration';

export const PART_ASSEMBLY_CALCULATORS_MIGRATION = 1100;

/** The SQL of migrations/1100_part_assembly_calculators.sql, built from the spec. */
export function buildPartAssemblyCalculatorsMigrationSql(): string {
  return buildDomainCalculatorsMigrationSql(loadPartAssemblyCalculatorSpec(), {
    number: PART_ASSEMBLY_CALCULATORS_MIGRATION,
    title: 'Part Assembly calculators -- welding a weldment (MIG, spot, laser seam), its bevel prep and its grinding and brushing as real database calculators.',
    generator: 'scripts/generate-part-assembly-calculators-migration.ts',
    specPath: 'src/modules/bom-items/costing/part-assembly/calculators/part-assembly-calculators.json',
    rootCause: [
      'Part Assembly (memory/Part Assembly: welded parts) was staged (reference data 2026-PartAssembly: component load and weldment unload by weight,',
      'bevel cut speed by depth, laser seam travel speed; its machines in HR Rates, migrations 795 and 1098) but had no calculator and no cost engine:',
      'a part whose Process is Part Assembly was not costed. These are its calculators, one per catalog process: MIG welding by the wire',
      'deposition memory/Part Assembly gives (wire feed, wire section, arcEfficency, arc time standard), spot welding per spot, laser seam welding',
      'at the table travel speed, and the bevel cut, grinding, finish grinding and wire brushing along the welds (migration 1099 gives the catalog',
      'rows the machine classes they link by).',
    ].join('\n'),
  });
}
