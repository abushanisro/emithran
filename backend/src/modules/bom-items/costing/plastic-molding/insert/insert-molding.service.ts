import { Injectable } from '@nestjs/common';

import { loadAssemblyMoldingCalculatorSpec } from './calculators/assembly-molding-calculator-spec';
import { INSERT_LOADER_CLASS } from './insert-molding';
import { DatabaseService } from '../../../../../common/database/database.service';
import { CalculatorCatalogService } from '../../../services/calculator-catalog.service';
import { SandMachineService } from '../../casting/sand/sand-machine.service';
import { readStagedReference } from '../../casting/sand/sand-reference.service';

import type { DbClient } from '../../../../../common/db/postgrest-client';
import type { SandMachine } from '../../casting/sand/sand-machines';
import type { SandReference } from '../../casting/sand/sand-reference';
import type { DomainCalculatorSpec } from '../../shared/calculators/domain-calculator-spec';
import type { ReferenceCalculatorDef } from '../../shared/calculators/reference-calculator';

/** What insert molding is priced with, or what is missing to price it. */
export type InsertMoldingInputs =
  | { ok: true; ref: SandReference; spec: DomainCalculatorSpec; calculators: Readonly<Record<string, ReferenceCalculatorDef>>; loaders: SandMachine[] }
  | { ok: false; missing: string[] };

/** Loads insert molding's staged reference data (2026-AssyMolding), its calculators (migration 1081) and the location's insert loaders. */
@Injectable()
export class InsertMoldingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly machines: SandMachineService,
    private readonly catalog: CalculatorCatalogService,
  ) {}

  private cached: SandReference | null = null;

  async inputs(client: DbClient, accessToken: string, location: string): Promise<InsertMoldingInputs> {
    const [read, calculators, loaders] = await Promise.all([
      this.cached ? Promise.resolve({ reference: this.cached, missing: [] as string[] }) : readStagedReference(this.database, '2026-AssyMolding', 'Assembly Molding', 863),
      this.catalog.loadAssemblyMoldingCalculators(accessToken),
      this.machines.getMachines(client, INSERT_LOADER_CLASS, location),
    ]);
    if (!read.reference) return { ok: false, missing: read.missing };
    this.cached = read.reference;
    const spec = loadAssemblyMoldingCalculatorSpec();
    const absent = spec.calculators.filter((c) => !calculators[c.name]).map((c) => c.name);
    if (absent.length) return { ok: false, missing: [`the assembly molding calculators are not in the database (run migration 1081): ${absent.join(', ')}`] };
    return { ok: true, ref: read.reference, spec, calculators, loaders };
  }
}
