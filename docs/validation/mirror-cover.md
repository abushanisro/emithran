# Validation against an independent reference: the Mirror Cover should-cost workbook

Reference: `Mirror Cover.xlsx` (RVMSA2CP1, PP + 20 % GF, injection molding, 2 cavities, 150,000 per year, rupees). The test is `backend/src/test/modules/bom-items/costing/plastic-molding/mirror-cover-validation.spec.ts` (15 tests). Part A recomputes the workbook from its own inputs and reproduces every figure it states (so the reference was read correctly). Part B replays the same part through our injection molding engine with the workbook's own inputs (material properties, temperatures, press rate, rates, lot size) and attributes every difference.

## Verdict

The engine's arithmetic and its formulas from `memory/` are correct: with identical inputs, the thermal diffusivity, the cooling time, the machine, labor and setup arithmetic and the fill relation agree with the workbook. The differences that remain are inputs the library does not hold, methods the two models do not share, and scope our model states it does not cover. The validation found **a defect of ours, now fixed** (line precision). The workbook itself has a typo.

## Step by step (per part, rupees; our run uses the workbook's inputs)

| Step | Workbook | Ours | Cause |
|---|---|---|---|
| Thermal diffusivity (mm²/s) | 0.2991 | 0.2991 | equal |
| Cooling time (s) | 2.47 | 1.6 | **workbook typo**: its cell divides by `2 x 3.142`, the cooling formula has `3.142 ^ 2`; corrected it is 1.57 s, and ours is 1.57 s to the 0.1 s the calculator rounds to |
| Fill / injection time (s) | 5.69 (weight / (130 kg/h x 75 %)) | 2.69 (volume / rate x staged fill factors 1.0 and 0.6) | method: ours is the staged formula |
| Pack / hold (s) | 5 fixed | 2 (staged minimum) | method |
| Slide 4 s, ejection 1 s, insert handling 5 s | 10 s | 0 | scope: slides and inserts are formulas G-03 and G-07, UNSUPPORTED; our result lists them as required and not costed |
| Press dry cycle (s) | 3 | 3 | equal |
| **Cycle time (s)** | **26.15** | **9.29** | the sum of the rows above: 38 % of the workbook's cycle is the fixed slide, ejection and insert times |
| Runner and sprue (g per shot) | 4 (sized from the tool: sprue 165 mm, runner 45 mm, 2 gates) | 12 (staged runner coefficients) | method: the workbook knows the tool, we do not |
| Material per part | 9.19 (scrap credited, yield charged on material and process) | 10.23 (shot / yield, no scrap credit) | method |
| Clamp tonnage | 86.4 t computed, 95 t recommended | 34.8 t with plain PP (easy flow, 12 %); **98.6 t with a medium-flow grade (34 %)** | input: PP + GF20 is not a grade of the library. A glass-filled grade is medium flow; with that class ours is within 4 % of the workbook's 95 t |
| Machine / labor / setup | 0.436 / 0.371 / 0.0355 | 0.16 / 0.14 / 0.04 | the same formulas applied to our shorter cycle (setup is equal: 0.0355) |
| Inspection | 0.096 (sampled QA inspector) | 0.22 (visual inspection of every part) | method: ours inspects every part visually; the first-article dimensional inspection is named as required and not costed |
| Overheads and profit | 1.32 (5 / 3 / 2 % and 8 %: 11 % of the part cost) | none | scope: formula G-10 is UNSUPPORTED (no authoritative formula in `memory/`) |
| Tooling | 13.06 lakh = about 20,200 USD | not costed | input: our mold model needs the toolroom rates of the factory, and none are on file for India (USA only); the result says so |
| **Part cost** | **11.84** | **10.57** (material 10.23 + process 0.34) | the rows above |

## Defect found in our module (fixed)

**Every line was rounded to 0.01 of the currency** (`r2` in `cost-injection-molding-engine.ts`: `makeLine`, `materialCost`, the totals) and the line's cycle to 0.01 minute (0.6 s). The database holds 6 decimals (`total_cost_per_part numeric(12,6)`), so the engine was where the precision went. On a cheap part a line was off by up to half a cent on its own (a Back-cover-sized labor line is 0.0311 and was 0.03), the parts of a line did not add up (0.30 + 0.07 shown as 0.36), and the calculator's 6.22 s cycle was saved as 6.0 s (the "saved Cycle Time is 6.0 s, click Use as Cycle Time" mismatch). Per-part money and the line's cycle now keep six decimals; `plastic-line-precision.spec.ts` pins it. Before and after, a Back-cover-sized part (USD): material 0.26 to 0.2559, setup 0.30 to 0.2966, run 0.07 to 0.0669, line 0.36 to 0.3635, cycle 0.11 min to 0.1082 min, total 0.62 to 0.6194; the Mirror Cover (rupees): line 0.34 to 0.3370, total 10.57 to 10.5686.

Not changed, a design choice to confirm: the stored `cycleTimeMin` of a line is the cycle per good part (`cycle / cavities / yield`), so with a yield under 100 % the saved cycle is longer than the calculator's by that factor.

## Findings outside the engine

- The applied material record of the Back cover carries the price of Aluminum AA 3105 (5.864 USD/kg) where `memory/` has 11.486 for its grade (see `docs/part-summary-audit.md`).
- The library has no PP + glass-filled grade (the workbook's material), so a glass-filled part is sized as a plain PP part: easy flow, a third of the clamp force.
- The workbook's cooling cell is a typo (above); its other figures reproduce from its formulas.

## Not validated here

The Mirror Cover has no CAD in the workbook, so geometry (volume, projected area, wall) is the workbook's own input and the CAD extraction was not part of this comparison.
