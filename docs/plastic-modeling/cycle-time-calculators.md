# Plastic molding: cycle-time calculators, feature lookup tables and how each cycle time is calculated

Generated from `plastic-molding-calculators.json` (migration 975), `memory/Plastic Modeling/process/digital_factory_operations.csv`, `memory/Plastic Modeling/lookup/injectionTimeAdjustmentFactors` and the formula registry. Do not edit by hand: `npx ts-node --transpile-only scripts/generate-plastic-calculator-report.ts`; a test fails when this file is stale.

Each of the four molding processes has one cycle-time calculator, stored in the database and mapped to its catalog operation in `process_calculator_mappings`, the way heat treatment, machining and die casting have theirs. A calculator is a list of fields: inputs, each with where its value comes from, and formulas over earlier fields, ending in **Cycle Time** (seconds). The cost engine supplies the inputs and the calculator holds the formulas.

**If a molding line says the calculator "is not in this database".** The calculators are rows in the database, created by migration 975 and updated by 976 (the reaction injection calculator, version 2). A database that has not had them applied has no calculator to run, so the cycle time is a named gap, never a number, and the Select Calculator list has nothing to offer for the line. Apply them with `npm run db:migrate -- --env <local|stage|prd>` (add `--dry-run` first to see what is pending; production needs `--confirm`). The backend logs once, at the first request, which calculators are missing.

**Reading the feature tables.** The reference catalog lists, per process, the operations each feature type can need (`As Molded`, a core, a lifter, a slide, flash trimming). No feature enters any cycle-time formula today: the cycle depends on the material, the press, the wall and the shot size. The time slides and lifters add is not modelled because the reference stages their sizes and rates but no formula (G-03).

## Injection Molding

Calculator **Injection Molding - Cycle Time**, mapped to the catalog operation `Injection Molding` (22 fields).

Injection cycle time = (Fill + Pack + Cooling + Mold open/close) x Cycle Time Adjustment Factor (formula registry F-08, ASSUMED). Cooling is the Menges plate-cooling equation, t = s^2 / (pi^2 alpha) x ln((4/pi)(Tm - Tw)/(Te - Tw)), alpha = k / (rho cp) (F-04, ASSUMED: memory/ holds no cooling formula). Fill = shot melt volume / the press injection rate x the injectionTimeAdjustmentFactors for cavities and gates (F-05, VALIDATED). Pack = 35 % of cooling with a 2 s floor, the Menges gate-freeze rule (F-06, ASSUMED: the reference holds no hold time). Mold open/close = the press Euromap 6 dry cycle (F-07, VALIDATED). Not modelled, because the reference has no formula or press data: ejector travel, plasticizing, part and material handling, slides and lifters. Rounded as the engine does: cooling and pack to 0.1 s, fill and the total to 0.01 s.

### Feature lookup table

| Feature type | Operations the reference lists for Injection Molding | Enters the cycle time |
|---|---|---|
| ComboVoid | As Molded, ComboVoidLifter, ComboVoidNoCore, ComboVoidSideCore, ComboVoidUnscrewMandrel | No |
| CurvedSurface | As Molded | No |
| CurvedWall | As Molded | No |
| LifterBundle | Lifters | No: the slide and lifter cycle is not modelled (G-03) |
| MultiStepHole | As Molded, MstepLifter, MstepNoCore, MstepSideCore, MstepUnscrewMandrel | No |
| PlanarFace | As Molded | No |
| Rib | As Molded | No |
| SharpEdge | As Molded | No |
| SimpleHole | As Molded, HoleLifter, HoleNoCore, HoleSideCore, HoleUnscrewMandrel | No |
| SlideBundle | Slides | No: the slide and lifter cycle is not modelled (G-03) |
| Void | As Molded, VoidLifter, VoidNoCore, VoidSideCore | No |

### How the cycle time is calculated

| # | Field | Unit | Input, or formula | Registry |
|---|---|---|---|---|
| 1 | Nominal Wall Thickness | mm | CAD: wallThicknessNominalMm |  |
| 2 | Melt Temperature | °C | Material reference: meltingTempC |  |
| 3 | Mold Temperature | °C | Material reference: moldTempC |  |
| 4 | Mold Temperature Increase | °C | Reference variable: defaultMoldTemperatureIncrease |  |
| 5 | Ejection Temperature | °C | Material reference: ejectDeflectionTempC |  |
| 6 | Specific Heat of Melt | J/g·K | Material reference: specificHeatOfMeltJgC |  |
| 7 | Thermal Conductivity of Melt | W/m·K | Material reference: thermalConductivityOfMeltWattsMC |  |
| 8 | Melt Density | kg/m³ | Material reference: densityOfMeltKgM3 |  |
| 9 | Shot Melt Volume | mm³ | Cost engine: shotMeltVolumeMm3 (part volume x cavities + runner, at melt density) |  |
| 10 | Press Injection Rate | mm³/s | Machine record: rates.injectionRateMm3PerS |  |
| 11 | Fill Factor for Cavities |  | Lookup table: injectionTimeAdjustmentFactors.Adjustment Factor where Attribute = Cavities Per Mold and Number >= cavities per mold (first bracket) |  |
| 12 | Fill Factor for Gates |  | Lookup table: injectionTimeAdjustmentFactors.Adjustment Factor where Attribute = Gates Per Cavity and Number >= gates per cavity (first bracket) |  |
| 13 | Press Dry Cycle Time | s | Machine record: time.dryCycleTimeS (Euromap 6: mold open and close, no material) | F-07 v1, VALIDATED |
| 14 | Cycle Time Adjustment Factor |  | Reference variable: cycleTimeAdjustmentFactor |  |
| 15 | Mold Wall Temperature | °C | `{Mold Temperature} + {Mold Temperature Increase}` |  |
| 16 | Thermal Diffusivity | mm²/s | `{Thermal Conductivity of Melt} / ({Melt Density} * {Specific Heat of Melt} * 1000) * 1000000` |  |
| 17 | Cooling Time | s | `floor({Nominal Wall Thickness} * {Nominal Wall Thickness} / (pi * pi * {Thermal Diffusivity}) * LN(4 / pi * ({Melt Temperature} - {Mold Wall Temperature}) / ({Ejection Temperature} - {Mold Wall Temperature})) * 10 + 0.5) / 10` | F-04 v1, ASSUMED |
| 18 | Fill Time | s | `floor({Shot Melt Volume} / {Press Injection Rate} * {Fill Factor for Cavities} * {Fill Factor for Gates} * 100 + 0.5) / 100` | F-05 v1, VALIDATED |
| 19 | Pack to Cooling Ratio |  | `0.35` |  |
| 20 | Pack Time Minimum | s | `2` |  |
| 21 | Pack Time | s | `max({Pack Time Minimum}, floor({Cooling Time} * {Pack to Cooling Ratio} * 10 + 0.5) / 10)` | F-06 v1, ASSUMED |
| 22 | Cycle Time | s | `floor(({Fill Time} + {Pack Time} + {Cooling Time} + {Press Dry Cycle Time}) * {Cycle Time Adjustment Factor} * 100 + 0.5) / 100` | F-08 v1, ASSUMED |

Lookup table behind the two fill factors, `injectionTimeAdjustmentFactors` (the first row whose Number is at least the value is used; the last row covers the rest):

| Attribute | Number (up to) | Adjustment factor |
|---|---|---|
| Cavities Per Mold | 3 | 1 |
| Cavities Per Mold | 5 | 1.02 |
| Cavities Per Mold | 8 | 1.05 |
| Cavities Per Mold | 999999 | 1.1 |
| Gates Per Cavity | 1 | 0.6 |
| Gates Per Cavity | 2 | 0.4 |
| Gates Per Cavity | 3 | 0.3 |
| Gates Per Cavity | 4 | 0.25 |
| Gates Per Cavity | 999999 | 0.25 |

For a liquid silicone rubber the engine uses **Injection Molding - LSR Cycle Time** instead (cure replaces cooling, no pack phase); no catalog operation maps to it:

| # | Field | Unit | Input, or formula | Registry |
|---|---|---|---|---|
| 1 | Nominal Wall Thickness | mm | CAD: wallThicknessNominalMm |  |
| 2 | Shot Melt Volume | mm³ | Cost engine: shotMeltVolumeMm3 (part volume x cavities + runner, at melt density) |  |
| 3 | Press Injection Rate | mm³/s | Machine record: rates.injectionRateMm3PerS |  |
| 4 | Fill Factor for Cavities |  | Lookup table: injectionTimeAdjustmentFactors.Adjustment Factor where Attribute = Cavities Per Mold and Number >= cavities per mold (first bracket) |  |
| 5 | Fill Factor for Gates |  | Lookup table: injectionTimeAdjustmentFactors.Adjustment Factor where Attribute = Gates Per Cavity and Number >= gates per cavity (first bracket) |  |
| 6 | Press Dry Cycle Time | s | Machine record: time.dryCycleTimeS (Euromap 6: mold open and close, no material) | F-07 v1, VALIDATED |
| 7 | Cycle Time Adjustment Factor |  | Reference variable: cycleTimeAdjustmentFactor |  |
| 8 | LSR Mold Temperature | °C | `180` |  |
| 9 | LSR Pre-exponential Factor |  | `0.008` |  |
| 10 | LSR Activation Energy over R | K | `3500` |  |
| 11 | Kelvin Offset | K | `273.15` |  |
| 12 | Cure Time | s | `floor({LSR Pre-exponential Factor} * exp({LSR Activation Energy over R} / ({LSR Mold Temperature} + {Kelvin Offset})) * {Nominal Wall Thickness} * 10 + 0.5) / 10` | F-09 v1, ASSUMED |
| 13 | Fill Time | s | `floor({Shot Melt Volume} / {Press Injection Rate} * {Fill Factor for Cavities} * {Fill Factor for Gates} * 100 + 0.5) / 100` | F-05 v1, VALIDATED |
| 14 | Cycle Time | s | `floor(({Fill Time} + {Cure Time} + {Press Dry Cycle Time}) * {Cycle Time Adjustment Factor} * 100 + 0.5) / 100` | F-08 v1, ASSUMED |

## Structural Foam Molding

Calculator **Structural Foam Molding - Cycle Time**, mapped to the catalog operation `Structural foam molding` (22 fields).

Structural foam uses the injection cycle model unchanged (the cost engine reuses it with a foam press): the reference holds no foam-specific cooling or fill formula, so foaming, which lengthens cooling, is NOT modelled and the cycle is understated for foam parts until a validated formula is supplied. Injection cycle time = (Fill + Pack + Cooling + Mold open/close) x Cycle Time Adjustment Factor (formula registry F-08, ASSUMED). Cooling is the Menges plate-cooling equation, t = s^2 / (pi^2 alpha) x ln((4/pi)(Tm - Tw)/(Te - Tw)), alpha = k / (rho cp) (F-04, ASSUMED: memory/ holds no cooling formula). Fill = shot melt volume / the press injection rate x the injectionTimeAdjustmentFactors for cavities and gates (F-05, VALIDATED). Pack = 35 % of cooling with a 2 s floor, the Menges gate-freeze rule (F-06, ASSUMED: the reference holds no hold time). Mold open/close = the press Euromap 6 dry cycle (F-07, VALIDATED). Not modelled, because the reference has no formula or press data: ejector travel, plasticizing, part and material handling, slides and lifters. Rounded as the engine does: cooling and pack to 0.1 s, fill and the total to 0.01 s.

### Feature lookup table

| Feature type | Operations the reference lists for Structural Foam Molding | Enters the cycle time |
|---|---|---|
| ComboVoid | As Molded, ComboVoidLifter, ComboVoidNoCore, ComboVoidSideCore, ComboVoidUnscrewMandrel | No |
| CurvedSurface | As Molded | No |
| CurvedWall | As Molded | No |
| LifterBundle | Lifters | No: the slide and lifter cycle is not modelled (G-03) |
| MultiStepHole | As Molded, MstepLifter, MstepNoCore, MstepSideCore, MstepUnscrewMandrel | No |
| PlanarFace | As Molded | No |
| Rib | As Molded | No |
| SharpEdge | As Molded | No |
| SimpleHole | As Molded, HoleLifter, HoleNoCore, HoleSideCore, HoleUnscrewMandrel | No |
| SlideBundle | Slides | No: the slide and lifter cycle is not modelled (G-03) |
| Void | As Molded, VoidLifter, VoidNoCore, VoidSideCore | No |

### How the cycle time is calculated

| # | Field | Unit | Input, or formula | Registry |
|---|---|---|---|---|
| 1 | Nominal Wall Thickness | mm | CAD: wallThicknessNominalMm |  |
| 2 | Melt Temperature | °C | Material reference: meltingTempC |  |
| 3 | Mold Temperature | °C | Material reference: moldTempC |  |
| 4 | Mold Temperature Increase | °C | Reference variable: defaultMoldTemperatureIncrease |  |
| 5 | Ejection Temperature | °C | Material reference: ejectDeflectionTempC |  |
| 6 | Specific Heat of Melt | J/g·K | Material reference: specificHeatOfMeltJgC |  |
| 7 | Thermal Conductivity of Melt | W/m·K | Material reference: thermalConductivityOfMeltWattsMC |  |
| 8 | Melt Density | kg/m³ | Material reference: densityOfMeltKgM3 |  |
| 9 | Shot Melt Volume | mm³ | Cost engine: shotMeltVolumeMm3 (part volume x cavities + runner, at melt density) |  |
| 10 | Press Injection Rate | mm³/s | Machine record: rates.injectionRateMm3PerS |  |
| 11 | Fill Factor for Cavities |  | Lookup table: injectionTimeAdjustmentFactors.Adjustment Factor where Attribute = Cavities Per Mold and Number >= cavities per mold (first bracket) |  |
| 12 | Fill Factor for Gates |  | Lookup table: injectionTimeAdjustmentFactors.Adjustment Factor where Attribute = Gates Per Cavity and Number >= gates per cavity (first bracket) |  |
| 13 | Press Dry Cycle Time | s | Machine record: time.dryCycleTimeS (Euromap 6: mold open and close, no material) | F-07 v1, VALIDATED |
| 14 | Cycle Time Adjustment Factor |  | Reference variable: cycleTimeAdjustmentFactor |  |
| 15 | Mold Wall Temperature | °C | `{Mold Temperature} + {Mold Temperature Increase}` |  |
| 16 | Thermal Diffusivity | mm²/s | `{Thermal Conductivity of Melt} / ({Melt Density} * {Specific Heat of Melt} * 1000) * 1000000` |  |
| 17 | Cooling Time | s | `floor({Nominal Wall Thickness} * {Nominal Wall Thickness} / (pi * pi * {Thermal Diffusivity}) * LN(4 / pi * ({Melt Temperature} - {Mold Wall Temperature}) / ({Ejection Temperature} - {Mold Wall Temperature})) * 10 + 0.5) / 10` | F-04 v1, ASSUMED |
| 18 | Fill Time | s | `floor({Shot Melt Volume} / {Press Injection Rate} * {Fill Factor for Cavities} * {Fill Factor for Gates} * 100 + 0.5) / 100` | F-05 v1, VALIDATED |
| 19 | Pack to Cooling Ratio |  | `0.35` |  |
| 20 | Pack Time Minimum | s | `2` |  |
| 21 | Pack Time | s | `max({Pack Time Minimum}, floor({Cooling Time} * {Pack to Cooling Ratio} * 10 + 0.5) / 10)` | F-06 v1, ASSUMED |
| 22 | Cycle Time | s | `floor(({Fill Time} + {Pack Time} + {Cooling Time} + {Press Dry Cycle Time}) * {Cycle Time Adjustment Factor} * 100 + 0.5) / 100` | F-08 v1, ASSUMED |

Lookup table behind the two fill factors, `injectionTimeAdjustmentFactors` (the first row whose Number is at least the value is used; the last row covers the rest):

| Attribute | Number (up to) | Adjustment factor |
|---|---|---|
| Cavities Per Mold | 3 | 1 |
| Cavities Per Mold | 5 | 1.02 |
| Cavities Per Mold | 8 | 1.05 |
| Cavities Per Mold | 999999 | 1.1 |
| Gates Per Cavity | 1 | 0.6 |
| Gates Per Cavity | 2 | 0.4 |
| Gates Per Cavity | 3 | 0.3 |
| Gates Per Cavity | 4 | 0.25 |
| Gates Per Cavity | 999999 | 0.25 |

## Compression Molding

Calculator **Compression Molding - Cycle Time**, mapped to the catalog operation `Compression Molding` (4 fields).

Compression cycle = press open/close time (the staged press_cycle_time_s: platen close + open motion) + the material's cure time. Not modelled, because the reference holds no formula: charging, preheat, flash trimming and part handling. The cycle is understated by those until validated formulas are supplied; a grade with no cure time on file contributes none (said in the trace).

### Feature lookup table

| Feature type | Operations the reference lists for Compression Molding | Enters the cycle time |
|---|---|---|
| CurvedSurface | As Molded | No |
| CurvedWall | As Molded | No |
| MultiStepHole | As Molded | No |
| PartingLine | Manual Flash Trimming | No |
| PlanarFace | As Molded | No |
| Rib | As Molded | No |
| SharpEdge | As Molded | No |
| SimpleHole | As Molded | No |
| Void | As Molded | No |

### How the cycle time is calculated

| # | Field | Unit | Input, or formula | Registry |
|---|---|---|---|---|
| 1 | Press Open/Close Time | s | Machine record: press_cycle_time_s (the machine's platen close + open motion time) |  |
| 2 | Material Cure Time | min | Material reference: cureTimeMin (raw_materials.cure_time_min; absent for a grade with none on file: seeded 0 and said in the trace, the cycle is then understated) |  |
| 3 | Cure Time | s | `{Material Cure Time} * 60` |  |
| 4 | Cycle Time | s | `{Press Open/Close Time} + {Cure Time}` |  |

## Reaction Injection Molding

Calculator **Reaction Injection Molding - Cycle Time**, mapped to the catalog operation `Reaction Injection Molding` (9 fields).

RIM cycle = machine dry cycle + fill + cure. Dry cycle = the machine's mold open/close with no material (staged as press_cycle_time_s). Fill Time = Total Shot Volume / Machine Injection Rate (formula registry F-19, ASSUMED: the staged rate over the shot volume is the approved simplification; the reference states no RIM fill formula), with Total Shot Volume = Part Volume x Cavities per Mold in mm3 and the rate in mm3/s, so the result is in seconds. Cure Time = the material's cure or reaction time. Cycle Time = (Dry cycle + Fill + Cure) / Cavities per Mold, per part; the RIM engine prices one part per press cycle (1 cavity). Not modelled, because the reference has no volume or formula: runner and sprue volume, mix-head purge, viscosity, flow resistance, the injection profile, and part handling. A missing or invalid part volume or injection rate makes the cycle a named gap, never a default.

### Feature lookup table

| Feature type | Operations the reference lists for Reaction Injection Molding | Enters the cycle time |
|---|---|---|
| ComboVoid | As Molded, ComboVoidLifter, ComboVoidNoCore, ComboVoidSideCore, ComboVoidUnscrewMandrel | No |
| CurvedSurface | As Molded | No |
| CurvedWall | As Molded | No |
| LifterBundle | Lifters | No: the slide and lifter cycle is not modelled (G-03) |
| MultiStepHole | As Molded, MstepLifter, MstepNoCore, MstepSideCore, MstepUnscrewMandrel | No |
| PlanarFace | As Molded | No |
| Rib | As Molded | No |
| SharpEdge | As Molded | No |
| SimpleHole | As Molded, HoleLifter, HoleNoCore, HoleSideCore, HoleUnscrewMandrel | No |
| SlideBundle | Slides | No: the slide and lifter cycle is not modelled (G-03) |
| Void | As Molded, VoidLifter, VoidNoCore, VoidSideCore | No |

### How the cycle time is calculated

| # | Field | Unit | Input, or formula | Registry |
|---|---|---|---|---|
| 1 | Machine Dry Cycle Time | s | Machine record: press_cycle_time_s (time.dryCycleTimeS: mold open/close, no material) |  |
| 2 | Part Volume | mm³ | CAD: volume (net part volume, mm3) |  |
| 3 | Cavities per Mold |  | Cost engine: the RIM engine prices one part per press cycle: 1 |  |
| 4 | Machine Injection Rate | mm³/s | Machine record: rates.injectionRateMm3PerS |  |
| 5 | Material Cure Time | min | Material reference: cureTimeMin (raw_materials.cure_time_min; absent for a grade with none on file: seeded 0 and said in the trace, the cycle is then understated) |  |
| 6 | Total Shot Volume | mm³ | `{Part Volume} * {Cavities per Mold}` |  |
| 7 | Fill Time | s | `{Total Shot Volume} / {Machine Injection Rate}` | F-19 v1, ASSUMED |
| 8 | Cure Time | s | `{Material Cure Time} * 60` |  |
| 9 | Cycle Time | s | `({Machine Dry Cycle Time} + {Fill Time} + {Cure Time}) / {Cavities per Mold}` |  |

## Not modelled (registry entries marked UNSUPPORTED)

| Id | Item | Staged in memory/ | State |
|---|---|---|---|
| G-01 | Mold base selection and plate-by-plate steel | tblStandardMoldBaseSizes; tool material price and density (AISI P20 1.86 USD/kg, 7850 kg/m3); plate thickness variables; tblCavity/CorePlateDepthBorder; tblEdgeMoldBorderX/Y | UNSUPPORTED |
| G-02 | Core and cavity blocks | plate depth tables; cmToolMachiningRates; EDM rates; tblHrsPerSqInch* | UNSUPPORTED |
| G-03 | Slides and lifters | tblSlideSizes; slide* and lifter* variables; costPerHydraulicEjector; slideCycleRate | UNSUPPORTED |
| G-04 | EDM and heat treatment | edmRateUsdPerHr; EDM material per in3; heatTreatRateUsdPerKg; stressReliefRateUsdPerKg | UNSUPPORTED |
| G-05 | Mold texture | cavityTextures; cmToolTexture; toolBlastingRate; toolChemicalEtchingRate; toolMaskingRate; toolDryingTime | UNSUPPORTED |
| G-06 | Cooling and water lines | tblStandardWaterLineSizes; defaultWaterLineDiameter; water* cost variables | UNSUPPORTED |
| G-07 | Inserts and unscrewing mechanisms | insertInstallRate; cmInsertManualLoadingTime; defaultInsertCost; costPerUnscrewingMechanism; tblSpiType.Use Insert | UNSUPPORTED |
| G-08 | Tool assembly extras: ejector system, sprue, locating ring, hot drops, try-out | ejector*, sprueBushingCost, locatingRingsCost, costPerStandardHotDrop, tryoutRateUsdPerHr | UNSUPPORTED |
| G-09 | Handling, setup scrap and plasticizing in the cycle | partHandlingTimes; materialHandling; scrapTimeInMinutes_*; plasticizingRateByClampForce; machine plasticizingRateGppsGPerS | UNSUPPORTED |
| G-10 | Period costs: indirect overhead, SG&A, margin | sGandARate; markUpRate; machine indirect overhead | UNSUPPORTED |
| G-11 | Material drying, visual inspection, ultrasonic welding, cure oven, LSR dosing | nothing staged | UNSUPPORTED |
