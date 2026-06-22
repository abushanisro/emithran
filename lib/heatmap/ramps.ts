import type { ColorRamp } from './types';

export const MANUFACTURING_RISK_RAMP: ColorRamp = [
  { t: 0.00, rgb: [0.133, 0.773, 0.369] },
  { t: 0.33, rgb: [0.918, 0.702, 0.031] },
  { t: 0.67, rgb: [0.976, 0.451, 0.086] },
  { t: 1.00, rgb: [0.937, 0.267, 0.267] },
];

export const TOOL_WEAR_RAMP: ColorRamp = MANUFACTURING_RISK_RAMP;
export const THERMAL_RAMP: ColorRamp = MANUFACTURING_RISK_RAMP;
export const COST_DENSITY_RAMP: ColorRamp = MANUFACTURING_RISK_RAMP;
export const TOLERANCE_RISK_RAMP: ColorRamp = MANUFACTURING_RISK_RAMP;
export const SUSTAINABILITY_RAMP: ColorRamp = MANUFACTURING_RISK_RAMP;

export function sampleRamp(ramp: ColorRamp, t: number): [number, number, number] {
  const clamped = Math.min(Math.max(t, 0), 1);
  for (let i = 0; i < ramp.length - 1; i++) {
    const cur = ramp[i]!, next = ramp[i + 1]!;
    if (clamped <= next.t) {
      const span = next.t - cur.t;
      const f = span === 0 ? 0 : (clamped - cur.t) / span;
      const a = cur.rgb, b = next.rgb;
      return [a[0]! + (b[0]! - a[0]!) * f, a[1]! + (b[1]! - a[1]!) * f, a[2]! + (b[2]! - a[2]!) * f];
    }
  }
  return ramp[ramp.length - 1]!.rgb;
}
