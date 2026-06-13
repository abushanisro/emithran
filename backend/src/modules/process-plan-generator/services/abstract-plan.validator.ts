/**
 * Runtime validator for the LLM-emitted AbstractPlan.
 *
 * We do NOT use class-validator here because the input is raw JSON from
 * Anthropic, not a class instance. We do NOT add zod as a backend
 * dependency because the rest of the backend uses class-validator and the
 * shape we need to validate is small enough that a focused hand-written
 * validator is clearer and faster than wiring up a new tool.
 *
 * The validator returns either { ok: true, plan } or
 * { ok: false, errors: string[] }. The orchestrator passes errors back to
 * the LLM as a tool_result so it can self-correct on retry.
 */

import type { AbstractPlan, AbstractProposedMaster } from '../dto/abstract-plan.dto';
import type { CandidateSet } from '../dto/candidate-set.dto';

export type ValidationResult =
  | { ok: true; plan: AbstractPlan }
  | { ok: false; errors: string[] };

const PART_FAMILIES = ['cnc_turned', 'cnc_milled', 'sheet_metal'] as const;
const TOOLING_TYPES = ['cutting_tool', 'fixture', 'jig', 'gauge', 'die', 'mold', 'other'] as const;
const LOGISTICS_TYPES = ['packaging', 'inbound', 'outbound', 'storage'] as const;
const TRANSPORT_MODES = ['road', 'rail', 'air', 'sea'] as const;
const COST_BASES = ['per_unit', 'per_batch', 'per_kg', 'per_km'] as const;
const SKILL_LEVELS = ['Unskilled', 'Semi-Skilled', 'Skilled', 'Highly Skilled'] as const;

// ─── Small primitives ────────────────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isPositiveNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;

const isPercentage = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;

const isOverheadPct = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1000;

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0;

const isOneOf = <T extends readonly string[]>(v: unknown, allowed: T): v is T[number] =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v);

// ─── Candidate-ID prefix validators (against the actual CandidateSet) ────────

function makeCandidateChecker(
  prefix: string,
  candidates: { candidateId: string }[],
) {
  const valid = new Set(candidates.map((c) => c.candidateId));
  return (id: unknown, path: string, errors: string[]): boolean => {
    if (typeof id !== 'string' || !id.startsWith(prefix + '-')) {
      errors.push(`${path}: expected candidateId with prefix '${prefix}-', got ${JSON.stringify(id)}`);
      return false;
    }
    if (!valid.has(id)) {
      errors.push(`${path}: unknown candidateId '${id}' (not in CandidateSet)`);
      return false;
    }
    return true;
  };
}

// ─── Main entry point ────────────────────────────────────────────────────────

export function validateAbstractPlan(
  raw: unknown,
  candidates: CandidateSet,
): ValidationResult {
  const errors: string[] = [];

  if (!isObject(raw)) {
    return { ok: false, errors: ['plan must be an object'] };
  }

  const checkRm = makeCandidateChecker('rm', candidates.rawMaterials);
  const checkMc = makeCandidateChecker('mc', candidates.machines);
  const checkLb = makeCandidateChecker('lb', candidates.labour);
  const checkOp = makeCandidateChecker('op', candidates.processes);
  const checkCl = makeCandidateChecker('cl', candidates.calculators);

  // Collect proposedMasterIds so per-line references can validate against them
  const proposedMasterIds = new Set<string>();
  if (Array.isArray(raw.proposedMasters)) {
    for (const pm of raw.proposedMasters as unknown[]) {
      if (isObject(pm) && typeof pm.proposedMasterId === 'string') {
        proposedMasterIds.add(pm.proposedMasterId);
      }
    }
  }

  // ── partFamily ──
  if (!isOneOf(raw.partFamily, PART_FAMILIES)) {
    errors.push(`partFamily must be one of ${PART_FAMILIES.join(', ')}`);
  }

  // ── rawMaterials[] ──
  if (!Array.isArray(raw.rawMaterials)) {
    errors.push('rawMaterials must be an array');
  } else if (raw.rawMaterials.length === 0) {
    errors.push('rawMaterials must contain at least 1 line — every manufactured part has a material');
  } else {
    raw.rawMaterials.forEach((line, i) => {
      const p = `rawMaterials[${i}]`;
      if (!isObject(line)) { errors.push(`${p}: must be an object`); return; }
      const hasCandidate = typeof line.candidateId === 'string';
      const hasProposed = typeof line.proposedMasterId === 'string';
      if (hasCandidate === hasProposed) {
        errors.push(`${p}: exactly one of candidateId or proposedMasterId must be set`);
      } else if (hasCandidate) {
        checkRm(line.candidateId, `${p}.candidateId`, errors);
      } else if (!proposedMasterIds.has(line.proposedMasterId as string)) {
        errors.push(`${p}.proposedMasterId: '${line.proposedMasterId}' not declared in proposedMasters[]`);
      }
      if (!isPositiveNumber(line.grossUsageKg)) errors.push(`${p}.grossUsageKg: must be positive number`);
      if (!isPositiveNumber(line.netUsageKg)) errors.push(`${p}.netUsageKg: must be positive number`);
      if (typeof line.grossUsageKg === 'number' && typeof line.netUsageKg === 'number' && line.grossUsageKg < line.netUsageKg) {
        errors.push(`${p}: grossUsageKg (${line.grossUsageKg}) must be >= netUsageKg (${line.netUsageKg})`);
      }
      if (!isPercentage(line.scrapPct)) errors.push(`${p}.scrapPct: must be 0..100`);
      if (!isOverheadPct(line.overheadPct)) errors.push(`${p}.overheadPct: must be 0..1000`);
      if (!isNonEmptyString(line.reason)) errors.push(`${p}.reason: required, non-empty string`);
      else if ((line.reason as string).length > 240) errors.push(`${p}.reason: max 240 chars (got ${(line.reason as string).length})`);
    });
  }

  // ── processes[] ──
  if (!Array.isArray(raw.processes)) {
    errors.push('processes must be an array');
  } else if (raw.processes.length === 0) {
    errors.push('processes must contain at least 1 operation');
  } else {
    raw.processes.forEach((line, i) => {
      const p = `processes[${i}]`;
      if (!isObject(line)) { errors.push(`${p}: must be an object`); return; }
      if (typeof line.opNbr !== 'number' || !Number.isInteger(line.opNbr) || line.opNbr <= 0) {
        errors.push(`${p}.opNbr: positive integer required`);
      }
      const hasCandidate = typeof line.candidateId === 'string';
      const hasProposed = typeof line.proposedMasterId === 'string';
      if (hasCandidate === hasProposed) {
        errors.push(`${p}: exactly one of candidateId or proposedMasterId must be set`);
      } else if (hasCandidate) {
        checkOp(line.candidateId, `${p}.candidateId`, errors);
      } else if (!proposedMasterIds.has(line.proposedMasterId as string)) {
        errors.push(`${p}.proposedMasterId: '${line.proposedMasterId}' not declared in proposedMasters[]`);
      }
      checkMc(line.machineCandidateId, `${p}.machineCandidateId`, errors);
      checkLb(line.labourCandidateId, `${p}.labourCandidateId`, errors);
      if (line.calculatorCandidateId !== null && line.calculatorCandidateId !== undefined) {
        checkCl(line.calculatorCandidateId, `${p}.calculatorCandidateId`, errors);
      }
      if (!isPositiveNumber(line.setupMin)) errors.push(`${p}.setupMin: must be >= 0`);
      if (!isPositiveNumber(line.setupManning)) errors.push(`${p}.setupManning: must be >= 0`);
      if (typeof line.batchSize !== 'number' || line.batchSize <= 0) errors.push(`${p}.batchSize: must be > 0`);
      if (typeof line.heads !== 'number' || line.heads <= 0) errors.push(`${p}.heads: must be > 0`);
      if (!isPositiveNumber(line.cycleSec)) errors.push(`${p}.cycleSec: must be >= 0`);
      if (typeof line.partsPerCycle !== 'number' || line.partsPerCycle <= 0) errors.push(`${p}.partsPerCycle: must be > 0`);
      if (!isPercentage(line.scrapPct)) errors.push(`${p}.scrapPct: must be 0..100`);
      if (!isNonEmptyString(line.reason)) errors.push(`${p}.reason: required`);
      else if ((line.reason as string).length > 240) errors.push(`${p}.reason: max 240 chars`);
    });
  }

  // ── tooling[] ── (optional)
  if (raw.tooling !== undefined) {
    if (!Array.isArray(raw.tooling)) errors.push('tooling must be an array if provided');
    else {
      raw.tooling.forEach((line, i) => {
        const p = `tooling[${i}]`;
        if (!isObject(line)) { errors.push(`${p}: must be an object`); return; }
        if (!isOneOf(line.toolingType, TOOLING_TYPES)) errors.push(`${p}.toolingType: invalid`);
        if (!isNonEmptyString(line.description)) errors.push(`${p}.description: required`);
        if (!isPositiveNumber(line.unitCost)) errors.push(`${p}.unitCost: must be >= 0`);
        if (typeof line.quantity !== 'number' || line.quantity <= 0) errors.push(`${p}.quantity: must be > 0`);
        if (typeof line.amortizationParts !== 'number' || line.amortizationParts <= 0) errors.push(`${p}.amortizationParts: must be > 0`);
        if (!isPercentage(line.usagePercentage)) errors.push(`${p}.usagePercentage: must be 0..100`);
        if (typeof line.isCustom !== 'boolean') errors.push(`${p}.isCustom: must be boolean`);
        if (!isNonEmptyString(line.reason)) errors.push(`${p}.reason: required`);
      });
    }
  }

  // ── logistics[] ── (optional)
  if (raw.logistics !== undefined) {
    if (!Array.isArray(raw.logistics)) errors.push('logistics must be an array if provided');
    else {
      raw.logistics.forEach((line, i) => {
        const p = `logistics[${i}]`;
        if (!isObject(line)) { errors.push(`${p}: must be an object`); return; }
        if (!isNonEmptyString(line.costName)) errors.push(`${p}.costName: required`);
        if (!isOneOf(line.logisticsType, LOGISTICS_TYPES)) errors.push(`${p}.logisticsType: invalid`);
        if (!isOneOf(line.modeOfTransport, TRANSPORT_MODES)) errors.push(`${p}.modeOfTransport: invalid`);
        if (!isOneOf(line.costBasis, COST_BASES)) errors.push(`${p}.costBasis: invalid`);
        if (!isPositiveNumber(line.unitCost)) errors.push(`${p}.unitCost: must be >= 0`);
        if (typeof line.quantity !== 'number' || line.quantity <= 0) errors.push(`${p}.quantity: must be > 0`);
        if (!isNonEmptyString(line.reason)) errors.push(`${p}.reason: required`);
      });
    }
  }

  // ── procuredParts[] ── (optional)
  if (raw.procuredParts !== undefined) {
    if (!Array.isArray(raw.procuredParts)) errors.push('procuredParts must be an array if provided');
    else {
      raw.procuredParts.forEach((line, i) => {
        const p = `procuredParts[${i}]`;
        if (!isObject(line)) { errors.push(`${p}: must be an object`); return; }
        if (!isNonEmptyString(line.partName)) errors.push(`${p}.partName: required`);
        if (!isPositiveNumber(line.unitCost)) errors.push(`${p}.unitCost: must be >= 0`);
        if (typeof line.quantity !== 'number' || line.quantity <= 0) errors.push(`${p}.quantity: must be > 0`);
        if (!isPercentage(line.scrapPct)) errors.push(`${p}.scrapPct: must be 0..100`);
        if (!isOverheadPct(line.overheadPct)) errors.push(`${p}.overheadPct: must be 0..1000`);
        if (!isNonEmptyString(line.reason)) errors.push(`${p}.reason: required`);
      });
    }
  }

  // ── proposedMasters[] ── (optional)
  if (raw.proposedMasters !== undefined) {
    if (!Array.isArray(raw.proposedMasters)) errors.push('proposedMasters must be an array if provided');
    else {
      const seenIds = new Set<string>();
      raw.proposedMasters.forEach((pm, i) => {
        const p = `proposedMasters[${i}]`;
        if (!isObject(pm)) { errors.push(`${p}: must be an object`); return; }
        if (!isNonEmptyString(pm.proposedMasterId)) {
          errors.push(`${p}.proposedMasterId: required`);
        } else if (!(pm.proposedMasterId as string).startsWith('pm-')) {
          errors.push(`${p}.proposedMasterId: must start with 'pm-'`);
        } else if (seenIds.has(pm.proposedMasterId as string)) {
          errors.push(`${p}.proposedMasterId: duplicate '${pm.proposedMasterId}'`);
        } else {
          seenIds.add(pm.proposedMasterId as string);
        }
        if (pm.kind === 'raw_material') {
          if (!isNonEmptyString(pm.material)) errors.push(`${p}.material: required`);
          if (!isNonEmptyString(pm.materialGroup)) errors.push(`${p}.materialGroup: required`);
          if (!isPositiveNumber(pm.unitCostInrPerKg)) errors.push(`${p}.unitCostInrPerKg: must be >= 0`);
          if (!isPositiveNumber(pm.densityKgPerM3)) errors.push(`${p}.densityKgPerM3: must be >= 0`);
        } else if (pm.kind === 'process') {
          if (!isNonEmptyString(pm.processName)) errors.push(`${p}.processName: required`);
          if (!isNonEmptyString(pm.processCategory)) errors.push(`${p}.processCategory: required`);
          if (!isOneOf(pm.skillLevelRequired, SKILL_LEVELS)) errors.push(`${p}.skillLevelRequired: invalid`);
        } else {
          errors.push(`${p}.kind: must be 'raw_material' or 'process'`);
        }
        if (!isNonEmptyString(pm.reason)) errors.push(`${p}.reason: required`);
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // At this point the shape is valid. Normalise defaults and return.
  const plan: AbstractPlan = {
    partFamily: raw.partFamily as AbstractPlan['partFamily'],
    rawMaterials: raw.rawMaterials as AbstractPlan['rawMaterials'],
    processes: raw.processes as AbstractPlan['processes'],
    tooling: (raw.tooling as AbstractPlan['tooling']) ?? [],
    logistics: (raw.logistics as AbstractPlan['logistics']) ?? [],
    procuredParts: (raw.procuredParts as AbstractPlan['procuredParts']) ?? [],
    proposedMasters: (raw.proposedMasters as AbstractProposedMaster[]) ?? [],
    notes: typeof raw.notes === 'string' ? raw.notes : undefined,
  };
  return { ok: true, plan };
}
