// Heat-treatment calculators against the real database. Needs migration 907 applied:
// every heat-treatment operation must resolve to its calculator, with every input
// field of the spec, so a line is computed by the calculator and never by a fallback.
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { parseEnv } from 'util';
import { BOMItemsModule } from '../src/modules/bom-items/bom-items.module';
import { CalculatorCatalogService } from '../src/modules/bom-items/services/calculator-catalog.service';
import { loadHeatTreatmentCalculatorSpec } from '../src/modules/bom-items/costing/heat/calculators/heat-treatment-calculator-spec';
import { HEAT_TREATMENT_PROCESSES } from '../src/modules/bom-items/costing/heat/heat-treatment-engine';

jest.setTimeout(120_000);

describe('[e2e] heat-treatment calculators (run migration 907 first)', () => {
  let catalog: CalculatorCatalogService;
  let token: string;
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: path.resolve(__dirname, '../.env') }), BOMItemsModule],
    }).compile();
    const config = moduleRef.get(ConfigService);
    const env = parseEnv(fs.readFileSync(path.resolve(__dirname, '../../.env.local'), 'utf8'));
    const anon = createClient(config.getOrThrow<string>('SUPABASE_URL'), config.getOrThrow<string>('SUPABASE_ANON_KEY'));
    const { data, error } = await anon.auth.signInWithPassword({ email: env.E2E_EMAIL!, password: env.E2E_PASSWORD! });
    if (error || !data.session) throw new Error(`sign-in failed: ${error?.message}`);
    token = data.session.access_token;
    catalog = moduleRef.get(CalculatorCatalogService);
  });

  it('every heat-treatment process resolves to its calculator with all the spec fields', async () => {
    const loaded = await catalog.loadHeatTreatmentCalculators(token);
    const spec = loadHeatTreatmentCalculatorSpec();
    for (const { process } of HEAT_TREATMENT_PROCESSES) {
      const def = loaded[process];
      expect(def).toBeDefined();
      const calc = spec.calculators.find((c) => c.operations.includes(process))!;
      expect(def!.name).toBe(calc.name);
      expect(def!.fields.map((f) => f.field_name)).toEqual(calc.fields.map((f) => f.name));
    }
  });
});
