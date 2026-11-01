import { Injectable } from '@nestjs/common';

import { ReferenceMemo } from '../../../../common/cache/reference-memo';
import { DatabaseService } from '../../../../common/database/database.service';

import type { ReferenceRowLike } from '../../domain/reference/coverage';

export interface ElectronicsReferenceRow extends ReferenceRowLike {
  value: number;
  unit: string;
  source: string;
  source_ref: string;
  note: string | null;
}

// Where a planned engine input is already stored: a numeric field of mhr_records.specs on a
// machine class. These specs are the one representation of machine capability on the
// platform (staged from memory/PCBA by migration 797 and its follow-ups), so engine inputs
// read them in place instead of keeping a second copy.
//
// Every one of these machines is a BARE-BOARD fabrication machine. A speed measured on one is
// real, but whether it holds for an assembled board is a judgement an EMS partner has to
// confirm, so each is reported as pending confirmation and an engine must not price from it.
interface SpecSource {
  machineClass: string;
  specKey: string;
  referenceKey: string;
  unit: string;
  note: string;
}

const PCB_SPEC_SOURCES: readonly SpecSource[] = [
  {
    machineClass: 'flying_probe',
    specKey: 'measurement_speed_cycles_per_s',
    referenceKey: 'test_flying_probe.measurement_speed',
    unit: 'cycles/s',
    note: 'Bare-board flying-probe tester. What one cycle measures, and whether the speed holds on an assembled board, is not stated in the source.',
  },
  {
    machineClass: 'pcb_router',
    specKey: 'cutting_speed_mm_per_s',
    referenceKey: 'depanel_router.cutting_speed',
    unit: 'mm/s',
    note: 'Bare-board fabrication router. Depaneling an assembled board is normally run slower; applicability needs partner confirmation.',
  },
  {
    machineClass: 'automated_optical_inspection',
    specKey: 'inspection_speed_mm2_per_s',
    referenceKey: 'aoi.inspection_speed',
    unit: 'mm2/s',
    note: 'Bare-board optical inspection. Post-reflow assembly AOI is a different inspection task; applicability needs partner confirmation.',
  },
];

interface MachineSpecRow {
  machine_class: string;
  machine_name: string;
  specs: Record<string, unknown> | null;
}

// Global reference data (the same rows for every organization, changed only by migration), so a
// short memo is safe. A miss or an empty result is never remembered.
@Injectable()
export class ElectronicsReferenceRepository {
  constructor(private readonly database: DatabaseService) {}

  @ReferenceMemo()
  async listRows(): Promise<ElectronicsReferenceRow[]> {
    const db = this.database.getPrivilegedClient('reference-data: electronics inputs read in place from PCB machine specs and electronics_reference_data, global shared rows');
    const [machines, partner] = await Promise.all([
      db
        .from('mhr_records')
        .select('machine_class, machine_name, specs')
        .eq('process_family', 'pcb')
        .eq('source_type', 'BENCHMARK')
        .in('machine_class', PCB_SPEC_SOURCES.map((s) => s.machineClass)),
      db.from('electronics_reference_data').select('key, scope, value, unit, status, source, source_ref, note').order('key').order('scope'),
    ]);
    if (machines.error) throw new Error(`mhr_records read failed: ${machines.error.message}`);
    if (partner.error) throw new Error(`electronics_reference_data read failed: ${partner.error.message}`);

    const fromSpecs = (machines.data as MachineSpecRow[]).flatMap((m) =>
      PCB_SPEC_SOURCES.filter((s) => s.machineClass === m.machine_class).flatMap((s) => {
        const value = Number(m.specs?.[s.specKey]);
        if (!Number.isFinite(value) || value <= 0) return [];
        return [
          {
            key: s.referenceKey,
            scope: m.machine_name,
            value,
            unit: s.unit,
            status: 'sourced_pending_confirmation' as const,
            source: 'Digital Factory reference export, staged machine specs',
            source_ref: String(m.specs?.source ?? `mhr_records.${m.machine_class}`),
            note: s.note,
          },
        ];
      }),
    );
    const fromPartner = (partner.data ?? []).map((r) => ({ ...r, value: Number(r.value) })) as ElectronicsReferenceRow[];
    return [...fromSpecs, ...fromPartner].sort((a, b) => a.key.localeCompare(b.key) || a.scope.localeCompare(b.scope));
  }
}
