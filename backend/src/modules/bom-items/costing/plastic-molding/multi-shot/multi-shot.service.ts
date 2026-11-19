import { Injectable } from '@nestjs/common';

import { loadAssemblyPlasticMoldingCalculatorSpec } from './calculators/assembly-plastic-molding-calculator-spec';
import { MULTI_SHOT_LOADER_CLASS, MULTI_SHOT_PRESS_CLASS, multiShotPressOf, type MultiShotPress } from './multi-shot';
import { DatabaseService } from '../../../../../common/database/database.service';
import { CalculatorCatalogService } from '../../../services/calculator-catalog.service';
import { SandMachineService } from '../../casting/sand/sand-machine.service';
import { readStagedReference } from '../../casting/sand/sand-reference.service';
import { PlasticReferenceService } from '../lookup/plastic-reference.service';

import type { DbClient } from '../../../../../common/db/postgrest-client';
import type { SandMachine } from '../../casting/sand/sand-machines';
import type { SandReference } from '../../casting/sand/sand-reference';
import type { DomainCalculatorSpec } from '../../shared/calculators/domain-calculator-spec';
import type { ReferenceCalculatorDef } from '../../shared/calculators/reference-calculator';

/** What multi-shot molding is priced with, or what is missing to price it. */
export type MultiShotInputs =
  | {
    ok: true; ref: SandReference; spec: DomainCalculatorSpec; calculators: Readonly<Record<string, ReferenceCalculatorDef>>;
    loaders: SandMachine[]; presses: MultiShotPress[]; tryouts: number;
  }
  | { ok: false; missing: string[] };

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * Loads multi-shot molding's staged reference data (2026-AssyPlastic), its calculators (migration 1086), and the location's loaders and
 * multi-shot presses with their attributes (migration 1085).
 */
@Injectable()
export class MultiShotService {
  constructor(
    private readonly database: DatabaseService,
    private readonly machines: SandMachineService,
    private readonly catalog: CalculatorCatalogService,
    private readonly plasticReference: PlasticReferenceService,
  ) {}

  private cached: SandReference | null = null;

  async inputs(client: DbClient, accessToken: string, location: string): Promise<MultiShotInputs> {
    const [read, calculators, loaders, pressRows] = await Promise.all([
      this.cached ? Promise.resolve({ reference: this.cached, missing: [] as string[] }) : readStagedReference(this.database, '2026-AssyPlastic', 'Assembly Plastic Molding', 863),
      this.catalog.loadAssemblyPlasticMoldingCalculators(accessToken),
      this.machines.getMachines(client, MULTI_SHOT_LOADER_CLASS, location),
      this.machines.getMachines(client, MULTI_SHOT_PRESS_CLASS, location),
    ]);
    if (!read.reference) return { ok: false, missing: read.missing };
    this.cached = read.reference;
    const spec = loadAssemblyPlasticMoldingCalculatorSpec();
    const absent = spec.calculators.filter((c) => !calculators[c.name]).map((c) => c.name);
    if (absent.length) return { ok: false, missing: [`the assembly plastic molding calculators are not in the database (run migration 1086): ${absent.join(', ')}`] };
    const tryouts = read.reference.number('defaultNumMultiShotTryOuts');
    if (tryouts == null || !(tryouts > 0)) return { ok: false, missing: ['Assembly Plastic Molding variable defaultNumMultiShotTryOuts'] };
    // The presses' typed clamp and shot (migration 1085), and their timing as the injection engine reads it.
    const ids = pressRows.map((m) => m.id);
    const [{ data: typed }, timing] = await Promise.all([
      client.from('mhr_records').select('id, max_tonnage, shot_capacity_grams').in('id', ids),
      this.plasticReference.getPressRecords(client, ids),
    ]);
    const typedById = new Map(((typed ?? []) as Array<Record<string, unknown>>).map((r) => [String(r['id']), r]));
    const presses = pressRows.flatMap((m) => {
      const t = typedById.get(m.id);
      const p = multiShotPressOf(m, { maxTonnage: num(t?.['max_tonnage']), shotCapacityG: num(t?.['shot_capacity_grams']) }, timing.get(m.id) ?? null);
      return p ? [p] : [];
    });
    if (pressRows.length > 0 && presses.length === 0) return { ok: false, missing: ['the multi-shot presses\' attributes (injection units, stations, tool index time, clamp, shot): run migration 1085'] };
    return { ok: true, ref: read.reference, spec, calculators, loaders, presses, tryouts };
  }
}
