// High pressure die casting: required clamp force and machine selection.
// Pure. Inputs are the part's measured casting geometry (cad-engine
// shared/casting_geometry.py), the alloy's reference row (materials_master)
// and the real HPDC machines (mhr_records, migration 845, specs columns from
// memory/Die Casting/Machine/high_pressure_die_casting_machines.csv).
//
//   required clamp (kN) = projected area (mm2) x alloy Clamping Pressure (MPa)
//                         x clampForceSafetyFactor / 1000
//   a machine is capable when
//     clamping_force_kn >= required clamp, and
//     the cavity layout's footprint on the parting plane fits between the tie
//     bars (both sides < tie_bar_distance_hor_mm / _vert_mm, either
//     orientation). An L x W layout (layoutNumCav) places L parts along one
//     footprint side and W along the other, tried both ways round; the steel
//     between cavities is not added (not in memory), so the fit is a lower
//     bound, as the single-part check already is.
// The die block is larger than the part, so the footprint check is necessary
// but not sufficient; sizing the die from the mold-border tables
// (tblEdgeMoldBorderX/Y, tblCavityPlateDepthBorder) is not modelled here and
// is reported as such, not approximated.

export interface HpdcMachine {
  id: string;
  name: string;
  /** Machine hour rate (direct + indirect overhead) and labour rate per hour,
   *  in the currency the quote is priced in (HR Rates holds USD; the caller converts). */
  machineRatePerHr: number | null;
  labourRatePerHr: number | null;
  operators: number | null;
  setupTimeHr: number | null;
  clampingForceKn: number | null;
  tieBarHorMm: number | null;
  tieBarVertMm: number | null;
  maxMoldHeightMm: number | null;
  dryCycleTimeS: number | null;
  /** Mold Efficiency (fraction of a shot cycle that is productive); gravity machines carry it. */
  moldEfficiency?: number | null;
}

export interface MachineCheck {
  machine: HpdcMachine;
  capable: boolean;
  reasons: string[];
}

/** Check every machine; capable ones sorted cheapest crewed hour (machine + labour x operators) first. */
export function selectHpdcMachines(input: {
  machines: readonly HpdcMachine[];
  /** Required clamp (kN); null for a process with no clamp (gravity die casting). */
  requiredKn: number | null;
  /** Silhouette extents on the parting plane (mm), measured by the cad-engine
   *  (features.parting_footprint_mm), never the sorted bounding box. */
  footprintMm: [number, number];
  /** Cavity layout (layoutNumCav); one cavity when omitted. */
  layout?: { lengthWise: number; widthWise: number };
}): { checks: MachineCheck[]; capable: HpdcMachine[] } {
  const [pa, pb] = input.footprintMm;
  const lw = input.layout?.lengthWise ?? 1;
  const ww = input.layout?.widthWise ?? 1;
  const arrangements: Array<[number, number]> = [[lw * pa, ww * pb], [lw * pb, ww * pa]];
  const what = lw * ww === 1 ? 'part' : `${lw}×${ww} cavity layout`;
  const checks = input.machines.map((m) => {
    const reasons: string[] = [];
    if (input.requiredKn != null) {
      if (m.clampingForceKn == null) reasons.push('no clamping force on file');
      else if (m.clampingForceKn < input.requiredKn) reasons.push(`clamp ${m.clampingForceKn} kN < required ${input.requiredKn.toFixed(1)} kN`);
    }
    if (m.tieBarHorMm == null || m.tieBarVertMm == null) reasons.push('no tie-bar spacing on file');
    else {
      const h = m.tieBarHorMm, v = m.tieBarVertMm;
      const fits = arrangements.some(([a, b]) => (a < h && b < v) || (b < h && a < v));
      if (!fits) {
        const [a, b] = arrangements[0]!;
        reasons.push(`${what} ${a.toFixed(0)}×${b.toFixed(0)} mm does not fit tie bars ${h}×${v} mm`);
      }
    }
    if (m.machineRatePerHr == null) reasons.push('no machine hour rate on file');
    if (m.labourRatePerHr == null || m.operators == null) reasons.push('no labour rate or crew on file');
    return { machine: m, capable: reasons.length === 0, reasons };
  });
  const capable = checks.filter((c) => c.capable).map((c) => c.machine)
    .sort((x, y) => crewedHourlyRate(x) - crewedHourlyRate(y));
  return { checks, capable };
}

/** Machine rate plus its crew's labour, per hour. */
export function crewedHourlyRate(m: HpdcMachine): number {
  return (m.machineRatePerHr ?? Infinity) + (m.labourRatePerHr ?? Infinity) * (m.operators ?? Infinity);
}
