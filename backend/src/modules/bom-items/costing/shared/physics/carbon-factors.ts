/**
 * Published carbon factors for the sustainability panel (sustainability.ts), each with its publisher, edition and data year. A value is
 * here only when it was read in its primary document, or in a citation of a named primary that could not be reached (marked "as cited").
 * A material or location with no such value gets none: the panel says so, it is never estimated. Researched 2026-11-16.
 */
import { detectMaterialClass } from '../../machining/process/cost-machining-engine';
import type { SustainabilityFactors } from './sustainability';

/** Grid electricity, kg CO2e per kWh, by the app's locations. */
const GRID: Record<string, { kgCo2ePerKwh: number; source: string }> = {
  // eGRID gives 770.9 lb CO2e/MWh = 0.350 kg/kWh at generation and a 4.2 % grid gross loss: 0.350 / (1 - 0.042) per kWh consumed.
  USA: { kgCo2ePerKwh: 0.365, source: 'US EPA eGRID2023 Summary Tables, rev. 2 (June 2025), 2023 US average 0.350 at generation, per kWh consumed with its 4.2 % grid loss' },
  India: { kgCo2ePerKwh: 0.727, source: 'CEA CO2 Baseline Database v20.0 (Dec 2024), FY2023-24 grid weighted average, CO2 only, as cited' },
  China: { kgCo2ePerKwh: 0.5306, source: 'MEE and NBS, 2023 national electricity CO2 emission factor (announced Jan 2026), CO2 only' },
  Mexico: { kgCo2ePerKwh: 0.444, source: 'SEMARNAT/CRE, Aviso FESEN 2024 (Feb 2025), national grid emission factor for 2024' },
  France: { kgCo2ePerKwh: 0.052, source: 'ADEME Base Empreinte, average consumption mix 2022 (upstream included), as cited' },
};

export function gridCarbonFactor(location: string): SustainabilityFactors['grid'] {
  return GRID[location] ?? null;
}

type Material = NonNullable<SustainabilityFactors['material']>;

const ALUMINIUM: Material = {
  label: 'Aluminium (primary)', kgCo2ePerKg: 14.8, recyclingPct: 90,
  source: 'IAI, global primary aluminium 2023 (released 13 Dec 2024), as cited; end-of-life recycling over 90 % in transport and construction: European Aluminium',
  lowerCarbonOption: { label: 'remelted recycled aluminium (gate-to-gate, European Aluminium Environmental Profile Report 2024)', kgCo2ePerKg: 0.26 },
};
const CARBON_STEEL: Material = {
  label: 'Carbon steel (global average)', kgCo2ePerKg: 2.18, recyclingPct: null,
  source: 'worldsteel Sustainability Indicators 2025, 2024 global average, CO2e scopes 1, 2 and 3 cat. 1; no end-of-life recycling rate verified',
  lowerCarbonOption: { label: 'scrap-based EAF steel (worldsteel 2024)', kgCo2ePerKg: 0.71 },
};
const COPPER: Material = {
  label: 'Copper cathode', kgCo2ePerKg: 3.965, recyclingPct: 40,
  source: 'International Copper Association, Copper Environmental Profile Global 2023 (reference year 2019); end-of-life recycling 40 %: ICA Recycling Brief 2022',
};

// A grade the engine would class as mild steel only by default (detectMaterialClass's fallback) is not assumed to be steel.
const IS_STEEL = /STEEL|\bAISI\b|\bSAE\b|\b10[1-9]\d\b|\bA36\b|\bEN\s?\d|IS\s?2062|\bCRCA\b|\bMS\b|\bS[23]\d5\b|\bCR\b|\bHR\b/;

/** The embodied carbon of a grade's material class, or null when no published value is verified for it (stainless, titanium, brass,
 *  plastics, tool steel) or the grade is not recognised. */
export function materialCarbonFactor(grade: string | null | undefined): SustainabilityFactors['material'] {
  if (!grade) return null;
  const g = grade.toUpperCase();
  switch (detectMaterialClass(grade)) {
    case 'aluminum': return ALUMINIUM;
    case 'copper_alloy': return /BRASS|BRONZE/.test(g) ? null : COPPER;
    case 'mild_steel': return IS_STEEL.test(g) ? CARBON_STEEL : null;
    default: return null;
  }
}

/** How the part's stock is made, for the advice: sheet is nested, bar or billet is machined away, a casting or moulding is near-net. */
export function stockOf(family: string): SustainabilityFactors['stock'] {
  if (family === 'sheet_metal') return 'sheet';
  if (['milled', 'turned', 'mill_turn'].includes(family)) return 'bar_or_billet';
  if (family.includes('cast') || family === 'plastic_molded') return 'near_net';
  return null;
}
