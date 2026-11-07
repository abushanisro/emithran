# Cost engine coverage: what `memory/` stages, what has an engine, and why operations show "not costed"

Status: **audit, no code or cost changed.** Evidence date 2026-11-07, `main` at the time of writing. Everything below is reproduced from the repo and a database built from the staged baseline plus every migration (through 974); the two CSVs next to this file hold the full tables.

## 1. Summary

* **30 process groups are staged** in `memory/`. **Engine code exists for 10** (sheet metal, machining, plastic molding, die casting, sand casting, heat treatment, surface treatment, other secondary, hydroforming, and PCB in its own module). **Three more** (Casting, Casting Investment, Stock Machining) share code with no process-specific engine. **17 have none** (additive, assemblies, composites, forging, powder metal, rapid prototyping, roto and blow molding, sheet plastic, roll / stretch / transfer-die forming, bar and tube, 2-mold, multi-spindle).
* **The secondary operations in the Cost Guide panel are mostly already costed by their engines.** Run on the real reference with a machined steel part: **44 of 67** operations cost (16 of 22 heat treatments, 18 of 33 surface treatments, 10 of 12 other secondary). The 23 that do not are not an engine gap: each says what is missing. For 13 of them **`memory/` does not contain it** (a formula input or a machine), 6 need an input only the drawing gives, 2 need a CAD fact, and 2 correctly do not apply (section 3).
* The panel in the report showed every heat treatment as "not costed". That is **not** what the engines return for a part with weight and material (above), so the live cause is in what reaches the engine for that part or location; it was not reproduced here (section 4).
* Two findings in the platform's own bookkeeping: the process ledger (`process_taxonomy.roadmap_status`) is **out of date** for heat treatment and sand casting (all `not_modeled`, engines exist), and the heat-treatment engine **costs heat treatments for a plastic part** (14 of 22) without checking that heat treatment applies to the material.

## 2. Domain coverage (`domains.csv`)

Columns: files staged in the memory folder; the ledger's status counts per process group; active calculator mappings; machines seeded for USA; the engine code found by reading `backend/src/modules/bom-items/costing`, `electronics-costing` and `sand-casting` (name search, plus reading what the matches are: the hits for additive, composite, forging, rapid and powder are incidental words in other engines, not engines).

| Engine code found | Domains |
|---|---|
| Yes | Sheet Metal, Machining, Plastic Molding, Die Casting, Sand Casting, Heat Treatment, Surface Treatment, Other Secondary (and chemical milling), Sheet Metal - Hydroforming; PCB (separate module `electronics-costing`, outside the process ledger) |
| Shared code, no process-specific engine | Casting, Casting Investment, Stock Machining (covered by the machining engine's stock pricing) |
| None found | Additive Manufacturing, Assembly, Assembly Molding, Assembly Plastic Molding, Part Assembly, Bar and Tube Fabrication, Composites, Forging, Powder Metal, Rapid Prototyping, Roto & Blow Molding, Sheet Plastic, Sheet Metal Roll Forming, Stretch Forming, Transfer Die, 2 Mold Molding, Multi-Spindle Machining |

All of the "none found" domains have staged data and seeded machines (for example Forging: 30 files, 202 machines; Bar and Tube: 52 files, 277 machines; Additive: 26 files, 102 machines), so the machine rates exist; what is missing is the cost model that uses them. Whether each folder also states the formulas (as the plastic folder states variables but not all formulas) has not been checked per domain: that is the next audit step.

## 3. Why operations are "not costed" (`secondary-operations.csv`)

The engines return one of `costed`, `gap` (with a reason) or `not_applicable`. Run on the real reference rows and the seeded USA machines (the same loading the service does), for a machined steel part with no drawing callouts:

| Cause | Count | Operations |
|---|---|---|
| Costed | 44 | 16 heat, 18 surface, 10 other secondary |
| The reference does not give a needed formula input | 8 | Black Oxide (blackening time), Conveyor Oven Cure (cure time, line speed), Oven Cure (cure time), Conveyor Powder Coating (line speed, spray time), Powder Coat Cart (thickness and spray rule), Degrease (washer pitch rule), Shot Blast (how cycle, hangers and allowances combine), Vibratory Finishing (tumbling time) |
| No machine in the reference for the process | 5 | Induction Harden, Stainless Steel Harden, Stress Relief, Vacuum Air Harden with High Temper, Conveyor Conversion Coating |
| An input only the drawing gives | 6 | Carburize and Carbonitride (case depth), Anodize (anodizing type), Mask-Bench and Mask-Spray (what is masked), Screen Printing (printed area) |
| A part or material fact missing | 2 | CMM Inspection (no feature has a probe-touch count), Hydrostatic Leak Testing (needs a measured wall thickness) |
| Not applicable to the material | 2 | Laser Engraving (the table lists plastics only), Passivation (stainless only) |

For the nylon part: the same, plus 4 heat treatments that need a material cut code or a plastic-specific row (Age, Carburize, Carbonitride, Hot Isostatic Pressing) and Magnetic Particle Testing (no cut code).

So of the 23 not costed on steel, **13 cannot be costed from `memory/`** (the formula input or the machine is not in it), **6 need an input from the drawing** that the UI could collect, **2 need a part fact** the CAD does not yet provide, and **2** are correctly not applicable. Costing the 13 needs the missing numbers or formulas from the reference owner; none of them should be invented.

## 4. The live panel: not reproduced

The report's panel shows all 22 heat treatments "not costed" while surface treatments show prices. In this audit's run the heat engine costs 14 to 16 of 22 for the two test parts. Possible reasons for the difference, **none verified**: the live part has no weight or volume (heat treatments price by weight), a location with no heat-treatment machines (they are seeded for USA only), or the part's material does not resolve. The service returns `dataWarnings` for the staged-data cases; the live response for that part will say which. This is the first thing to check, and it needs that part's request, not more engine work.

## 5. Findings

| ID | Finding | Evidence |
|---|---|---|
| E-1 | The process ledger is out of date: Heat Treatment (22) and Sand Casting (25) are all `not_modeled` although their engines run | `domains.csv` ledger columns vs the engines under `costing/heat` and `costing/casting/sand` |
| E-2 | The heat-treatment engine does not check that heat treatment applies to the material: a plastic part gets 14 of 22 costed | `secondary-operations.csv`, nylon columns |
| E-3 | 13 operations cannot be costed from the staged data (missing formula input or machine) | section 3 |
| E-4 | Six gaps are drawing inputs (case depth, anodize type, mask areas, printed area): the cost guide could ask for them instead of showing "not costed" | section 3 |
| E-5 | 17 staged process groups have machines and data but no cost engine | section 2 |

## 6. Proposed order (each its own PR from `main`, none changes an existing price)

1. Find why the live panel shows heat as not costed (needs that part's `dataWarnings`).
2. Show the reason on each "not costed" row (the engine already returns it), and collect the drawing inputs (E-4) in the Cost Guide.
3. Gate heat treatment (and other material-specific operations) on the material (E-2).
4. Update the ledger to what runs (E-1).
5. For the domains with no engine (E-5): per domain, check what the memory folder states (formulas vs only variables), then build in priority order, one domain per PR, with the validated / assumed / unsupported labels used for plastics. Where the folder lacks the formula, the operation stays unsupported until the reference owner supplies it.

## 7. Reproduce

Domains: `process_taxonomy`, `process_calculator_mappings` and `mhr_records` on a database loaded from the staged baseline with migrations 918 to 974 applied (`backend/scripts/baseline-load.sh`, then the migration files in order). Operations: the engines (`computeHeatTreatments`, `computeSurfaceTreatments`, `computeSecondaryProcesses`) run on the `machining_reference_data` and `mhr_records` rows for USA with the service's own row-to-machine mapping, for two parts (machined steel 120 x 60 x 20 mm, 1.13 kg, cut code 1.1; molded nylon 120 x 60 x 20 mm, 0.05 kg, no cut code).
