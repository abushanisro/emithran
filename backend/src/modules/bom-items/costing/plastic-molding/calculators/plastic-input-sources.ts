/**
 * Where a plastic-molding calculator input was read, structured (SourceRef, cost-breakdown.dto.ts), so the calculator dialog's eye opens that record
 * or table with the value's row outlined: a staged variable or lookup row of memory/Plastic Modeling (or memory/Secondary process), the selected
 * press's HR Rates record, the resin's Raw Materials record. A ref names only a place the value really was read from, and one the viewer endpoints
 * serve (processes.controller.ts: variables, reference-lookup, source-tables); a value with no such place carries none.
 */
import type { SourceRef } from '../../../dto/cost-breakdown.dto';
import { PLASTIC_REFERENCE_DOMAIN as PLASTIC_DOMAIN, SECONDARY_PROCESS_DOMAIN as SECONDARY_DOMAIN } from '../plastic-reference';

/** The Raw Materials record (raw_materials) a resin's values were read from. */
export interface MaterialRecord {
  id: string;
  name: string;
}

/** The HR Rates record (mhr_records) a press's values were read from: the dialog shows it among the machines of its class and location. */
export interface MachineRecord {
  id: string;
  name: string;
  machineClass: string;
  location: string | null;
}

export const plasticVariable = (name: string): SourceRef => ({ kind: 'variable', domain: PLASTIC_DOMAIN, name });
export const secondaryVariable = (name: string): SourceRef => ({ kind: 'variable', domain: SECONDARY_DOMAIN, name });

/** A staged memory/Plastic Modeling lookup table's column, and the row the value is in (every column/value of `row` identifies it). */
export const plasticLookup = (table: string, column: string, row: Record<string, string | number> | null): SourceRef =>
  ({ kind: 'lookup', domain: PLASTIC_DOMAIN, table, column, row });

/** A raw_materials column of the resin's record; none when the record is not known. */
export const materialColumn = (m: MaterialRecord | null | undefined, column: string): SourceRef | undefined =>
  (m ? { kind: 'material', materialId: m.id, materialName: m.name, column } : undefined);

/** An mhr_records column or specs key of the press's record; none when the record is not known. */
export const machineColumn = (m: MachineRecord | null | undefined, column: string): SourceRef | undefined =>
  (m ? { kind: 'machine', machineId: m.id, machineName: m.name, machineClass: m.machineClass, location: m.location, column } : undefined);

/** The seed with its ref, when it has one (a seed without a known source stays as it was). */
export const withRef = <T extends object>(seed: T, ref: SourceRef | undefined): T & { ref?: SourceRef } => (ref ? { ...seed, ref } : seed);
