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
  // IM-specific fields (migration 339)
  tieBarXMm: number | null;         // horizontal tie-bar (platen) opening
  tieBarYMm: number | null;         // vertical tie-bar (platen) opening
  shotCapacityGrams: number | null; // max shot weight in grams
  minMoldHeightMm: number | null;   // min daylight (mold height)
  maxMoldHeightMm: number | null;   // max daylight (mold height)
}

export const EMPTY_CAPABILITY: MachineCapability = {
  maxXMm: null, maxYMm: null, maxZMm: null,
  maxDiameterMm: null, maxLengthMm: null,
  maxTonnage: null, maxThicknessMm: null,
  maxWorkpieceWeightKg: null, powerKw: null,
  maxThicknessMsMm: null, maxThicknessSsMm: null,
  maxThicknessAlMm: null, maxThicknessCuMm: null,
  cuttableMaterials: null,
  tieBarXMm: null, tieBarYMm: null, shotCapacityGrams: null,
  minMoldHeightMm: null, maxMoldHeightMm: null,
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
  // Mirror of migrations 336 + 339 — keep in sync.
  { pattern: /arburg.*allrounder.*370|allrounder.*370/i,
    capability: { maxTonnage: 37,  tieBarXMm: 280, tieBarYMm: 250, shotCapacityGrams: 56,   minMoldHeightMm: 150, maxMoldHeightMm: 370 } },
  { pattern: /arburg.*allrounder.*570|allrounder.*570/i,
    capability: { maxTonnage: 57,  tieBarXMm: 370, tieBarYMm: 320, shotCapacityGrams: 115,  minMoldHeightMm: 200, maxMoldHeightMm: 450 } },
  { pattern: /arburg.*allrounder.*1020|allrounder.*1020/i,
    capability: { maxTonnage: 102, tieBarXMm: 470, tieBarYMm: 420, shotCapacityGrams: 300,  minMoldHeightMm: 250, maxMoldHeightMm: 580 } },
  { pattern: /arburg.*allrounder.*1600|allrounder.*1600/i,
    capability: { maxTonnage: 160, tieBarXMm: 570, tieBarYMm: 500, shotCapacityGrams: 630,  minMoldHeightMm: 300, maxMoldHeightMm: 680 } },
  { pattern: /arburg.*allrounder.*2000|allrounder.*2000/i,
    capability: { maxTonnage: 200, tieBarXMm: 620, tieBarYMm: 520, shotCapacityGrams: 900,  minMoldHeightMm: 350, maxMoldHeightMm: 730 } },
  { pattern: /engel.*e-?mac.*310|e-?mac.*310/i,
    capability: { maxTonnage: 31,  tieBarXMm: 250, tieBarYMm: 220, shotCapacityGrams: 38,   minMoldHeightMm: 130, maxMoldHeightMm: 330 } },
  { pattern: /engel.*e-?mac.*440|e-?mac.*440/i,
    capability: { maxTonnage: 44,  tieBarXMm: 320, tieBarYMm: 280, shotCapacityGrams: 80,   minMoldHeightMm: 170, maxMoldHeightMm: 400 } },
  { pattern: /engel.*(victory|v-duo).*80\b/i,
    capability: { maxTonnage: 80,  tieBarXMm: 430, tieBarYMm: 380, shotCapacityGrams: 180,  minMoldHeightMm: 220, maxMoldHeightMm: 480 } },
  { pattern: /engel.*(victory|v-duo).*120\b/i,
    capability: { maxTonnage: 120, tieBarXMm: 510, tieBarYMm: 450, shotCapacityGrams: 340,  minMoldHeightMm: 270, maxMoldHeightMm: 560 } },
  { pattern: /engel.*duo.*350|duo.*350/i,
    capability: { maxTonnage: 350, tieBarXMm: 820, tieBarYMm: 700, shotCapacityGrams: 1900, minMoldHeightMm: 420, maxMoldHeightMm: 920 } },
  { pattern: /engel.*duo.*650|duo.*650/i,
    capability: { maxTonnage: 650, tieBarXMm: 1050, tieBarYMm: 850, shotCapacityGrams: 3800, minMoldHeightMm: 500, maxMoldHeightMm: 1100 } },
  { pattern: /kraussmaffei.*cx.?160|cx.?160/i,
    capability: { maxTonnage: 160, tieBarXMm: 580, tieBarYMm: 510, shotCapacityGrams: 660,  minMoldHeightMm: 310, maxMoldHeightMm: 700 } },
  { pattern: /kraussmaffei.*gx.?450|gx.?450/i,
    capability: { maxTonnage: 450, tieBarXMm: 890, tieBarYMm: 760, shotCapacityGrams: 2200, minMoldHeightMm: 450, maxMoldHeightMm: 1000 } },
  { pattern: /kraussmaffei.*gx.?650|gx.?650/i,
    capability: { maxTonnage: 650, tieBarXMm: 1060, tieBarYMm: 860, shotCapacityGrams: 3900, minMoldHeightMm: 510, maxMoldHeightMm: 1120 } },
  { pattern: /milacron.*roboshot.*110|roboshot.*110/i,
    capability: { maxTonnage: 110, tieBarXMm: 470, tieBarYMm: 410, shotCapacityGrams: 295,  minMoldHeightMm: 245, maxMoldHeightMm: 575 } },
  { pattern: /milacron.*roboshot.*165|roboshot.*165/i,
    capability: { maxTonnage: 165, tieBarXMm: 580, tieBarYMm: 510, shotCapacityGrams: 670,  minMoldHeightMm: 305, maxMoldHeightMm: 695 } },
  { pattern: /milacron.*roboshot.*330|roboshot.*330/i,
    capability: { maxTonnage: 330, tieBarXMm: 780, tieBarYMm: 650, shotCapacityGrams: 1700, minMoldHeightMm: 410, maxMoldHeightMm: 880 } },
  // Generic clamp-force patterns ("Injection Molder 1,000kN" → 100T, "IMM 250T"):
  { pattern: /injection\s*mol(?:d(?:er|ing))?.*500\s*kN|500\s*kN.*injection/i,
    capability: { maxTonnage: 50,  tieBarXMm: 320, tieBarYMm: 280, shotCapacityGrams: 100,  minMoldHeightMm: 160, maxMoldHeightMm: 390 } },
  { pattern: /injection\s*mol(?:d(?:er|ing))?.*800\s*kN|800\s*kN.*injection/i,
    capability: { maxTonnage: 80,  tieBarXMm: 430, tieBarYMm: 380, shotCapacityGrams: 180,  minMoldHeightMm: 220, maxMoldHeightMm: 480 } },
  { pattern: /injection\s*mol(?:d(?:er|ing))?.*1[,.]?000\s*kN|1[,.]?000\s*kN.*injection/i,
    capability: { maxTonnage: 100, tieBarXMm: 470, tieBarYMm: 420, shotCapacityGrams: 280,  minMoldHeightMm: 250, maxMoldHeightMm: 580 } },
  { pattern: /injection\s*mol(?:d(?:er|ing))?.*1[,.]?500\s*kN|1[,.]?500\s*kN.*injection/i,
    capability: { maxTonnage: 150, tieBarXMm: 560, tieBarYMm: 490, shotCapacityGrams: 600,  minMoldHeightMm: 295, maxMoldHeightMm: 670 } },
  { pattern: /injection\s*mol(?:d(?:er|ing))?.*2[,.]?000\s*kN|2[,.]?000\s*kN.*injection/i,
    capability: { maxTonnage: 200, tieBarXMm: 620, tieBarYMm: 520, shotCapacityGrams: 900,  minMoldHeightMm: 350, maxMoldHeightMm: 730 } },
  { pattern: /injection\s*mol(?:d(?:er|ing))?.*3[,.]?000\s*kN|3[,.]?000\s*kN.*injection/i,
    capability: { maxTonnage: 300, tieBarXMm: 750, tieBarYMm: 640, shotCapacityGrams: 1600, minMoldHeightMm: 400, maxMoldHeightMm: 860 } },
  { pattern: /injection\s*mol(?:d(?:er|ing))?.*5[,.]?000\s*kN|5[,.]?000\s*kN.*injection/i,
    capability: { maxTonnage: 500, tieBarXMm: 900, tieBarYMm: 770, shotCapacityGrams: 2600, minMoldHeightMm: 460, maxMoldHeightMm: 1020 } },
  { pattern: /injection\s*mol(?:d(?:er|ing))?.*10[,.]?000\s*kN|10[,.]?000\s*kN.*injection/i,
    capability: { maxTonnage: 1000, tieBarXMm: 1200, tieBarYMm: 980, shotCapacityGrams: 7000, minMoldHeightMm: 600, maxMoldHeightMm: 1400 } },
  // Generic tonnage-label patterns: "Injection Molder 100T", "IMM 250T", "IM 500T"
  { pattern: /\binjection\s*mol(?:d(?:er|ing))?\s*1000\s*T\b/i,
    capability: { maxTonnage: 1000, tieBarXMm: 1200, tieBarYMm: 980, shotCapacityGrams: 7000, minMoldHeightMm: 600, maxMoldHeightMm: 1400 } },
  { pattern: /\b(?:imm?|injection\s*mol(?:d(?:er|ing))?)\s*500\s*T\b/i,
    capability: { maxTonnage: 500, tieBarXMm: 900, tieBarYMm: 770, shotCapacityGrams: 2600, minMoldHeightMm: 460, maxMoldHeightMm: 1020 } },
  { pattern: /\b(?:imm?|injection\s*mol(?:d(?:er|ing))?)\s*250\s*T\b/i,
    capability: { maxTonnage: 250, tieBarXMm: 680, tieBarYMm: 570, shotCapacityGrams: 1100, minMoldHeightMm: 370, maxMoldHeightMm: 760 } },
  { pattern: /\b(?:imm?|injection\s*mol(?:d(?:er|ing))?)\s*200\s*T\b/i,
    capability: { maxTonnage: 200, tieBarXMm: 620, tieBarYMm: 520, shotCapacityGrams: 900,  minMoldHeightMm: 350, maxMoldHeightMm: 730 } },
  // Asian OEM brands — Haitian (China #1 IM OEM by volume), Chen Hsong, Sumitomo, Fanuc
  // Haitian Ma series (most common in Asia: India, Vietnam, China)
  { pattern: /haitian.*ma.*900|ma.*900.*haitian/i,
    capability: { maxTonnage: 90,  tieBarXMm: 440, tieBarYMm: 390, shotCapacityGrams: 200,  minMoldHeightMm: 230, maxMoldHeightMm: 490 } },
  { pattern: /haitian.*ma.*1300|ma.*1300.*haitian/i,
    capability: { maxTonnage: 130, tieBarXMm: 530, tieBarYMm: 460, shotCapacityGrams: 390,  minMoldHeightMm: 275, maxMoldHeightMm: 570 } },
  { pattern: /haitian.*ma.*2500|ma.*2500.*haitian/i,
    capability: { maxTonnage: 250, tieBarXMm: 680, tieBarYMm: 570, shotCapacityGrams: 1100, minMoldHeightMm: 370, maxMoldHeightMm: 760 } },
  { pattern: /haitian.*ma.*4500|ma.*4500.*haitian/i,
    capability: { maxTonnage: 450, tieBarXMm: 890, tieBarYMm: 760, shotCapacityGrams: 2400, minMoldHeightMm: 450, maxMoldHeightMm: 1000 } },
  { pattern: /haitian/i,
    capability: { maxTonnage: 150, tieBarXMm: 560, tieBarYMm: 490, shotCapacityGrams: 600,  minMoldHeightMm: 295, maxMoldHeightMm: 670 } },
  // Chen Hsong (Hong Kong / China)
  { pattern: /chen\s*hsong.*sm.*900|sm.*900.*chen\s*hsong/i,
    capability: { maxTonnage: 90,  tieBarXMm: 440, tieBarYMm: 390, shotCapacityGrams: 195,  minMoldHeightMm: 225, maxMoldHeightMm: 485 } },
  { pattern: /chen\s*hsong.*sm.*2000|sm.*2000.*chen\s*hsong/i,
    capability: { maxTonnage: 200, tieBarXMm: 615, tieBarYMm: 515, shotCapacityGrams: 880,  minMoldHeightMm: 345, maxMoldHeightMm: 720 } },
  { pattern: /chen\s*hsong/i,
    capability: { maxTonnage: 120, tieBarXMm: 500, tieBarYMm: 440, shotCapacityGrams: 330,  minMoldHeightMm: 265, maxMoldHeightMm: 555 } },
  // Sumitomo (Demag) — common in Japan/Europe/India
  { pattern: /sumitomo.*se.*180|se.*180.*sumitomo/i,
    capability: { maxTonnage: 180, tieBarXMm: 600, tieBarYMm: 500, shotCapacityGrams: 770,  minMoldHeightMm: 325, maxMoldHeightMm: 710 } },
  { pattern: /sumitomo.*se.*450|se.*450.*sumitomo/i,
    capability: { maxTonnage: 450, tieBarXMm: 885, tieBarYMm: 755, shotCapacityGrams: 2180, minMoldHeightMm: 445, maxMoldHeightMm: 995 } },
  { pattern: /sumitomo|demag.*el.?exis/i,
    capability: { maxTonnage: 180, tieBarXMm: 600, tieBarYMm: 500, shotCapacityGrams: 770,  minMoldHeightMm: 325, maxMoldHeightMm: 710 } },
  // Fanuc ROBOSHOT (all-electric, common in precision/medical)
  { pattern: /fanuc.*roboshot.*s\d*150|roboshot.*150/i,
    capability: { maxTonnage: 150, tieBarXMm: 555, tieBarYMm: 485, shotCapacityGrams: 580,  minMoldHeightMm: 290, maxMoldHeightMm: 665 } },
  { pattern: /fanuc.*roboshot/i,
    capability: { maxTonnage: 100, tieBarXMm: 460, tieBarYMm: 405, shotCapacityGrams: 270,  minMoldHeightMm: 245, maxMoldHeightMm: 570 } },
  // Generic "Power Line" / "Powerline" — Milacron legacy branding used in many US shops
  { pattern: /milacron.*power\s*line.*[89]00|power\s*line.*[89]00/i,
    capability: { maxTonnage: 80,  tieBarXMm: 430, tieBarYMm: 380, shotCapacityGrams: 185,  minMoldHeightMm: 220, maxMoldHeightMm: 480 } },
  { pattern: /milacron.*power\s*line|power\s*line.*milacron/i,
    capability: { maxTonnage: 100, tieBarXMm: 465, tieBarYMm: 410, shotCapacityGrams: 275,  minMoldHeightMm: 245, maxMoldHeightMm: 575 } },
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
  injection_molding: { maxTonnage: 80, tieBarXMm: 430, tieBarYMm: 380, shotCapacityGrams: 180, minMoldHeightMm: 220, maxMoldHeightMm: 480 },
};
