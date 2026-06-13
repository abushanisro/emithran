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
  total_machine_hour_rate?: number | string | null;  // canonical in mhr_records
  final_mhr?: number | string | null;                 // legacy column name fallback
  location?: string | null;
}

const MACHINE_KEYWORDS_BY_FAMILY: Record<Exclude<PartFamily, 'out_of_scope'>, string[]> = {
  cnc_turned: ['lathe', 'turning', 'turn center', 'cnc lathe', 'vmc lathe', 'swiss', 'turn-mill'],
  cnc_milled: ['vmc', 'mill', 'milling', 'machining center', 'hmc', 'cnc machining', 'vertical machining', '5-axis', 'router'],
  sheet_metal: ['laser', 'press brake', 'shear', 'punch', 'turret', 'bending', 'cnc bending', 'fiber laser'],
};

const norm = (s: string | null | undefined): string => (s ?? '').toLowerCase().trim();

const toNumber = (v: number | string | null | undefined): number => {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

function keywordFitScore(row: MhrRow, family: Exclude<PartFamily, 'out_of_scope'>): number {
  const keywords = MACHINE_KEYWORDS_BY_FAMILY[family];
  const haystack = `${norm(row.machine_name)} ${norm(row.machine_description)} ${norm(row.commodity_code)}`;
  for (const kw of keywords) {
    if (haystack.includes(kw)) return 1;
  }
  // Generic CNC catch-all gives a moderate score
  if (haystack.includes('cnc')) return 0.5;
  return 0.15;
}

function rateSanityScore(row: MhrRow): number {
  const rate = toNumber(row.total_machine_hour_rate ?? row.final_mhr);
  if (rate <= 0) return 0;
  if (rate > 50_000) return 0.4; // very expensive shop
  if (rate >= 100) return 1;
  return 0.5;
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
    const score = 0.55 * kScore + 0.30 * rScore + 0.15 * lScore;
    return { row, score };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topN).map(({ row, score }, idx) => ({
    candidateId: `mc-${idx + 1}`,
    dbId: row.id,
    machineName: row.machine_name ?? '',
    commodityCode: row.commodity_code ?? null,
    description: row.machine_description ?? null,
    rateInrPerHour: toNumber(row.total_machine_hour_rate ?? row.final_mhr),
    location: row.location ?? null,
    score: Number(score.toFixed(3)),
  }));
}
