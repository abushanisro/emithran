// Real, human machine categories a machine_class value unambiguously belongs
// to, verified against each legacy row's own machine_description (2026-08-27
// live-DB check) — NOT a generic rule for every possible use of that class.
// machine_class is a many-categories-to-one-class cost-engine grouping (e.g.
// migration 569 maps BOTH "3D Laser Cutting Machine" and "Fiber Laser Cutting
// Machine" to fiber_laser; BOTH "Bend Press Brake" and "Progressive Die Press"
// to press_brake) — resolving it to a single category is only safe once a
// specific row's real machine has been read and confirmed, not assumed from
// the class alone. Scoped here to the two legacy machine_class values that
// were actually checked this way and unambiguously matched a real Sheet Metal
// category: "Fiber Laser 2kW"/"Fiber Laser 6kW" (fiber_laser) — flatbed sheet
// cutters, not 3D/robotic — and "Press Brake 160T" (press_brake) — bending,
// not progressive-die stamping.
const VERIFIED_CLASS_CATEGORY: Record<string, string> = {
  fiber_laser: 'Fiber Laser Cutting Machine',
  press_brake: 'Bend Press Brake',
};

// Everything else with no benchmark match and no verified category above
// (deburring, cmm, cnc_lathe, cnc_3ax_vmc, cnc_5ax_mc, injection_molding —
// legacy rows from manufacturing domains this app hasn't built yet per
// CLAUDE.md's domain-by-domain roadmap, or a genuinely distinct process like
// a general deburring bench that isn't the same thing as "Deslag Machine")
// still deserves a real display name instead of a raw snake_case slug.
function humanizeMachineClass(machineClass: string): string {
  return machineClass
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Real machine category, derived from benchmarkSourceKey ("<category>:<machine
// name>") whenever this row is matched to the reference library — checked
// BEFORE machine_class, not after: machine_class is an internal cost-engine
// slug (e.g. "fiber_laser") that many rows share with a real, richer category
// name from the CSV. Preferring machine_class first split a single real
// category into two inconsistent group labels — the slug for rows read one
// way, the real name for rows read another. Falls back to machine_class only
// when there's no reference-library match at all (e.g. the CNC
// Machining/Injection Molding legacy rows) — and even then, resolves it to a
// verified real category or at least a properly-cased name rather than the
// raw internal slug.
export function mhrCategoryOf(record: { machineClass?: string; benchmarkSourceKey?: string }): string {
  const fromBenchmarkKey = record.benchmarkSourceKey?.split(':')[0]?.trim();
  if (fromBenchmarkKey) return fromBenchmarkKey;
  if (!record.machineClass) return '-';
  return VERIFIED_CLASS_CATEGORY[record.machineClass] ?? humanizeMachineClass(record.machineClass);
}
