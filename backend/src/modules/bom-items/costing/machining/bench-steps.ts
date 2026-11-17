// The Bench Operation steps (memory/Machining: Identing, Spark Testing) a machined part gets, for its material. Pure.
import { detectMaterialClass } from './process/cost-machining-engine';

/** A bench step and its reference time (seconds; null when memory holds none). */
export interface BenchStep { operation: string; sec: number | null; source: string }

/**
 * Whether the material is a steel or an iron. From the material's own type (raw_materials.material_type: Steel, Stainless Steel,
 * Low-Alloy Steel, Ductile Iron, Gray Iron, ...); when the type is unknown or generic, from the grade's class (mild, stainless and
 * tool steel are ferrous).
 */
export function isFerrousMaterial(materialType: string | null | undefined, grade: string | null | undefined): boolean {
  const type = (materialType ?? '').trim();
  if (type && !/^(default|generic)$/i.test(type)) return /steel|iron/i.test(type);
  if (!grade?.trim()) return false;
  return ['mild_steel', 'stainless', 'tool_steel'].includes(detectMaterialClass(grade));
}

/**
 * The bench steps that apply to the part. A spark test identifies a steel or an iron by the sparks it throws on a grinding wheel; an
 * aluminium, copper, titanium or plastic part throws none to read, so the step is not charged on it and a note says so. Every other
 * step applies to any material.
 */
export function benchStepsFor(
  steps: readonly BenchStep[], materialType: string | null | undefined, grade: string | null | undefined,
): { steps: BenchStep[]; notes: string[] } {
  if (isFerrousMaterial(materialType, grade)) return { steps: [...steps], notes: [] };
  const spark = steps.filter((s) => s.operation === 'Spark Testing');
  if (!spark.length) return { steps: [...steps], notes: [] };
  const what = grade?.trim() || materialType?.trim() || 'the material';
  return {
    steps: steps.filter((s) => s.operation !== 'Spark Testing'),
    notes: [`Spark Testing not charged: ${what} is not a steel or an iron, and a spark test identifies only those (by the sparks they throw on a grinding wheel).`],
  };
}
