import Ajv2020 from "ajv8/dist/2020";

import { CASTING_RESULT_SCHEMA } from "./casting-result-schema.generated";

// The casting worker's result.json (casting-worker/result.schema.json, version 1). Only what this module reads is typed; the whole
// document is stored as it came and validated against the full schema first.
export interface CastingResult {
  schema_version: 1;
  units: "mm";
  status: "complete" | "partial";
  model_glb: string | null;
  parts: {
    name?: string;
    glb?: string | null;
    casting?: { cores_glb?: string | null } | null;
  }[];
  diagnostics: { worker_version: string };
}

const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
  CASTING_RESULT_SCHEMA,
);

/** The worker's answer, checked against its contract; anything else is a worker bug, not a bad file. */
export function parseCastingResult(raw: unknown): CastingResult {
  if (!validate(raw)) {
    const first = (validate.errors ?? [])
      .slice(0, 3)
      .map((e) => `${e.instancePath || "/"} ${e.message}`);
    throw new Error(
      `the casting worker answered outside its result contract: ${first.join("; ")}`,
    );
  }
  return raw as unknown as CastingResult;
}
