import { buildDomainCalculatorsMigrationSql } from '../../../shared/calculators/domain-calculators-migration';
import { loadSandCastingCalculatorSpec } from './sand-casting-calculator-spec';

export const SAND_CASTING_CALCULATORS_MIGRATION = 956;

/** The SQL of migrations/956_sand_casting_calculators.sql, built from the spec. */
export function buildSandCastingCalculatorsMigrationSql(): string {
  return buildDomainCalculatorsMigrationSql(loadSandCastingCalculatorSpec(), {
    number: SAND_CASTING_CALCULATORS_MIGRATION,
    title: 'Sand casting calculators -- every sand step time and sizing rule as a real database calculator.',
    generator: 'scripts/generate-sand-casting-calculators-migration.ts',
    specPath: 'src/modules/bom-items/costing/casting/sand/calculators/sand-casting-calculators.json',
    rootCause: [
      'The sand-casting process catalog (migration 851) was seeded with calculator_id NULL and is_active false ("no cost',
      'engine built"), and no calculator held a sand formula. This creates the calculators; the mappings stay inactive',
      'until the route that uses them exists. Sizing steps (risers, gating, metal, core sand, core box) and the machine',
      'variants (manual shakeout, cleaning room) are helper calculators: no catalog operation maps to them.',
    ].join('\n'),
  });
}

export const SAND_HOT_BOX_PHYSICS_MIGRATION = 958;

/**
 * The SQL of migrations/958_sand_hot_box_physics.sql: the hot box calculator alone, as the spec has it now. Migration 956 created it with the cure
 * and strip times as literals (30 s, 10 s); a database that already ran 956 needs this one to get the physics (calculators are matched by name and
 * their fields replaced, so it is also harmless after a fresh 956).
 */
export function buildSandHotBoxPhysicsMigrationSql(): string {
  const spec = loadSandCastingCalculatorSpec();
  return buildDomainCalculatorsMigrationSql(
    { ...spec, calculators: spec.calculators.filter((c) => c.name === 'Sand Casting - Hot box coremaking') },
    {
      number: SAND_HOT_BOX_PHYSICS_MIGRATION,
      title: 'Sand casting hot box calculator -- the cure time from heat conduction, the strip time from the handling table.',
      generator: 'scripts/generate-sand-casting-calculators-migration.ts',
      specPath: 'src/modules/bom-items/costing/casting/sand/calculators/sand-casting-calculators.json',
      rootCause: [
        'Migration 956 gave the hot box calculator a cure time of 30 s and a strip time of 10 s written into its formulas (D143), the same for a',
        '0.1 kg and a 60 kg core. The cure time is the time for a depth of sand to reach the binder\'s cure temperature by conduction from the heated',
        'box (t = d^2 / (4 alpha erfinv(theta)^2)), the depth the smaller of the plant\'s strip criterion and half the core\'s smallest section; the',
        'strip and handling time is read from the handling table by the core\'s weight. The box temperature, the cure temperature and the depth are the',
        'plant\'s own settings and are set in the Cost Guide; none is assumed.',
        'The sand\'s sensible heat to the cure temperature (a lower bound) is priced with the energy price set in the Cost Guide.',
      ].join('\n'),
    },
  );
}
