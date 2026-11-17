/**
 * Writes migrations/1046_investment_casting_calculators.sql from the investment-casting calculator spec
 * (src/modules/bom-items/costing/casting/investment/calculators/investment-casting-calculators.json). Re-run after editing the
 * spec, until the migration is applied anywhere; after that a changed calculator ships in a new migration:
 *   npx ts-node --transpile-only scripts/generate-investment-casting-calculators-migration.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildInvestmentCastingCalculatorsMigrationSql, INVESTMENT_CASTING_CALCULATORS_MIGRATION } from '../src/modules/bom-items/costing/casting/investment/calculators/investment-casting-calculators-migration';

const OUT = join(__dirname, `../migrations/${INVESTMENT_CASTING_CALCULATORS_MIGRATION}_investment_casting_calculators.sql`);
writeFileSync(OUT, buildInvestmentCastingCalculatorsMigrationSql());
console.log(`wrote ${OUT}`);
