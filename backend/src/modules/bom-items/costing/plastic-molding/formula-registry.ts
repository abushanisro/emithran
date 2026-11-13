// The plastic molding formula registry: every calculation the plastic cost model makes (or cannot make yet), with its authority, units, inputs,
// dependencies, version, assumptions and validation state. Data, not behaviour: nothing here computes a cost.
//
// Why it exists: memory/Plastic Modeling holds data but no formula documents (docs/plastic-modeling/README.md, finding 1), so each formula in the model
// was written by an engineer from literature or from a variable's note. The registry says which, in one place, so a quote can state how far it can be
// trusted and a reviewer can see what a change touches.
//
// Rules (enforced by formula-registry.spec.ts):
//   - ids are unique; `dependsOn` names registered formulas and has no cycle;
//   - VALIDATED: a reference source, no assumption. ASSUMED: at least one stated assumption. UNSUPPORTED: no implementation, no amount;
//   - an implemented formula names its file, and that file names the formula id in a comment (so the code and the registry cannot drift apart silently);
//   - `version` goes up whenever the expression or a constant changes. A saved calculation records the versions it used (P3).
//
// Adding or changing an ASSUMED or UNSUPPORTED formula's behaviour needs explicit approval: provisional models are never enabled by default.

export type ValidationState = 'VALIDATED' | 'ASSUMED' | 'UNSUPPORTED';

export interface FormulaInput {
  name: string;
  unit: string;
  /** Where the value comes from: a staged dataset, a machine or material record, the CAD analysis, the scenario, or a constant in code. */
  source: string;
}

export interface FormulaEntry {
  /** F-nn for an implemented calculation, G-nn for one the model cannot make yet. */
  id: string;
  version: number;
  name: string;
  /** The expression, in words and symbols, with its units. Empty for an UNSUPPORTED entry. */
  expression: string;
  /** The unit of the result (or of the amount the formula would give). */
  outputUnit: string;
  inputs: readonly FormulaInput[];
  /** Registered formulas whose results this one uses. */
  dependsOn: readonly string[];
  /** The authority: a staged dataset, a standard, or published literature. Empty only for an UNSUPPORTED entry with no source at all. */
  referenceSource: string;
  assumptions: readonly string[];
  state: ValidationState;
  /** Path under costing/plastic-molding/ (or ../shared/...) of the implementation; null when UNSUPPORTED. */
  implementedIn: string | null;
  /** What data is staged for an UNSUPPORTED formula, so the work to enable it is visible. */
  stagedData?: string;
  note?: string;
}

const MEM = 'memory/Plastic Modeling';

export const PLASTIC_FORMULAS: readonly FormulaEntry[] = [
  {
    id: 'F-01', version: 1, name: 'Clamp force required',
    expression: 'tonnes = A x n x Pcav x k / 9806.65;  Pcav = max(Pmin, Pmax x (1 - r)) x pct(flow class) / 100  [MPa]',
    outputUnit: 't (tonne-force)',
    inputs: [
      { name: 'A projected area', unit: 'mm2', source: 'CAD analysis (bounding-box footprint when not measured)' },
      { name: 'n cavities', unit: 'count', source: 'F-10' },
      { name: 'Pmax injection pressure', unit: 'MPa', source: 'raw_materials (materials_final.csv processingParameters.injectionPressureMaxMPa)' },
      { name: 'r runner pressure reduction', unit: 'fraction', source: `${MEM}/variables: conventional/hotRunnerMaxPressureReductionFactor` },
      { name: 'Pmin', unit: 'MPa', source: `${MEM}/variables: minInjectionPressure` },
      { name: 'pct clamp share by flow class', unit: '%', source: `${MEM}/variables: minimumPercentClampForce{Easy,Medium,Hard}Flow, flowRatioThreshold*` },
      { name: 'k safety factor', unit: 'ratio', source: `${MEM}/variables: clampForceSafetyFactor` },
    ],
    dependsOn: ['F-10'],
    referenceSource: `${MEM}/variables (parameters). The structure follows the variable notes, which name 'adjustedInjectionPressure'; no formula document exists.`,
    assumptions: ['The combination of the staged parameters (adjusted pressure x share x area x factor) is the reference clamp model; memory/ states the parameters, not the formula.'],
    state: 'ASSUMED', implementedIn: 'clamp-force.ts',
    note: 'Parameters are VALIDATED data; the structure is not documented in memory/.',
  },
  {
    id: 'F-02', version: 1, name: 'Shot size in GPPS grams',
    expression: 'g_GPPS = m_shot x (rho_melt,GPPS / rho_melt,material) x k_shot;  m_shot = m_part x (1 + runner share) [F-03]',
    outputUnit: 'g (GPPS)',
    inputs: [
      { name: 'm_part', unit: 'kg', source: 'CAD volume x material density' },
      { name: 'rho_melt,material', unit: 'kg/m3', source: 'raw_materials (densityOfMeltKgM3)' },
      { name: 'rho_melt,GPPS', unit: 'kg/m3', source: `${MEM}/materials_final.csv: Polystyrene at variables GPPSMeltTemperature` },
      { name: 'k_shot', unit: 'ratio', source: `${MEM}/variables: shotSizeSafetyFactor` },
    ],
    dependsOn: ['F-03'],
    referenceSource: `${MEM}/machine: limits.shotSizeGppsG (press shot capacity is rated in GPPS grams); same barrel melt volume.`,
    assumptions: [], state: 'VALIDATED', implementedIn: 'shot-size.ts',
  },
  {
    id: 'F-03', version: 1, name: 'Runner and sprue allowance',
    expression: 'runner share = 8 % (cold runner) or 1 % (hot runner) of the part mass',
    outputUnit: 'fraction of part mass',
    inputs: [{ name: 'runner system', unit: 'cold | hot', source: `${MEM}/variables: defaultRunnerSystem, or the part's gate signal` }],
    dependsOn: [],
    referenceSource: 'None: shot-size.ts states "the one figure here without a reference source".',
    assumptions: ['Cold runner 8 % and hot runner 1 % of part mass are engineering estimates, not reference data.', 'The runner volume cannot be derived from geometry: the branch-length rule is not in memory/.'],
    state: 'ASSUMED', implementedIn: 'shot-size.ts', note: 'Affects the shot size, the material cost and the cycle (shot melt volume).',
  },
  {
    id: 'F-04', version: 1, name: 'Cooling time (Menges)',
    expression: 't = s^2 / (pi^2 x alpha) x ln((4/pi) x (Tm - Tw) / (Te - Tw));  alpha = k / (rho_melt x cp)  [s]',
    outputUnit: 's',
    inputs: [
      { name: 's wall thickness', unit: 'mm', source: 'CAD nominal wall' },
      { name: 'k, cp, rho_melt, Tm, Tw, Te', unit: 'W/(m K), J/(g K), kg/m3, C', source: 'raw_materials thermal properties (materials_final.csv)' },
      { name: 'mold temperature increase', unit: 'C', source: `${MEM}/variables: defaultMoldTemperatureIncrease` },
    ],
    dependsOn: [],
    referenceSource: 'Menges, How to Make Injection Molds (literature). The material inputs are reference data.',
    assumptions: ['The Menges plate-cooling equation is the cooling model; memory/ contains no cooling formula.'],
    state: 'ASSUMED', implementedIn: 'process/cycle-time.ts',
  },
  {
    id: 'F-05', version: 1, name: 'Fill time',
    expression: 't = V_shot / Q_press x f_cavities x f_gates  [s]',
    outputUnit: 's',
    inputs: [
      { name: 'V_shot melt volume', unit: 'mm3', source: 'F-02 mass / melt density' },
      { name: 'Q_press injection rate', unit: 'mm3/s', source: `${MEM}/machine: rates.injectionRateMm3PerS` },
      { name: 'f_cavities, f_gates', unit: 'ratio', source: `${MEM}/lookup: injectionTimeAdjustmentFactors` },
    ],
    dependsOn: ['F-03'],
    referenceSource: `${MEM}/machine + ${MEM}/lookup/injectionTimeAdjustmentFactors`,
    assumptions: [],
    state: 'VALIDATED', implementedIn: 'process/cycle-time.ts',
    note: 'Open question: variable injectionRateMultiplier (0.25, "downgrade the machine injection rate") is staged and unread (investigation I-4).',
  },
  {
    id: 'F-06', version: 1, name: 'Pack and hold time',
    expression: 't = max(2 s, 0.35 x t_cooling)',
    outputUnit: 's',
    inputs: [{ name: 't_cooling', unit: 's', source: 'F-04' }],
    dependsOn: ['F-04'],
    referenceSource: 'Menges gate-freeze rule (literature). "The reference data holds no hold time."',
    assumptions: ['Hold time is 35 % of cooling time with a 2 s floor.'],
    state: 'ASSUMED', implementedIn: 'process/cycle-time.ts',
  },
  {
    id: 'F-07', version: 1, name: 'Mold open and close time',
    expression: 't = press dry cycle time',
    outputUnit: 's',
    inputs: [{ name: 'dry cycle', unit: 's', source: `${MEM}/machine: time.dryCycleTimeS (Euromap 6)` }],
    dependsOn: [],
    referenceSource: `${MEM}/machine (Euromap 6 dry cycle)`, assumptions: [],
    state: 'VALIDATED', implementedIn: 'process/cycle-time.ts',
  },
  {
    id: 'F-08', version: 1, name: 'Cycle time',
    expression: 't = (t_fill + t_pack + t_cooling + t_open/close) x cycleTimeAdjustmentFactor',
    outputUnit: 's',
    inputs: [{ name: 'cycleTimeAdjustmentFactor', unit: 'ratio', source: `${MEM}/variables: cycleTimeAdjustmentFactor` }],
    dependsOn: ['F-04', 'F-05', 'F-06', 'F-07'],
    referenceSource: `${MEM}/variables`, assumptions: ['Ejector travel, plasticizing, part and material handling are not in the cycle (no formulas or press data).'],
    state: 'ASSUMED', implementedIn: 'process/cycle-time.ts',
  },
  {
    id: 'F-09', version: 1, name: 'LSR cure time (Arrhenius)',
    expression: 't = 0.008 x exp(3500 / T) x s  [s], T in K, default mold 180 C',
    outputUnit: 's',
    inputs: [{ name: 's wall thickness', unit: 'mm', source: 'CAD nominal wall' }],
    dependsOn: [],
    referenceSource: 'Ossipov et al., Polymer Engineering, 2002 (literature constants)',
    assumptions: ['Literature constants and a 180 C default mold temperature apply to every LSR grade.'],
    state: 'ASSUMED', implementedIn: 'process/cycle-time.ts', note: 'Liquid silicone only.',
  },
  {
    id: 'F-10', version: 1, name: 'Cavity count',
    expression: 'the user override, else defaultNumCavities; a count must be a reference layout (layoutNumCav)',
    outputUnit: 'count',
    inputs: [
      { name: 'layoutNumCav', unit: 'count', source: `${MEM}/lookup: layoutNumCav` },
      { name: 'defaultNumCavities', unit: 'count', source: `${MEM}/variables: defaultNumCavities` },
    ],
    dependsOn: [], referenceSource: `${MEM}/lookup + ${MEM}/variables`, assumptions: [],
    state: 'VALIDATED', implementedIn: 'process/cost-injection-molding-engine.ts',
  },
  {
    id: 'F-11', version: 1, name: 'Press capability',
    expression: 'clamp >= F-01, shot >= F-02, tie bars fit part + runner, tool height within the press daylight',
    outputUnit: 'capable | not capable, with reasons',
    inputs: [
      { name: 'press clamp, shot, tie bars, mold height', unit: 'kN, g, mm, mm', source: `${MEM}/machine: limits.*` },
      { name: 'estimated tool height', unit: 'mm', source: 'part longest side + 100 mm (IM_TOOL_HEIGHT_ALLOWANCE_MM)' },
    ],
    dependsOn: ['F-01', 'F-02'], referenceSource: `${MEM}/machine`,
    assumptions: ['Tool height is the longest part side plus a 100 mm allowance (no mold design exists at quote time).'],
    state: 'ASSUMED', implementedIn: '../shared/capability/machine-selection/press-checks.ts',
  },
  {
    id: 'F-12', version: 1, name: 'Press operation cost per part',
    expression: 'cost = (R_machine + R_labour x operators) x (t_cycle / 3600 + t_setup / (3600 x batch))  [USD]; machine and labour parts kept apart',
    outputUnit: 'USD per part',
    inputs: [
      { name: 'R_machine', unit: 'USD/h', source: `${MEM}/machine: direct + indirect overhead (mhr_records.total_machine_hour_rate)` },
      { name: 'R_labour', unit: 'USD/h', source: `${MEM}/machine: accounting.laborRateUsdPerHr (mhr_records.usd_lhr_total)` },
      { name: 'operators', unit: 'count (fractional)', source: `${MEM}/machine: accounting.numberOfOperators (mhr_records.operators, numeric since migration 971)` },
      { name: 't_setup', unit: 'h', source: `${MEM}/machine: time.setupTimeHr` },
    ],
    dependsOn: ['F-08'], referenceSource: `${MEM}/machine`, assumptions: [],
    state: 'VALIDATED', implementedIn: 'process/cost-injection-molding-engine.ts',
    note: 'VALIDATED once the staged operators equal the source (restage-machine-operators.cjs --check returns 0 rows).',
  },
  {
    id: 'F-13', version: 1, name: 'Good-part yield',
    expression: 'cost per good part = cost / yield',
    outputUnit: 'ratio', inputs: [{ name: 'yield', unit: 'fraction', source: `${MEM}/machine: yields.goodPartYield` }],
    dependsOn: [], referenceSource: `${MEM}/machine`, assumptions: [],
    state: 'VALIDATED', implementedIn: 'process/cost-injection-molding-engine.ts',
  },
  {
    id: 'F-14', version: 1, name: 'Material cost per part',
    expression: 'cost = m_shot / yield x price per kg  [USD]',
    outputUnit: 'USD per part',
    inputs: [{ name: 'price per kg', unit: 'USD/kg', source: 'raw_materials regional price (materials_final.csv cost.* is not read: investigation D-5)' }],
    dependsOn: ['F-02', 'F-13'], referenceSource: 'raw_materials',
    assumptions: ['The runner and sprue are scrapped, not regrind (processCompatibility.canRegrind is not read).'],
    state: 'ASSUMED', implementedIn: 'process/cost-injection-molding-engine.ts',
  },
  {
    id: 'F-15', version: 1, name: 'SPI mold class',
    expression: 'the class whose annual cycle rating covers the lifetime shots, moved up for parting complexity and undercuts',
    outputUnit: 'class 101-105 (informational)',
    inputs: [{ name: 'Num Annual Mold Cycles', unit: 'cycles', source: `${MEM}/lookup: tblSpiType` }],
    dependsOn: [], referenceSource: `${MEM}/lookup/tblSpiType (ratings)`,
    assumptions: ['The complexity and undercut bump is a code rule, not reference data.', 'The class does not change any cost (investigation I-2); tblSpiType.Use Insert is unread.'],
    state: 'ASSUMED', implementedIn: 'process/cost-injection-molding-engine.ts',
  },
  {
    id: 'F-16', version: 1, name: 'Mold tooling (purchased components, design, machining, assembly)',
    expression: 'cost = sum(component cost x quantity) + design h(area) x R_design + (2 x area / rate + setups) x R_machining + assembly h x R_assembly  [USD per mold]',
    outputUnit: 'USD per mold',
    inputs: [
      { name: 'components, assembly times, design hours, machining rates and setups', unit: 'USD, h', source: `${MEM}/lookup: cmStandardToolingComponents, cmToolAssemblyTimes, cmMoldBaseDesignHours, cmToolMachiningRates, cmToolMachiningSetups` },
      { name: 'toolroom rates', unit: 'USD/h', source: `${MEM}/process/digital_factory_settings_usa.csv (USA only)` },
      { name: 'mold window area', unit: 'mm2', source: 'projected area x cavities, no margin' },
    ],
    dependsOn: ['F-10'], referenceSource: `${MEM}/lookup (cm* tables)`,
    assumptions: [
      'The compression-molding component BOM applies to an injection mold (air poppets, no sprue bushing or water components): investigation I-3.',
      'Mold window area is the projected area times cavities with no allowance.',
      'One purchased-component set for any cavity count (investigation I-1).',
    ],
    state: 'ASSUMED', implementedIn: 'process/mold-tooling-engine.ts', note: 'Excludes mold-base steel, EDM, texture, cooling, etc. (G-01..G-08).',
  },
  {
    id: 'F-17', version: 1, name: 'Molds required',
    expression: 'molds = ceil(lifetime shots per cavity / shots per tool);  tooling = molds x F-16',
    outputUnit: 'count',
    inputs: [{ name: 'shots per tool', unit: 'shots', source: `${MEM}/lookup: tblToolLife (by resin), variables defaultToolLife` }],
    dependsOn: ['F-10', 'F-16'], referenceSource: `${MEM}/lookup/tblToolLife`,
    assumptions: ['tblToolLife counts whole molds, and a replacement mold costs the full price.', 'The class rating (F-15) does not limit the number of molds (investigation I-2, D-9).'],
    state: 'ASSUMED', implementedIn: 'process/cost-injection-molding-engine.ts',
  },
  {
    id: 'F-18', version: 1, name: 'Tooling amortisation per part',
    expression: 'per part = investment / (annual volume x production life)  [USD]',
    outputUnit: 'USD per part',
    inputs: [{ name: 'annual volume, production life', unit: 'parts/yr, yr', source: 'scenario' }],
    dependsOn: ['F-17'], referenceSource: 'Scenario inputs', assumptions: [],
    state: 'VALIDATED', implementedIn: 'process/cost-injection-molding-engine.ts',
  },

  {
    id: 'F-19', version: 1, name: 'Reaction injection molding fill time',
    expression: 't = (V_part x n_cavities) / Q_machine  [s]; V in mm3, Q in mm3/s',
    outputUnit: 's',
    inputs: [
      { name: 'V_part part volume', unit: 'mm3', source: 'CAD net part volume (mm3)' },
      { name: 'n_cavities', unit: 'count', source: 'cost engine: the RIM engine prices one part per press cycle (1)' },
      { name: 'Q_machine injection rate', unit: 'mm3/s', source: `${MEM}/machine/reaction_injection_molding_machines.csv: rates.injectionRateMm3PerS` },
    ],
    dependsOn: [],
    referenceSource: `${MEM}/machine/reaction_injection_molding_machines.csv: rates.injectionRateMm3PerS (the staged rate; the reference states no RIM fill formula)`,
    assumptions: [
      'Fill time is the shot volume over the staged machine injection rate: the approved simplification, not a reference formula.',
      'Runner and sprue volume, mix-head purge, material viscosity, flow resistance and the injection profile are not modelled; no runner volume is staged for RIM.',
    ],
    state: 'ASSUMED', implementedIn: 'calculators/plastic-molding-calculators.json',
    note: 'Calculator "Reaction Injection Molding - Cycle Time" (F-19 is its Fill Time). A missing or invalid volume or rate makes the cycle a named gap, never a default.',
  },

  {
    id: 'F-24', version: 1, name: 'Deflashing time (manual flash trimming)',
    expression: 't = L_parting / r_trim  [s]',
    outputUnit: 's',
    inputs: [
      { name: 'L_parting parting line length', unit: 'mm', source: 'CAD PartingLine feature (cad-engine parting_line_reading_v1)' },
      { name: 'r_trim manual flash trimming rate', unit: 'mm/s', source: `${MEM}/variables: cmManualFlashTrimmingRate` },
    ],
    dependsOn: [],
    referenceSource: `${MEM}/variables/cmManualFlashTrimmingRate (Compression Molding:Manual Flash Trimming//PartingLine)`,
    assumptions: [
      'The rate is staged for compression molding and borrowed for injection molding, which has no staged rate.',
      'The reference types the rate only as Length/Time; it is read as mm/s, the unit that fits the reference\'s other Length/Time rates and a manual trim.',
      'The whole parting line is trimmed; internal cutouts and the flash thickness are not modelled.',
    ],
    state: 'ASSUMED', implementedIn: 'calculators/plastic-molding-calculators.json',
  },

  {
    id: 'F-25', version: 1, name: 'Mold base and plate steel',
    expression: 'base = smallest tblStandardMoldBaseSizes holding (layout + borders); A = max(min_A, r x h + border_cav); B = max(min_B, (1 - r) x h + border_core); m = W x L x (clamp_top + A + B + support + clamp_bottom) x rho; cost = m x price x moldBaseCostFactor',
    outputUnit: 'USD',
    inputs: [
      { name: 'layout, between-parts border, edge borders', unit: 'count, mm', source: `${MEM}/lookup: layoutNumCav, tblEdgeMoldBorderX/Y; variables: betweenPartsMoldBorder` },
      { name: 'W x L standard base', unit: 'mm', source: `${MEM}/lookup/tblStandardMoldBaseSizes` },
      { name: 'h part height', unit: 'mm', source: 'CAD bounding box, the smallest side' },
      { name: 'r, min_A, min_B, plate thicknesses', unit: 'ratio, mm', source: `${MEM}/variables: aPlateFlatCavityRatio, a/bPlateMinThickness, top/bottomClampPlateThickness, supportPlateThickness` },
      { name: 'border_cav, border_core', unit: 'mm', source: `${MEM}/lookup: tblCavity/CorePlateDepthBorder (inches)` },
      { name: 'rho, price, moldBaseCostFactor', unit: 'kg/m3, USD/kg, ratio', source: `${MEM}/process/digital_factory_tool_materials_usa: the default tool material (AISI P20)` },
    ],
    dependsOn: [],
    referenceSource: `${MEM}/lookup + variables + process/digital_factory_tool_materials_usa`,
    assumptions: [
      'The reference holds the sizes, borders, plate thicknesses and the steel, not the formula: the stack is priced as tool steel by mass.',
      'The runner region coefficient widens the cavity region; the base may be turned to fit; a base larger than every standard one is not modelled (a named gap).',
      'The ejector plates and rails have no injection-molding thickness on file and are not included.',
    ],
    state: 'ASSUMED', implementedIn: 'process/mold-base.ts',
  },

  {
    id: 'F-26', version: 1, name: 'Cavity and core machining and polish',
    expression: 'complexity = faces <= simple ? Simple : faces <= average ? Average : Complex;  machining = A_in2 x h_per_in2(complexity, A) x cavities x machining rate;  polish = A_m2 x h_per_m2(finish) x cavities x assembly rate',
    outputUnit: 'USD',
    inputs: [
      { name: 'A part surface area', unit: 'mm2', source: 'CAD' },
      { name: 'faces', unit: 'count', source: 'CAD face count (face_graph.face_attributes)' },
      { name: 'simple, average', unit: 'count', source: `${MEM}/variables: cmMoldSurfaceCountThreshold{Simple,Average} (compression molding, borrowed)` },
      { name: 'h_per_in2', unit: 'h/in2', source: `${MEM}/lookup: tblHrsPerSqInch{Simple,Average,Complex}` },
      { name: 'h_per_m2', unit: 'h/m2', source: `${MEM}/lookup/SPIFinishes: defaultCavityFinishIM` },
    ],
    dependsOn: [],
    referenceSource: `${MEM}/lookup + variables`,
    assumptions: [
      'The face-count complexity thresholds are staged for compression molding and borrowed: the injection process states no rule.',
      'The machining hours cover the whole part surface (cavity and core halves) for each cavity; the polish is charged at the assembly (bench) rate, as no polishing rate is on file.',
    ],
    state: 'ASSUMED', implementedIn: 'process/mold-cavity.ts',
  },

  // What the model cannot compute yet: data is staged, no authoritative formula exists (README section 8).
  ...([
    ['G-03', 'Slides and lifters', 'tblSlideSizes; slide* and lifter* variables; costPerHydraulicEjector; slideCycleRate'],
    ['G-04', 'EDM and heat treatment', 'edmRateUsdPerHr; EDM material per in3; heatTreatRateUsdPerKg; stressReliefRateUsdPerKg'],
    ['G-05', 'Mold texture', 'cavityTextures; cmToolTexture; toolBlastingRate; toolChemicalEtchingRate; toolMaskingRate; toolDryingTime'],
    ['G-06', 'Cooling and water lines', 'tblStandardWaterLineSizes; defaultWaterLineDiameter; water* cost variables'],
    ['G-07', 'Inserts and unscrewing mechanisms', 'insertInstallRate; cmInsertManualLoadingTime; defaultInsertCost; costPerUnscrewingMechanism; tblSpiType.Use Insert'],
    ['G-08', 'Tool assembly extras: ejector system, sprue, locating ring, hot drops, try-out', 'ejector*, sprueBushingCost, locatingRingsCost, costPerStandardHotDrop, tryoutRateUsdPerHr'],
    ['G-09', 'Handling, setup scrap and plasticizing in the cycle', 'partHandlingTimes; materialHandling; scrapTimeInMinutes_*; plasticizingRateByClampForce; machine plasticizingRateGppsGPerS'],
    ['G-10', 'Period costs: indirect overhead, SG&A, margin', 'sGandARate; markUpRate; machine indirect overhead'],
    ['G-11', 'Material drying, visual inspection, ultrasonic welding, cure oven, LSR dosing', 'nothing staged'],
  ] as const).map(([id, name, stagedData]): FormulaEntry => ({
    id, version: 1, name, expression: '', outputUnit: 'USD', inputs: [], dependsOn: [], referenceSource: '',
    assumptions: [], state: 'UNSUPPORTED', implementedIn: null, stagedData,
    note: 'No authoritative formula in memory/. The quote carries a data gap, never a zero. A provisional model needs explicit approval and is never enabled by default.',
  })),
];

const ORDER: Record<ValidationState, number> = { VALIDATED: 0, ASSUMED: 1, UNSUPPORTED: 2 };

/** The weakest state among the given states: a quote is only as trustworthy as its weakest step. */
export function weakestState(states: readonly ValidationState[]): ValidationState {
  return states.reduce<ValidationState>((worst, s) => (ORDER[s] > ORDER[worst] ? s : worst), 'VALIDATED');
}

const BY_ID = new Map(PLASTIC_FORMULAS.map((f) => [f.id, f]));
export const formulaById = (id: string): FormulaEntry | undefined => BY_ID.get(id);
