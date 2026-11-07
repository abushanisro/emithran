# Secondary operations: what is costed, what is not applicable, and what data is still missing

Audit of every operation of the Cost Guide's Secondary operations list that read "not costed", against `memory/` (Heat treatment, SurfaceTreatment, Secondary process, Countries data) and against the code that reads it. Checked on the real Back cover (nylon) with `GET /bom-items/:id/secondary-processes`. A cost is shown only where the reference defines its time or price; a missing value is a named gap, never an estimate.

## Before and after (the Back cover, nylon, USA, batch 250)

| | costed | not applicable | gap |
|---|---|---|---|
| Heat treatment (22) | 14 to 15 | 0 to 2 | 8 to 5 |
| Surface treatment (33) | 18 to 18 | 1 to 2 | 14 to 13 |
| Other secondary (12) | 10 to 11 | 0 to 1 | 2 to 0 |

## What was wrong in our code (data was there)

1. **The material type was never passed.** The reference tables (aging time, HIP hold temperature, conversion coating, laser engraving) are keyed by material TYPE (Steel, Aluminum, Nylon); the service passed the material GROUP (Ferrous & Non-Ferrous, Plastic & Rubber), which is a row of none of them, so every such lookup was a gap for every material. It now passes the type.
2. **Age ignored the reference's fallback.** `heat_treatment_variables.csv` defines `defaultAgingTime = 7 hr` ("default aging time if Material Type does not exist in tblMaterialAgingTime"). It is now used, and the trace says it is the default. Age on the Back cover: 2.78 USD per part (one Virtual Oven - Large load, 7 hr).
3. **The CMM read the wrong feature list for a molded part.** Its probe-touch table (Planar Face 4, Curved Wall 3, Curved Surface 6, Simple Hole 4, Pocket 9) uses the plastic feature vocabulary, but the service gave it `feature_graph_v2`, which for a molded part holds only the draft finding. It now reads the plastic feature graph, one feature per recognised face. The Back cover has 131 planar faces, 271 curved walls, 547 curved surfaces and 2 holes: 4,627 probe touches, 12.47 USD per part. That is what the staged table says for every face; inspecting only toleranced features would be far less, and the table gives no way to select them.
4. **88 of 318 plastic materials had no cut code** (the Back cover's grade among them), although `materials_final.csv` holds it (41.11 for this grade). Migration 978 writes the cut code of 70 materials from the reference, only where the row has none (37 rows already agreed with the reference; 1 differs and is left alone). With the cut code, Carburize, Carbonitride, Passivation and Magnetic Particle Testing answer from their tables: **not applicable** for nylon (cut code 41.11 is not carburizable, has no passivation treatment, and is not ferromagnetic), which is the truth and not a cost.

## Still not costed: the data that is not in `memory/`

These need a value the reference does not contain. The audit searched every file of the three folders and the country exports for each; no formula in the reference defines a substitute, so none is invented.

| Operation | What the engine needs | Where memory stands |
|---|---|---|
| Black Oxide | blackening immersion time | machine file has transfer time and bath sizes; variables have clean (300 s) and rinse (180 s) times, no immersion time |
| Conveyor Oven Cure, Oven Cure | cure time (and line speed) | oven files give dimensions and length only |
| Conveyor Powder Coating | line speed or spray time | flow rate 500 g/min and spray efficiency 0.8 exist for the cart; nothing for the conveyor booth |
| Powder Coat Cart | coating thickness, powder density, number of guns | flow rate and efficiency only |
| Vibratory Finishing | tumbling time | container and media data only |
| Shot Blast | how blast cycle time, hanger positions and the area and perimeter allowances combine | all the numbers exist (180 s cycle, 2 hangers, 0.0015 s/mm2, 0.0045 s/mm), the rule does not |
| Degrease | the conveyor pitch rule of the washer | speed limit 76 mm/s, spacing factor 0.5 and the spacing variables exist; the formula is stated for no washer |
| Conveyor Conversion Coating | a machine file (stage count and stage length) | economics rows exist in `Countries data/*_XML_Data_.csv` (no USA file) with the stage count only in the name |
| Induction Harden, Stainless Steel Harden, Stress Relief, Vacuum Air Harden with High Temper | a machine or service with a price per kg and a minimum batch cost | listed as processes, with machine economics in `Countries data` (no per-kg price, no time, no USA row); the heat engine prices a service from its `Unit Weight Cost`, `Min Batch Cost` and `Min Batch Weight`, which these four have nowhere |
| Hot Isostatic Pressing | a hold temperature for the material type | `tblMaterialTypeProperties.csv` has 28 types, each with a temperature; Nylon is not one, and no default temperature exists (only a default hold time) |

## Still not costed: the drawing has to say

Anodize (the anodizing type), Mask-Bench, Mask-Spray, Screen Printing (what is masked, the printed area). These are requirements of the drawing, not CAD facts; they cost as soon as the callout is entered.

## To make the rest cost

Each row above names the value to add. They are values the reference tool holds and the exports in `memory/` do not carry (the export has the machine files, not these process times). Supplying them as staged reference data (a variable or a lookup row with its unit) lets the engine cost the operation with no code guess: the engines already have the structure for each.
