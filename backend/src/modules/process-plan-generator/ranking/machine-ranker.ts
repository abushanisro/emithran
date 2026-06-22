import type { PartFamily } from '../dto/engineering-brief.dto';
import type { MachineCandidate } from '../dto/candidate-set.dto';

/**
 * Scores MHR rows for fit against the part family.
 *
 * The MHR schema has machine_name, machine_description, commodity_code,
 * and final_mhr. We score by keyword match against names tied to the
 * family + sanity of the rate.
 */

interface MhrRow {
  id: string;
  machine_name: string | null;
  machine_description: string | null;
  commodity_code: string | null;
  total_machine_hour_rate?: number | string | null;
  final_mhr?: number | string | null;
  rate_inr?: number | null;
  location?: string | null;
  process_family?: string | null;  // exact family tag — beats keyword heuristic when set
}

const MACHINE_KEYWORDS_BY_FAMILY: Record<Exclude<PartFamily, 'out_of_scope'>, string[]> = {
  cnc_turned: ['lathe', 'turning', 'turn center', 'cnc lathe', 'vmc lathe', 'swiss', 'turn-mill'],
  cnc_milled: ['vmc', 'mill', 'milling', 'machining center', 'hmc', 'cnc machining', 'vertical machining', '5-axis', 'router'],
  sheet_metal: ['laser', 'press brake', 'shear', 'punch', 'turret', 'bending', 'cnc bending', 'fiber laser', 'press', 'bender', 'roll', 'stamping', 'forming', 'blanking'],
};

const norm = (s: string | null | undefined): string => (s ?? '').toLowerCase().trim();

const toNumber = (v: number | string | null | undefined): number => {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// Machine categories needed for ALL part families regardless of machining type.
// These must always appear in the candidate set so the AI can route deburring,
// surface treatment, and inspection correctly instead of falling back to VMC.
const UNIVERSAL_PROCESS_FAMILIES = new Set([
  'bench_manual',      // deburring, cleaning, marking, packaging
  'surface_treatment', // anodizing, plating, coating — often outsourced
  'quality',           // inspection bench, CMM, gauging
  'inspection',        // alt tag for the same category
  'heat_treatment',    // furnace, oven — outsourced or in-house
  'saw',               // band saw, cold saw — always needed for bar stock
]);

function keywordFitScore(row: MhrRow, family: Exclude<PartFamily, 'out_of_scope'>): number {
  // Exact family tag wins — deterministic, no keyword guessing needed.
  if (row.process_family) {
    if (row.process_family === family) return 1;
    // Universal categories must appear in every candidate set.
    if (UNIVERSAL_PROCESS_FAMILIES.has(row.process_family)) return 0.65;
    return 0.05;
  }
  // Legacy rows without a tag fall through to keyword heuristic.
  const keywords = MACHINE_KEYWORDS_BY_FAMILY[family];
  const haystack = `${norm(row.machine_name)} ${norm(row.machine_description)} ${norm(row.commodity_code)}`;
  for (const kw of keywords) {
    if (haystack.includes(kw)) return 1;
  }
  // Heuristic detection for un-tagged bench/inspection/saw machines
  if (/\b(bench|workstation|deburr|manual.?work)/i.test(haystack)) return 0.65;
  if (/\b(cmm|inspection|gauge|gauging|qc.?bench)/i.test(haystack)) return 0.65;
  if (/\b(band.?saw|cold.?saw|hack.?saw|saw)/i.test(haystack)) return 0.65;
  if (/\b(anodiz|plat|coat|heat.?treat|furnace)/i.test(haystack)) return 0.65;
  if (haystack.includes('cnc')) return 0.5;
  return 0.15;
}

function rateSanityScore(row: MhrRow): number {
  // Prefer rate_inr (already converted) — fall back to raw value.
  const rate = row.rate_inr ?? toNumber(row.total_machine_hour_rate ?? row.final_mhr);
  if (rate <= 0) return 0;
  // All MHR data is confirmed INR. Range spans from small CNC (₹50/hr) to
  // large capital-intensive press lines (₹1.5M+/hr) — both are legitimate.
  // Only penalise rates that are clearly data-entry errors (< ₹10/hr).
  if (rate < 10) return 0.3;
  return 1;
}

function locationFitScore(row: MhrRow, orgLocation: string): number {
  const orgLoc = norm(orgLocation);
  const rowLoc = norm(row.location);
  if (!rowLoc) return 0.6;
  if (rowLoc === orgLoc) return 1;
  if (orgLoc.includes('india') && rowLoc.includes('india')) return 0.9;
  return 0.4;
}

export function rankMachines(
  rows: MhrRow[],
  family: Exclude<PartFamily, 'out_of_scope'>,
  orgLocation: string,
  topN: number,
): MachineCandidate[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const scored = rows.map((row) => {
    const kScore = keywordFitScore(row, family);
    const rScore = rateSanityScore(row);
    const lScore = locationFitScore(row, orgLocation);
    // Location weight raised to 0.25 — org-location MHR rates must be preferred
    const score = 0.50 * kScore + 0.25 * rScore + 0.25 * lScore;
    return { row, score };
  });

  scored.sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id));

  const topSlice = scored.slice(0, topN);

  // Guarantee at least one candidate per universal family so bench/quality/saw ops
  // can never fall back to a laser or press due to candidate-set crowding.
  for (const gf of ['bench_manual', 'quality', 'saw']) {
    if (!topSlice.some(({ row }) => row.process_family === gf)) {
      const best = scored.find(({ row }) => row.process_family === gf);
      if (best) topSlice.push(best);
    }
  }

  return topSlice.map(({ row, score }, idx) => ({
    candidateId: `mc-${idx + 1}`,
    dbId: row.id,
    machineName: row.machine_name ?? '',
    commodityCode: row.commodity_code ?? null,
    description: row.machine_description ?? null,
    rateInrPerHour: row.rate_inr ?? toNumber(row.total_machine_hour_rate ?? row.final_mhr),
    location: row.location ?? null,
    processFamily: row.process_family ?? null,
    score: Number(score.toFixed(3)),
  }));
}
