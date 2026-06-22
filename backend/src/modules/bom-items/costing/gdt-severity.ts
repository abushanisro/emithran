// GD&T severity rules engine — Phase 1 fallback.
// Severity type is structured for future extensibility: add "critical" above "high"
// to the union and to SEVERITY_RANK without touching any other logic.

export type GdtSeverity = "low" | "medium" | "high";
export type InspectionMethod = "visual" | "caliper" | "height_gauge" | "cmm";

export type GdtReasonCode =
  | "TIGHT_POSITION"
  | "TIGHT_FLATNESS"
  | "TIGHT_PARALLELISM"
  | "TIGHT_PERPENDICULARITY"
  | "TIGHT_PROFILE"
  | "TIGHT_RUNOUT"
  | "TIGHT_STRAIGHTNESS"
  | "TIGHT_FORM"
  | "TIGHT_ANGULARITY"
  | "CMM_REQUIRED"
  | "DATUM_DEPENDENT"
  | "FIXTURE_RECOMMENDED"
  | "PROCESS_CAPABILITY_REQUIRED"
  | "SURFACE_VERIFICATION_REQUIRED"
  | "UNKNOWN_TYPE";

export const INSPECTION_TIME_MIN: Record<InspectionMethod, number> = {
  visual: 1,
  caliper: 2,
  height_gauge: 4,
  cmm: 8,
};

export const SEVERITY_RANK: Record<GdtSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export interface GdtSeverityResult {
  severity: GdtSeverity;
  inspectionMethod: InspectionMethod;
  inspectionTimeMin: number;
  costImpactPercent: number;
  costImpactRange: string;
  reasonCodes: GdtReasonCode[];
  manufacturingActions: string[];
}

function build(
  severity: GdtSeverity,
  method: InspectionMethod,
  costPct: number,
  range: string,
  codes: GdtReasonCode[],
  actions: string[],
): GdtSeverityResult {
  return {
    severity,
    inspectionMethod: method,
    inspectionTimeMin: INSPECTION_TIME_MIN[method],
    costImpactPercent: costPct,
    costImpactRange: range,
    reasonCodes: codes,
    manufacturingActions: actions,
  };
}

export function deriveGdtSeverity(
  rawType: string,
  toleranceMm: number,
): GdtSeverityResult {
  const type = (rawType ?? "").trim().toLowerCase();

  switch (type) {
    case "position": {
      if (toleranceMm <= 0.05)
        return build("high", "cmm", 12, "+10–15%",
          ["TIGHT_POSITION", "CMM_REQUIRED", "DATUM_DEPENDENT", "FIXTURE_RECOMMENDED"],
          ["CMM inspection required", "Dedicated fixture recommended", "Process capability validation required"]);
      if (toleranceMm <= 0.2)
        return build("medium", "cmm", 6, "+4–8%",
          ["TIGHT_POSITION", "CMM_REQUIRED", "DATUM_DEPENDENT"],
          ["CMM inspection required", "First-article inspection recommended"]);
      return build("low", "height_gauge", 2, "+1–3%",
        [],
        ["Height gauge inspection sufficient"]);
    }

    case "flatness": {
      if (toleranceMm <= 0.1)
        return build("high", "cmm", 12, "+10–15%",
          ["TIGHT_FLATNESS", "CMM_REQUIRED", "SURFACE_VERIFICATION_REQUIRED"],
          ["Surface verification required", "Datum-controlled inspection required"]);
      if (toleranceMm <= 0.5)
        return build("medium", "height_gauge", 6, "+4–8%",
          ["TIGHT_FLATNESS", "SURFACE_VERIFICATION_REQUIRED"],
          ["Height gauge inspection required", "First-article inspection recommended"]);
      return build("low", "caliper", 2, "+1–3%",
        [],
        ["Caliper or visual inspection sufficient"]);
    }

    case "parallelism": {
      if (toleranceMm <= 0.05)
        return build("high", "cmm", 12, "+10–15%",
          ["TIGHT_PARALLELISM", "CMM_REQUIRED", "DATUM_DEPENDENT"],
          ["CMM inspection required", "Datum-controlled setup required"]);
      if (toleranceMm <= 0.3)
        return build("medium", "height_gauge", 6, "+4–8%",
          ["TIGHT_PARALLELISM", "DATUM_DEPENDENT"],
          ["Height gauge inspection required", "First-article inspection recommended"]);
      return build("low", "caliper", 2, "+1–3%",
        [],
        ["Caliper inspection sufficient"]);
    }

    case "perpendicularity": {
      if (toleranceMm <= 0.05)
        return build("high", "cmm", 12, "+10–15%",
          ["TIGHT_PERPENDICULARITY", "CMM_REQUIRED", "DATUM_DEPENDENT"],
          ["CMM inspection required", "Datum-controlled setup required"]);
      if (toleranceMm <= 0.3)
        return build("medium", "height_gauge", 6, "+4–8%",
          ["TIGHT_PERPENDICULARITY", "DATUM_DEPENDENT"],
          ["Height gauge inspection required", "First-article inspection recommended"]);
      return build("low", "caliper", 2, "+1–3%",
        [],
        ["Caliper inspection sufficient"]);
    }

    case "profile": {
      if (toleranceMm <= 0.1)
        return build("high", "cmm", 12, "+10–15%",
          ["TIGHT_PROFILE", "CMM_REQUIRED", "DATUM_DEPENDENT"],
          ["CMM inspection required", "Profile scanning fixture required"]);
      if (toleranceMm <= 0.5)
        return build("medium", "cmm", 6, "+4–8%",
          ["TIGHT_PROFILE", "CMM_REQUIRED"],
          ["CMM inspection required", "First-article inspection recommended"]);
      return build("low", "height_gauge", 2, "+1–3%",
        [],
        ["Height gauge inspection sufficient"]);
    }

    case "runout": {
      if (toleranceMm <= 0.02)
        return build("high", "cmm", 12, "+10–15%",
          ["TIGHT_RUNOUT", "CMM_REQUIRED"],
          ["CMM inspection required", "Dynamic balancing check recommended"]);
      if (toleranceMm <= 0.1)
        return build("medium", "height_gauge", 6, "+4–8%",
          ["TIGHT_RUNOUT"],
          ["Height gauge / dial indicator required", "First-article inspection recommended"]);
      return build("low", "caliper", 2, "+1–3%",
        [],
        ["Caliper or dial indicator inspection sufficient"]);
    }

    case "straightness": {
      if (toleranceMm <= 0.1)
        return build("high", "height_gauge", 12, "+10–15%",
          ["TIGHT_STRAIGHTNESS", "SURFACE_VERIFICATION_REQUIRED"],
          ["Height gauge inspection required", "Straightedge verification required"]);
      if (toleranceMm <= 0.5)
        return build("medium", "caliper", 6, "+4–8%",
          ["TIGHT_STRAIGHTNESS"],
          ["Caliper inspection required", "First-article inspection recommended"]);
      return build("low", "visual", 2, "+1–3%",
        [],
        ["Visual inspection sufficient"]);
    }

    case "circularity":
    case "cylindricity": {
      if (toleranceMm <= 0.02)
        return build("high", "cmm", 12, "+10–15%",
          ["TIGHT_FORM", "CMM_REQUIRED"],
          ["CMM inspection required", "Roundness measurement required"]);
      if (toleranceMm <= 0.1)
        return build("medium", "caliper", 6, "+4–8%",
          ["TIGHT_FORM"],
          ["Caliper measurement required", "First-article inspection recommended"]);
      return build("low", "visual", 2, "+1–3%",
        [],
        ["Visual inspection sufficient"]);
    }

    case "angularity": {
      if (toleranceMm <= 0.1)
        return build("high", "cmm", 12, "+10–15%",
          ["TIGHT_ANGULARITY", "CMM_REQUIRED", "DATUM_DEPENDENT"],
          ["CMM inspection required", "Angle gauge or sine bar required"]);
      if (toleranceMm <= 0.5)
        return build("medium", "height_gauge", 6, "+4–8%",
          ["TIGHT_ANGULARITY", "DATUM_DEPENDENT"],
          ["Height gauge inspection required", "First-article inspection recommended"]);
      return build("low", "caliper", 2, "+1–3%",
        [],
        ["Caliper inspection sufficient"]);
    }

    default: {
      if (toleranceMm <= 0.1)
        return build("medium", "caliper", 6, "+4–8%",
          ["UNKNOWN_TYPE"],
          ["Caliper inspection recommended", "Verify tolerance type with engineering"]);
      return build("low", "visual", 2, "+1–3%",
        ["UNKNOWN_TYPE"],
        ["Visual inspection — verify tolerance type with engineering"]);
    }
  }
}
