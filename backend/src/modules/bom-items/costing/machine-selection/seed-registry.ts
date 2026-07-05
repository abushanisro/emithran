// Fallback capability tier: when a mhr_records row has NULL capability columns but
// its machine_name matches a known model, these specs are merged in at read time
// (capabilitySource = 'seed'). Guarantees Day-1 selection before migration 325 runs.
// Mirror of backend/src/database/migrations/325_seed_machine_capability_defaults.sql —
// keep both in sync.

import type { MachineClass } from '../default-rates';

export interface MachineCapability {
  maxXMm: number | null;
  maxYMm: number | null;
  maxZMm: number | null;
  maxDiameterMm: number | null;
  maxLengthMm: number | null;
  maxTonnage: number | null;
  maxThicknessMm: number | null;
  maxWorkpieceWeightKg: number | null;
  powerKw: number | null;
  maxThicknessMsMm: number | null;
  maxThicknessSsMm: number | null;
  maxThicknessAlMm: number | null;
  maxThicknessCuMm: number | null;
  cuttableMaterials: string[] | null;
}

export const EMPTY_CAPABILITY: MachineCapability = {
  maxXMm: null, maxYMm: null, maxZMm: null,
  maxDiameterMm: null, maxLengthMm: null,
  maxTonnage: null, maxThicknessMm: null,
  maxWorkpieceWeightKg: null, powerKw: null,
  maxThicknessMsMm: null, maxThicknessSsMm: null,
  maxThicknessAlMm: null, maxThicknessCuMm: null,
  cuttableMaterials: null,
};

interface SeedEntry {
  pattern: RegExp;                       // matched against machine_name
  capability: Partial<MachineCapability>;
}

const SEED_ENTRIES: SeedEntry[] = [
  // ── Fiber lasers ──
  { pattern: /amada.*(lc|ensis|ventis).*30\s*15|lc-?3015/i,
    capability: { maxXMm: 3050, maxYMm: 1525, powerKw: 4, maxThicknessMsMm: 20, maxThicknessSsMm: 12, maxThicknessAlMm: 10, maxThicknessCuMm: 6 } },
  { pattern: /trumpf.*(trulaser|tru laser)|trulaser/i,
    capability: { maxXMm: 3000, maxYMm: 1500, powerKw: 6, maxThicknessMsMm: 25, maxThicknessSsMm: 12, maxThicknessAlMm: 8, maxThicknessCuMm: 4 } },
  { pattern: /bystronic.*(bystar|by star)/i,
    capability: { maxXMm: 6500, maxYMm: 2000, powerKw: 10, maxThicknessMsMm: 30, maxThicknessSsMm: 25, maxThicknessAlMm: 20, maxThicknessCuMm: 10 } },
  { pattern: /fiber\s*laser|laser\s*cut/i,
    capability: { maxXMm: 3000, maxYMm: 1500, powerKw: 4, maxThicknessMsMm: 16, maxThicknessSsMm: 10, maxThicknessAlMm: 8, maxThicknessCuMm: 4 } },

  // ── Press brakes ──
  { pattern: /accurl.*hbp-?40|hbp-?40/i,
    capability: { maxTonnage: 40, maxLengthMm: 2050, maxThicknessMm: 4 } },
  { pattern: /amada.*(hfe|hg|hrb).*100|hfe-?100/i,
    capability: { maxTonnage: 100, maxLengthMm: 3100, maxThicknessMm: 8 } },
  { pattern: /trumpf.*trubend.*(5170|170)/i,
    capability: { maxTonnage: 170, maxLengthMm: 3060, maxThicknessMm: 12 } },
  { pattern: /press\s*brake|bending/i,
    capability: { maxTonnage: 80, maxLengthMm: 2500, maxThicknessMm: 6 } },

  // ── CNC VMCs ──
  { pattern: /haas.*vf-?2/i,
    capability: { maxXMm: 762, maxYMm: 406, maxZMm: 508, maxWorkpieceWeightKg: 1361, powerKw: 22.4 } },
  { pattern: /haas.*vf-?4/i,
    capability: { maxXMm: 1016, maxYMm: 508, maxZMm: 635, maxWorkpieceWeightKg: 1814, powerKw: 22.4 } },
  { pattern: /vmc[-\s]?540/i,
    capability: { maxXMm: 500, maxYMm: 400, maxZMm: 300, maxWorkpieceWeightKg: 500, powerKw: 15 } },
  { pattern: /vmc[-\s]?850/i,
    capability: { maxXMm: 850, maxYMm: 500, maxZMm: 500, maxWorkpieceWeightKg: 800, powerKw: 18.5 } },
  { pattern: /dmg\s*mori.*nhx-?5000|nhx-?5000/i,
    capability: { maxXMm: 730, maxYMm: 730, maxZMm: 880, maxWorkpieceWeightKg: 1000, powerKw: 37 } },

  // ── CNC lathes ──
  { pattern: /miyano.*bnc-?20|bnc-?20/i,
    capability: { maxDiameterMm: 20, maxLengthMm: 320, powerKw: 3.7 } },
  { pattern: /haas.*st-?20/i,
    capability: { maxDiameterMm: 356, maxLengthMm: 533, powerKw: 22.4 } },
  { pattern: /dmg\s*mori.*(nlx|clx).*2500|nlx-?2500/i,
    capability: { maxDiameterMm: 366, maxLengthMm: 649, powerKw: 18.5 } },

  // ── Waterjet / turret ──
  { pattern: /waterjet|water\s*jet|omax|flow\b/i,
    capability: { maxXMm: 3000, maxYMm: 1500, maxThicknessMm: 100 } },
  { pattern: /turret|punch/i,
    capability: { maxXMm: 2500, maxYMm: 1250, maxThicknessMm: 6, maxTonnage: 20 } },

  // ── Injection molding machines ──
  // Mirror of migration 336_seed_injection_molding_machines.sql — keep in sync.
  { pattern: /arburg.*allrounder.*370|allrounder.*370/i,  capability: { maxTonnage: 37  } },
  { pattern: /arburg.*allrounder.*570|allrounder.*570/i,  capability: { maxTonnage: 57  } },
  { pattern: /arburg.*allrounder.*1020|allrounder.*1020/i, capability: { maxTonnage: 102 } },
  { pattern: /arburg.*allrounder.*1600|allrounder.*1600/i, capability: { maxTonnage: 160 } },
  { pattern: /arburg.*allrounder.*2000|allrounder.*2000/i, capability: { maxTonnage: 200 } },
  { pattern: /engel.*e-?mac.*310|e-?mac.*310/i,           capability: { maxTonnage: 31  } },
  { pattern: /engel.*e-?mac.*440|e-?mac.*440/i,           capability: { maxTonnage: 44  } },
  { pattern: /engel.*(victory|v-duo).*80\b/i,             capability: { maxTonnage: 80  } },
  { pattern: /engel.*(victory|v-duo).*120\b/i,            capability: { maxTonnage: 120 } },
  { pattern: /engel.*duo.*650|duo.*650/i,                 capability: { maxTonnage: 650 } },
  { pattern: /kraussmaffei.*cx.?160|cx.?160/i,            capability: { maxTonnage: 160 } },
  { pattern: /kraussmaffei.*gx.?450|gx.?450/i,            capability: { maxTonnage: 450 } },
  { pattern: /kraussmaffei.*gx.?650|gx.?650/i,            capability: { maxTonnage: 650 } },
  { pattern: /milacron.*roboshot.*110|roboshot.*110/i,    capability: { maxTonnage: 110 } },
  { pattern: /milacron.*roboshot.*165|roboshot.*165/i,    capability: { maxTonnage: 165 } },
  { pattern: /milacron.*roboshot.*330|roboshot.*330/i,    capability: { maxTonnage: 330 } },
  // Generic clamp-force patterns ("Injection Molder 1,000kN" → 100T, "IMM 250T"):
  // These are static approximations for common lab-scale machines.
  { pattern: /injection\s*mol(?:d(?:er|ing))?.*500\s*kN|500\s*kN.*injection/i,  capability: { maxTonnage: 50  } },
  { pattern: /injection\s*mol(?:d(?:er|ing))?.*800\s*kN|800\s*kN.*injection/i,  capability: { maxTonnage: 80  } },
  { pattern: /injection\s*mol(?:d(?:er|ing))?.*1[,.]?000\s*kN|1[,.]?000\s*kN.*injection/i, capability: { maxTonnage: 100 } },
  { pattern: /injection\s*mol(?:d(?:er|ing))?.*1[,.]?500\s*kN|1[,.]?500\s*kN.*injection/i, capability: { maxTonnage: 150 } },
  { pattern: /injection\s*mol(?:d(?:er|ing))?.*2[,.]?000\s*kN|2[,.]?000\s*kN.*injection/i, capability: { maxTonnage: 200 } },
  { pattern: /injection\s*mol(?:d(?:er|ing))?.*3[,.]?000\s*kN|3[,.]?000\s*kN.*injection/i, capability: { maxTonnage: 300 } },
  { pattern: /injection\s*mol(?:d(?:er|ing))?.*5[,.]?000\s*kN|5[,.]?000\s*kN.*injection/i, capability: { maxTonnage: 500 } },
];

export function lookupSeedCapability(machineName: string | null): Partial<MachineCapability> | null {
  if (!machineName) return null;
  const entry = SEED_ENTRIES.find((e) => e.pattern.test(machineName));
  return entry?.capability ?? null;
}

// Worst-case class specs when neither DB nor seed registry has data.
// Deliberately conservative: a default-class machine passes only clearly small parts,
// so unknown machines never silently win jobs they may not handle.
export const MACHINE_CLASS_DEFAULTS: Record<MachineClass, Partial<MachineCapability>> = {
  fiber_laser:    { maxXMm: 2500, maxYMm: 1250, maxThicknessMsMm: 12, maxThicknessSsMm: 8, maxThicknessAlMm: 6, maxThicknessCuMm: 3 },
  press_brake:    { maxTonnage: 60, maxLengthMm: 2000, maxThicknessMm: 5 },
  turret_punch:   { maxXMm: 2000, maxYMm: 1000, maxThicknessMm: 4, maxTonnage: 20 },
  waterjet:       { maxXMm: 2000, maxYMm: 1000, maxThicknessMm: 80 },
  tapping:        {},
  deburring:      {},
  cmm:            {},
  cnc_3ax_vmc:    { maxXMm: 600, maxYMm: 400, maxZMm: 400, maxWorkpieceWeightKg: 500 },
  cnc_4ax_vmc:    { maxXMm: 500, maxYMm: 400, maxZMm: 400, maxWorkpieceWeightKg: 400 },
  cnc_5ax_mc:     { maxXMm: 400, maxYMm: 400, maxZMm: 400, maxWorkpieceWeightKg: 300 },
  cnc_lathe:      { maxDiameterMm: 250, maxLengthMm: 500 },
  cnc_lathe_live: { maxDiameterMm: 200, maxLengthMm: 400 },
  cnc_mill_turn:  { maxDiameterMm: 300, maxLengthMm: 600 },
  // Small/entry-tier clamp tonnage (see backend/data/MHR_LHR_India_2026.json's
  // 30-80T Arburg Allrounder class) — an unknown injection molding machine
  // should only win small parts, not silently claim a 500T part.
  injection_molding: { maxTonnage: 80 },
};
