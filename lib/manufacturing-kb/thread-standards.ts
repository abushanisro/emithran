// ISO 965-1 standard metric tap drill diameters (6H class)
export const TAP_DRILL_MM: Record<string, number> = {
  'M2':   1.60, 'M2.5': 2.05, 'M3':  2.50, 'M4':  3.30,
  'M5':   4.20, 'M6':   5.00, 'M8':  6.75, 'M10': 8.50,
  'M12': 10.25, 'M16': 14.00, 'M20': 17.50, 'M24': 21.00,
};

const CYCLE_SEC_PER_HOLE: Record<string, number> = {
  'M2': 4, 'M2.5': 5, 'M3': 6, 'M4': 7, 'M5': 8,
  'M6': 10, 'M8': 14, 'M10': 18, 'M12': 22, 'M16': 28, 'M20': 35, 'M24': 42,
};

export interface ThreadIntelligence {
  tapDrillMm: number | null;
  classFit: string;
  tool: string;
  inspection: string;
  estimatedCycleSecPerHole: number;
}

export function getThreadIntelligence(size: string, pitch: number): ThreadIntelligence {
  const tapDrillMm = TAP_DRILL_MM[size] ?? null;
  return {
    tapDrillMm,
    classFit: '6H',
    tool: `${size} Spiral-Point Tap (pitch ${pitch} mm)`,
    inspection: 'Go/No-Go Thread Gauge',
    estimatedCycleSecPerHole: CYCLE_SEC_PER_HOLE[size] ?? 10,
  };
}
