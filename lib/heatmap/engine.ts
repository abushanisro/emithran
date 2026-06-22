import { sampleRamp } from './ramps';
import type { HeatmapEngineInput, HeatmapEngineOutput, HeatmapStats } from './types';

export function computeHeatmap(input: HeatmapEngineInput): HeatmapEngineOutput {
  const { positions, sources, colorRamp, normalization, onProgress } = input;
  const triCount = Math.floor(positions.length / 9);
  const riskValues = new Float32Array(triCount);
  const colors = new Float32Array(positions.length);

  const pruned = sources.map((s) => ({
    ...s,
    maxD2: (s.sigma * 3.5) ** 2,
    invTwoSigSq: 1 / (2 * s.sigma * s.sigma),
  }));

  let maxRawRisk = 0;
  const PROGRESS_INTERVAL = Math.max(1, Math.floor(triCount / 20));

  for (let ti = 0; ti < triCount; ti++) {
    const base = ti * 9;
    const cx = (positions[base]! + positions[base + 3]! + positions[base + 6]!) / 3;
    const cy = (positions[base + 1]! + positions[base + 4]! + positions[base + 7]!) / 3;
    const cz = (positions[base + 2]! + positions[base + 5]! + positions[base + 8]!) / 3;

    let risk = 0;
    for (const src of pruned) {
      const dx = cx - src.centroid[0], dy = cy - src.centroid[1], dz = cz - src.centroid[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > src.maxD2) continue;
      risk += src.amplitude * Math.exp(-d2 * src.invTwoSigSq);
    }

    riskValues[ti] = risk;
    if (risk > maxRawRisk) maxRawRisk = risk;

    if (onProgress && ti % PROGRESS_INTERVAL === 0) {
      onProgress(Math.round((ti / triCount) * 80));
    }
  }

  // DEBUG: log coordinate space diagnostics
  console.log('[HeatmapEngine] triCount:', triCount, '| sources:', sources.length, '| maxRawRisk:', maxRawRisk);
  if (pruned.length > 0 && triCount > 0) {
    const s = pruned[0]!;
    const cx0 = (positions[0]! + positions[3]! + positions[6]!) / 3;
    const cy0 = (positions[1]! + positions[4]! + positions[7]!) / 3;
    const cz0 = (positions[2]! + positions[5]! + positions[8]!) / 3;
    const dx = cx0 - s.centroid[0], dy = cy0 - s.centroid[1], dz = cz0 - s.centroid[2];
    console.log('[HeatmapEngine] tri[0] centroid:', cx0.toFixed(4), cy0.toFixed(4), cz0.toFixed(4),
      '| src[0] centroid:', s.centroid,
      '| dist:', Math.sqrt(dx*dx + dy*dy + dz*dz).toFixed(4),
      '| src[0] maxD (3.5σ):', Math.sqrt(s.maxD2).toFixed(4),
      '| sigma:', s.sigma);
  }

  const scale = normalization === 'relative' && maxRawRisk > 0 ? 1 / maxRawRisk : 1;

  let cCritical = 0, cHigh = 0, cMedium = 0;
  for (let ti = 0; ti < triCount; ti++) {
    const t = Math.min(riskValues[ti]! * scale, 1);
    riskValues[ti] = t;
    const [r, g, b] = sampleRamp(colorRamp, t);
    const base = ti * 9;
    for (let v = 0; v < 3; v++) {
      const vi = base + v * 3;
      colors[vi] = r;
      colors[vi + 1] = g;
      colors[vi + 2] = b;
    }
    if (t > 0.75) cCritical++;
    else if (t > 0.50) cHigh++;
    else if (t > 0.25) cMedium++;

    if (onProgress && ti % PROGRESS_INTERVAL === 0) {
      onProgress(80 + Math.round((ti / triCount) * 20));
    }
  }

  const stats: HeatmapStats = {
    maxRawRisk,
    percentCritical: (cCritical / triCount) * 100,
    percentHigh: (cHigh / triCount) * 100,
    percentMedium: (cMedium / triCount) * 100,
  };

  return { colors, riskValues, stats };
}
