# Plastic Modeling: investigations I-1 to I-4

Companion to `README.md` (audit and specification, #235). **No costing formula is introduced or changed here.** The evidence is reproducible: the figures in I-1 and I-2 are pinned by `characterization:` tests in `plastic-molding-accuracy.spec.ts` (they describe what the model does today; changing them is changing the cost model and needs formula approval), and the tables quoted are in `memory/Plastic Modeling/`.

Method for I-1 and I-2: `computeInjectionMoldedCostSummary` on the repo's ABS test part (projected area 10,000 mm2, 100,000 parts a year for 3 years, USA toolroom rates), one input varied at a time.

---

## I-1 Cavity count and the mold cost (defect D-3)

**Claim in the code** (`mold-tooling-engine.ts`, header): a "+35 % of base cost per additional cavity" heuristic "is retained". **Finding: no such scaling exists in the code.**

| Cavities | Purchased components | Design h | Machining h | Assembly h | Molds bought | Mold cost (all molds) | Cost of one mold |
|---|---|---|---|---|---|---|---|
| 1 | $2,140 | 3.24 | 4.063 | 23.18 | 3 | $13,616 | $4,538.67 |
| 2 | $2,140 | 3.24 | 4.125 | 23.18 | 2 | $9,090 | $4,544.95 |
| 4 | $2,140 | 3.24 | 4.250 | 23.18 | 1 | $4,558 | $4,557.52 |
| 8 | $2,140 | 3.48 | 4.500 | 23.18 | 1 | $4,598 | $4,598.19 |

- The component list, the assembly hours and the design hours do not depend on the cavity count. Machining hours move only through the plate-area term (area = projected area x cavities), which is 1.3 % between 1 and 8 cavities.
- Because the number of molds bought falls with cavities (each cavity makes fewer shots), the **quoted tooling falls from $13,616 to $4,558** when the cavity count goes from 1 to 4. The mold is not cheaper; fewer molds are bought.
- A real 4- or 8-cavity tool needs more cavity and core blocks, more runner, more gates, more cooling and more ejection, and costs far more than a single-cavity tool.
- Source data available for a rule: `layoutNumCav`, `tblRunnerCalculationCoefficients`, `cmToolMachiningRates` (cavity/core general machining per m2), `tblStandardMoldBaseSizes`. **No formula in `memory/` states how mold cost scales with cavities.**

**Conclusion:** the multi-cavity tooling cost is understated and the quote favours more cavities for the wrong reason. Status: **UNSUPPORTED** (G-02 core and cavity). **Do not invent the "+35 %".** Decision requested: a specification or reference quote for a multi-cavity mold; until then the quote should carry an explicit gap for any cavity count above 1 (a data-gap warning, no number change) once approved.

## I-2 SPI mold class and tool life (defects D-4 and new D-9)

`tblSpiType` (source): class, "Num Annual Mold Cycles", and a column `Use Insert`:

| Class | Num Annual Mold Cycles | Use Insert |
|---|---|---|
| 101 | 9,999,999,999 | true |
| 102 | 1,000,000 | true |
| 103 | 500,000 | false |
| 104 | 100,000 | false |
| 105 | 5,000 | false |

Findings:
1. **The class is computed and shown, but the cost of a mold does not depend on it.** Class 105, 103 and 101 molds cost the same each ($4,538.67 in every case; 4,538.66 for Class 101). Pinned by test.
2. **`Use Insert` is not read.** The source ties the two highest classes to insert-based mold construction (the `cm*` insert machining and design variables exist: `cmDesignHrsRibInsert*`, `Insert Pocket Machining`), which would be a cost driver; the model ignores it.
3. **New (D-9): how many molds are bought comes from `tblToolLife` (shots per tool by resin: ABS 144,000), not from the class rating.** A Class 101 mold, rated 9,999,999,999 cycles, is bought `ceil(10,000,000 / 144,000) = 70` times for a 2 million a year, 5 year program (mold cost $317,707). The class rating (a life) and `tblToolLife` (also a life) describe the same thing two ways, and the engine uses the one that gives the larger tooling figure at high volume. Which one governs, and whether "tool" in `tblToolLife` means the whole mold, its cavity inserts or its tool steel, is not stated in `memory/`.
4. Undercuts raise the class (6 undercuts and parting complexity 0.9: Class 102) and add the staged slide hardware (4 hydraulic cylinders x $350 + 4 side locks x $160 = $2,040). Nothing else about the class is priced.

**Conclusion:** the class is informational today. Status: **ASSUMED** (class selection rule) and **UNSUPPORTED** (class-dependent build cost). Decisions requested: (a) what `tblToolLife` counts, (b) whether a class should change build cost (insert construction), (c) whether high-volume quotes should buy 70 molds or one durable one. High-volume tooling in a quote is potentially overstated by a large factor until (c) is answered; this is the largest unquantified pricing risk found in tooling.

## I-3 Are the compression-molding reference tables applicable to injection molds? (defect D-8)

**What the injection engine reads:** `cmStandardToolingComponents` (purchased components), `cmToolAssemblyTimes`, `cmToolAssemblyNumOperators`, `cmMoldBaseDesignHours`, `cmToolMachiningRates`, `cmToolMachiningSetups`. The prefix is `cm` and 71 variables say "Used in the Compression Molding process routing".

Evidence the component table was written for a **compression** mold:

| Evidence | Detail |
|---|---|
| `Air Poppet` x 30 at $25 = **$750** in the base BOM | Variable `cmEjectionMethod = Air Poppets`: "Default method for compression molding part ejection. Available options are Air Poppets or Hydraulic Ejector Pins." Injection molds eject with ejector pins and an ejector plate. |
| `cmToolAssemblyTimes` includes `Heater Lines` and `Thermocouples` | Heated (compression/thermoset) tooling. Injection molds are cooled with water lines. |
| The table has **no** sprue bushing, locating ring, cooling or runner component | Staged but outside the table: `sprueBushingCost` $70, `locatingRingsCost` $85, `waterBafflesCost` $8, `waterHosesCost` $1.25, `waterManifoldFittingsCost` $2.50, `waterManifoldsCost` $55, `costPerStandardHotDrop` $3,750, `costPerSVGHotDrop` $6,000. Their variables carry no process scope and read like injection hardware ("Runner region for molds with a Runner system/cold runner"). |
| Previous engineers already declined to reuse the compression `cm*Allowance` variables | `mold-tooling-engine.ts` header: "explicitly scoped ... to the Compression Molding process routing". The component and hours tables were reused without the same check. |

Evidence for **generic** applicability:
- `Ejector Guide Pin Bushing`, `Guide Pin`, `Guide Bush`, `Return Pin And Shoulder Bushing`, `Ejector Pin` and the plate machining rates (`Cavity Core Plate General Machining`, EDM, drilling) are ordinary mold-making operations.
- The tables sit in the shared `lookupTables/Component/` folder, and `tblSpiType`, `tblToolLife` (no prefix, shared) are used by both.

**Size of the exposure on the Back cover mold** (BOM subtotal $4,180 = $2,140 base + $2,040 slide hardware): the one component explicitly named as a compression ejection method, Air Poppet, is **$750 = 35 % of the base BOM, 18 % of the subtotal**. Whether limit switches ($200) belong to an injection mold is not established either way. The mold cost is $9,809, so the exposure on this part is about $750 of purchased components plus the assembly hours of those parts (30 x 0.006 h).

**Conclusion (not proven either way, evidence leans to partial misattribution):** the machining, plate and hours tables are generic mold-making data; the **component BOM is a compression-mold BOM** and is missing the injection-specific hardware that the variables list. Status: **ASSUMED** (applicability). Decision requested: an injection mold BOM from the reference (sprue bushing, locating ring, water components, ejector plate, hot drops when the runner is hot) or expert confirmation that the compression BOM is intended. Until then nothing is changed; the existing warning already states the cost is partial.

## I-4 Variables whose meaning is not established (no change)

| Variable | Staged value and note | Read by the engine | Status |
|---|---|---|---|
| `injectionRateMultiplier` | `.25` "Multiplier used to downgrade the machine injection rate" | No | Unchanged. Could mean rate x 0.25 or rate x (1 - 0.25); fill time would change by a factor of 4 or 1.33 depending on the reading. Needs the intended formula. |
| `overheadMultiplier` (machine column) | Source `0.0` on injection and foam presses; staged `1.000` | No | Unchanged. The machine hour rate already equals direct + indirect overhead (8.19 + 14.50 = 22.69 on the KM80), so the multiplier is not needed to reproduce it; its role is unknown. Staged value disagrees with the source (D-2). |
| `plasticizingRateGppsGPerS`, `ejectorPercentMaxMachineVelocity`, `numEjectorCycles` | Staged | No | Cycle components the model lists as "not modelled" (ejector travel, plasticizing). Need formulas. |

## Register updates

| ID | Update |
|---|---|
| D-3 | Evidence in I-1. Status UNSUPPORTED; stale comment to be removed when the rule is decided. |
| D-4 | Evidence in I-2; plus `Use Insert` unread. |
| D-8 | Evidence in I-3; leans to partial misattribution (component BOM). |
| **D-9 (new)** | Molds bought from `tblToolLife` regardless of class rating: 70 molds for a Class 101 program. Largest unquantified tooling risk. |
