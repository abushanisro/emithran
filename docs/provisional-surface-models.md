# Provisional surface-treatment models

Six Surface Treatment processes have machines in `memory/SurfaceTreatment/Machine` but no rule in `memory/` for the time per part. They are costed from the machines and variables on file plus one stated rule or published figure each. Every such line is flagged `provisional` (a "provisional" badge in the secondary-operations list; the reason, the cost trace and the warnings name the figure, its source and its published range). They are not reference data: replace the figure in `backend/src/modules/bom-items/costing/secondary/provisional-reference.ts` when the reference defines one. Migration 979 marks the six `production`.

| Process | Model | From memory/ | Provisional input |
|---|---|---|---|
| Oven Cure | one dwell per oven load; parts per load by the oven box and `powderCoatCartSpacingFactor` | oven dimensions, rates | cure dwell **15 min** (published 10-45 min) |
| Conveyor Oven Cure | line speed = oven length / dwell; cycle = conveyor pitch / speed | oven length, opening, pitch variables | cure dwell **15 min** (10-45 min) |
| Black Oxide | per bath load: clean + pre-rinse + immersion + post-rinse + supplementary finish + transfer × stages | the four stage times, 7 stages, transfer time, spacing 20 mm, bath size, weight limit | immersion **15 min** (5-60 min; sources conflict) |
| Vibratory Finishing | one cycle per container load; parts per load = volume × fill / (part volume × (1 + media ratio)), capped by weight limit | container volume, fill 95 %, media ratio 3, weight limit | cycle **45 min** (30-120 min; low confidence) |
| Shot Blast | blast cycle per hanger load (1 cycle on a hanger); parts per load = min(hanger positions, chamber fit, weight capacity) | blast cycle, hangers, chamber, capacity | the combination rule; the per-area and per-perimeter allowances are **not applied** |
| Powder Coat Cart | spray time = area × film thickness × specific gravity / transfer efficiency / gun flow rate, plus load and unload by weight (`powderCoatHandling`); booth and cart weight limit gate the part | efficiency 0.8, flow 500 g/min, area fraction 1, handling times | film **75 µm** (published 50-100) and powder specific gravity **1.5** (1.0-2.0) |
| Conveyor Powder Coating | the same spray time, no handling (the conveyor load/unload operations carry it), one gun | same | same |
| Degrease | cycle = conveyor pitch / washer speed limit | speed limit, window, weight limit, pitch variables | the washer's maximum speed is taken as its line speed |

Sources of the figures: Columbia Coatings TGIC polyester data sheets (10 min at 400 °F metal temperature) and Products Finishing "Oven Dwell Time" (dwell starts when the metal reaches temperature, so heavy parts need 30 min or more and are underestimated); Hubbard-Hall Black-Magic Infusion bulletins (5-20 min), Birchwood Technologies (30-60 min), STERC (15-30 min); equipment-supplier and STERC figures for vibratory deburring (30-60 min, up to 2 h for hardened steel).

## Known limits (stated on each line)
- Vibratory part volume is the bounding box (the CAD facts carry no solid volume): parts per load are understated for a compact part.
- Oven heat-up and cool-down are not in the reference and are not priced.
- Black oxide is a steel and cast-iron finish; the material is not checked yet (the material type reaches the secondary engine only after the cut-code PR, #279).

## Data gap that blocks Black Oxide today
Every row of `memory/SurfaceTreatment/Machine/black_oxide_machines.csv` has a blank `Labor Rate` and a blank `Wage Grade Name`. A machine without a labor rate is not costed (a blank is not zero), so Black Oxide shows "No black oxide machine with a complete rate is on file" until the file gives a labor rate or a wage grade. Nothing else is missing for it.

# Provisional heat services

`memory/Heat treatment/Machine` has a service row (Unit Weight Cost, Min Batch Cost, Min Batch Weight) for most heat services but none for four of them, although `processes.csv` names a default machine for each and `memory/Countries data` has a machine-economics row for each. Those four rows equal a sibling service's row (same footprint, same overhead rate), so they are priced from the sibling and flagged `provisional`:

| Process | Priced as | Note on the line |
|---|---|---|
| Stress Relief | the Standard Temper service | a stress relief holds near 620 °C for about 1 h per 25 mm of section plus the furnace cycle, longer than a temper: may understate |
| Stainless Steel Harden | the Vacuum Air Harden service | a martensitic stainless hardens near 1010 °C with a gas quench; its temper is separate and not included |
| Vacuum Air Harden with High Temper | the Vacuum Air Harden service plus the Vacuum Temper service | hardening then the high temper, each from its own row; the temper is billed as its own minimum batch |
| Induction Harden | timed per part: handling (tblHandlingTimes) + scan 6 s (published 4-8 s) on the Vacuum Air Harden economics row; no weight charge | case depth and coil tooling are not priced |

Open: the metal heat services still price a polymer part (Age uses `defaultAgingTime`). Whether they should be "not applicable" for a plastic is an engineer's decision; the secondary engine needs the material type (#279) to make it.

Powder figures: general industrial film 2-4 mil (50-100 µm) per Powder Coated Tough, Products Finishing and UnionFab guides; specific gravity 1.0-2.0 with 1.5 in the worked coverage examples (a supplier data sheet gives the real value for a chosen powder). Top coat only; the powder price per kg and the clear coat are not priced.

## Rules for what the drawing does not state (all provisional)
| Operation | Rule |
|---|---|
| Anodize | no type on the drawing: Type II is assumed (the reference runs one line per type and defines no default) |
| Screen Printing | printed region = the part's largest face; application cost × size multiplier (`screenPrintSizeMult`) × color factor; the complexity multiplier is not applied |
| Mask-Bench | one plug per detected CAD hole at the bench plug time; a part with no hole is not applicable |
| Black Oxide | its labor rate is the "2 - Metal" wage grade's (migration 981; `surface_treatment_wage_grades.csv` puts Black Oxide on that grade and every other machine of the grade carries 29.95 in the USA) |
| CMM Inspection | a part whose feature list holds only DFM findings (a molded or cast part) measures its CAD-counted holes (`summary.holeCount`) as the table's Simple Hole, 4 touches each; faces and other features are not measured |
| Mask-Spray | masked area = the bores of the CAD-counted holes (π × diameter × wall thickness); time = area × maskant layers / booth spray rate, programming once per batch; tack time and maskant material not priced |
| Age, Hot Isostatic Pressing | not applicable to a plastic or rubber part (metal heat treatments) |

## Still not costed
| Operation | Why |
|---|---|
| Conveyor Conversion Coating | `memory/SurfaceTreatment` has no machine file; `Countries data` has economics rows only for other countries, with machine length 0 and no line length to derive a speed from |
