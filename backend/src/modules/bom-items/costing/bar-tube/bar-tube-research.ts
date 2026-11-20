// Published figures the memory data lacks, with their sources (web research 2026-11-20). Pure.
//
// 1. Laser feed by material. memory/Bar and tube fab/lookup/process_cut_rate.csv lists Tube Laser feeds for one cut-code family (9) and sheet
//    Laser Cut feeds for one (1, steel). The tube table runs at a steady 0.36 to 0.44 x the steel sheet feeds at the same thickness (1 mm
//    0.36, 3 mm 0.41, 6.35 mm 0.44, 9.5 mm 0.40): it is the tube laser's own steel table, the family label a data artefact (cast iron is not
//    laser cut). Another material's feed is that steel feed times the material's speed over carbon steel's at the same power and thickness,
//    from the IPG fiber laser cutting charts (Artizono, updated 2026-11-07, https://artizono.com/fiber-laser-cutting-thickness-speed-chart/).
//    Past the thickest the chart cuts a material at that power, the laser does not cut it.
//
// 2. Tooling the memory data has no price for:
//    - the aluminium extrusion die, by the press's billet (circle) size, solid or hollow: the midpoints of the Aluminum Extruders Council range
//      for 7-10 inch presses (solid 1,000-2,000 USD, hollow 1,200-4,000 USD), below it the simple-die range (300-800 USD solid; hollow
//      1,200-3,500 USD) and above it the large-die range (2,300-10,000 USD over 200 mm circle);
//      https://www.shengxinaluminium.com/aluminum-extrusion-die-cost-decoded-what-suppliers-won-t-tell-you_n792 (citing the AEC),
//      https://mkaluprofile.com/aluminum-extrusion-die-makers/, https://yajialuminum.com/aluminum-extrusion-die-cost-analysis/,
//      https://www.aluleader.com/blog/guide-to-aluminum-extrusion-die-design-and-lifespan/ (multi-void dies to about 12,000 USD);
//    - the rotary draw die set (bend, clamp and pressure die) for one tube size and CLR: Baileigh list prices (3/4 in 566, 7/8 in 590,
//      1-5/8 in 1,116, 2 in 1,505 USD; 1-1/4 in square 1,292 USD), https://www.mmtoolparts.com/tools/baileigh-tools/metalworking/tube-pipe-benders/bender-tooling-accessories/manual-rotary-draw-bender-tooling.
//      A least-squares line through the round sets: 751 USD per inch of OD; a square or rectangular set 1.38 x a round set of the same size.
//      No source prices a mandrel or a wiper die: they are named, not priced.

export const LASER_SPEED_SOURCE = 'IPG fiber laser cutting charts (artizono.com/fiber-laser-cutting-thickness-speed-chart, updated 2026-11-07)';

type Chart = Readonly<Record<number, ReadonlyArray<readonly [number, number]>>>;
/** Speed (m/min) by thickness (mm), per laser power (W); carbon steel N2/air to 1 mm, O2 above; the others N2. */
const CHARTS: Readonly<Record<'carbon_steel' | 'stainless' | 'aluminium' | 'brass', Chart>> = {
  carbon_steel: {
    1000: [[1, 10], [2, 4], [3, 3], [4, 2.3], [5, 1.8], [6, 1.5], [8, 1.1], [10, 0.8]],
    1500: [[1, 20], [2, 5], [3, 3.6], [4, 2.5], [5, 1.8], [6, 1.4], [8, 1.2], [10, 1], [12, 0.8], [14, 0.65], [16, 0.5]],
    2000: [[1, 25], [2, 5.2], [3, 4.2], [4, 3], [5, 2.2], [6, 1.8], [8, 1.3], [10, 1.1], [12, 0.9], [14, 0.8], [16, 0.7], [18, 0.5]],
  },
  stainless: {
    1000: [[1, 13], [2, 6], [3, 3], [4, 1], [5, 0.6]],
    1500: [[1, 20], [2, 7], [3, 4.5], [5, 1.5], [6, 0.8]],
    2000: [[1, 28], [2, 10], [3, 5], [4, 3], [5, 2], [6, 1.5], [8, 0.6]],
  },
  aluminium: {
    1000: [[1, 10], [2, 5], [3, 1.5]],
    1500: [[1, 18], [2, 6], [3, 2.5], [4, 0.8]],
    2000: [[1, 20], [2, 10], [3, 4], [4, 1.5], [5, 0.9], [6, 0.6]],
  },
  brass: {
    1000: [[1, 9], [2, 2], [3, 0.8]],
    1500: [[1, 15], [2, 5], [3, 1.8]],
    2000: [[1, 18], [2, 8], [3, 3], [4, 1.3], [5, 0.8]],
  },
};

/**
 * The laser chart a material cuts by, from the whole number of its cut code (memory cut codes: 1 and 2 steels, 5 stainless, 20 heat resistant
 * super alloys, 23 titanium, 30 aluminium, 33 brass and copper), else its material type. Titanium and the super alloys have no published chart:
 * they take stainless steel's (the closest fusion cut, under inert gas), and say so. Copper has none at these powers (it is cut from about
 * 6 kW): null.
 */
export function laserChartOf(cutCode: number | null, materialType: string | null): { chart: keyof typeof CHARTS; note: string | null } | null {
  const type = materialType ?? '';
  const whole = cutCode != null && Number.isFinite(cutCode) ? Math.floor(cutCode) : null;
  if (/copper/i.test(type)) return null;
  if (whole === 23 || /titan/i.test(type)) return { chart: 'stainless', note: "no published laser chart for titanium: stainless steel's, the closest fusion cut" };
  if (whole === 20 || /super alloy|inconel|nickel/i.test(type)) return { chart: 'stainless', note: "no published laser chart for heat resistant super alloys: stainless steel's, the closest fusion cut" };
  if (whole === 5 || /stainless/i.test(type)) return { chart: 'stainless', note: null };
  if (whole === 30 || /alumin/i.test(type)) return { chart: 'aluminium', note: null };
  if (whole === 33 || /brass|bronze/i.test(type)) return { chart: 'brass', note: null };
  if (whole === 1 || whole === 2 || /steel/i.test(type)) return { chart: 'carbon_steel', note: null };
  return null;
}

function speedAt(points: ReadonlyArray<readonly [number, number]>, t: number): number | null {
  if (points.length === 0 || t > points[points.length - 1]![0] + 1e-9) return null;
  if (t <= points[0]![0]) return points[0]![1];
  for (let i = 1; i < points.length; i++) {
    const [t0, v0] = points[i - 1]!;
    const [t1, v1] = points[i]!;
    if (t <= t1 + 1e-9) return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
  }
  return null;
}

/**
 * A material's laser speed over carbon steel's at a thickness and power (the chart of the largest power at or below it, from 1000 W), or why
 * there is none: the material is past the thickest the chart cuts at that power.
 */
export function laserMaterialFactor(chart: keyof typeof CHARTS, thicknessMm: number, watts: number): { factor: number; chartWatts: number } | { reason: string } {
  const powers = Object.keys(CHARTS.carbon_steel).map(Number).sort((a, b) => a - b);
  const w = [...powers].reverse().find((p) => p <= watts) ?? powers[0]!;
  const steel = speedAt(CHARTS.carbon_steel[w]!, thicknessMm);
  const mine = speedAt(CHARTS[chart][w]!, thicknessMm);
  if (mine == null) {
    const max = CHARTS[chart][w]!.at(-1)![0];
    return { reason: `a ${w} W laser cuts ${chart.replace('_', ' ')} up to ${max} mm (${LASER_SPEED_SOURCE}), the material is ${Math.round(thicknessMm * 100) / 100} mm` };
  }
  if (steel == null || steel <= 0) return { reason: `the ${w} W chart has no carbon steel speed at ${thicknessMm} mm to compare with` };
  return { factor: mine / steel, chartWatts: w };
}

/** The aluminium extrusion die (USD), by the press's billet diameter and the profile's hollows; and where the figure comes from. */
export function extrusionDieUsd(billetDiameterMm: number, hollows: number): { usd: number; basis: string } {
  const inch = billetDiameterMm / 25.4;
  const hollow = hollows > 0;
  const band = inch < 7 ? { solid: 550, hollow: 2350, label: 'under 7 in (simple dies: solid 300-800, hollow 1,200-3,500 USD)' }
    : inch <= 10 ? { solid: 1500, hollow: 2600, label: '7-10 in (Aluminum Extruders Council: solid 1,000-2,000, hollow 1,200-4,000 USD)' }
    : { solid: 6150, hollow: 6150, label: 'over 10 in (large dies 2,300-10,000 USD)' };
  // Each void past the first is another mandrel and porthole set: multi-void dies run to about 12,000 USD (aluleader).
  const extra = hollow ? Math.max(0, hollows - 1) * 1000 : 0;
  const usd = (hollow ? band.hollow : band.solid) + extra;
  return { usd, basis: `${hollow ? `hollow die (${hollows} void${hollows === 1 ? '' : 's'})` : 'solid die'} on a ${Math.round(inch * 10) / 10} in press, range midpoint for ${band.label}${extra ? `, plus 1,000 USD per extra void` : ''}` };
}

/** One rotary draw die set (bend, clamp and pressure die) for a tube of `odMm`, round or not (USD), and where the figure comes from. */
export function rotaryDrawDieSetUsd(odMm: number, round: boolean): { usd: number; basis: string } {
  const inch = odMm / 25.4;
  const usd = Math.round(751 * inch * (round ? 1 : 1.38));
  return { usd, basis: `Baileigh die set list prices, 751 USD per inch of OD${round ? '' : ' x 1.38 for a square or rectangular set'} (${Math.round(inch * 100) / 100} in)` };
}
