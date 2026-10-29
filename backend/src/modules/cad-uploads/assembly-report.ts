import Ajv2020 from 'ajv8/dist/2020';

import { ASSEMBLY_SCHEMA } from './assembly-schema.generated';

// The cad-engine POST /analyze/assembly result (cad-engine/contract/assembly.schema.json, version 1).
export interface AssemblyNode {
  definition: string;
  name: string;
  kind: 'part' | 'assembly' | 'empty_assembly';
  quantity: number;
  file: string;
  children: AssemblyNode[];
}

export interface AssemblyPart {
  id: string;
  name: string;
  file: string;
  quantity_total: number;
  volume_mm3: number | null;
  surface_area_mm2: number | null;
  bounding_box: { length: number; width: number; height: number; diagonal: number } | null;
}

export interface AssemblyReport {
  schema_version: 1;
  units: 'mm';
  status: 'complete' | 'partial';
  inputs: { file: string; status: 'ok' | 'unreadable'; inside: string | null }[];
  assembly: AssemblyNode[];
  parts: AssemblyPart[];
  problems: { part: string; code: string }[];
}

const validate = new Ajv2020({ allErrors: true, strict: false }).compile(ASSEMBLY_SCHEMA);

/** The engine's answer, checked against the contract; anything else is an engine bug, not a bad upload. */
export function parseAssemblyReport(raw: unknown): AssemblyReport {
  if (!validate(raw)) {
    const first = (validate.errors ?? []).slice(0, 3).map((e) => `${e.instancePath || '/'} ${e.message}`);
    throw new Error(`cad-engine answered outside its assembly contract: ${first.join('; ')}`);
  }
  return raw as unknown as AssemblyReport;
}
