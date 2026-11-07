# Part Summary tab: audit of every field

The Part Summary tab (components/features/manufacturing-intelligence/PartSummaryTab.tsx) has six panels. Each is a projection of one backend result, `GET /bom-items/:id/part-summary` (costing/shared/part-summary.ts), which reads the applied cost table (the same read model as the Part Details view), the BOM item, and the scenario's resolved production inputs. Nothing is priced in it, so it cannot disagree with the Part Details view. A value the model does not hold is `null` with its reason in `notModelled`, shown as a dash with the reason on hover; never a zero, never an estimate.

| Panel | Field | Source | Status |
|---|---|---|---|
| Component | Finish Mass | cost table, part row `finishMassKg` | available |
| | Rough Mass | finish mass / utilization (both from the cost table) | derived; null if either is missing. The previous tab multiplied the finish mass by 2.5, 2.0, 1.5 or 1.1 by family: removed, those were invented |
| | Length, Width, Height, Surface Area, Volume | the BOM item (CAD) | available |
| Production | Digital Factory, Primary | the scenario's location | available |
| | Secondary, Toolshop | not recorded by the cost model | null, reason shown |
| | Annual Volume, Batch Size, Production Life | `resolveCostingInputs` (scenario, item column) | available |
| | Lifetime Volume | annual volume x production life | derived; null without an annual volume |
| Material | Material Catalog | library row `price_source` and `price_version` | available |
| | Material | library row name | available |
| | Stock | library row `stock_form` | available when the row has one (the Back cover's nylon row has none: N/A) |
| | Utilization, Unit Cost | cost table `utilizationPct`, `materialUnitCost` | available |
| Cost by Category | Material, Labor, Overhead, Setup, Investment, Other | cost table columns: `materialCost`, `laborCost`, `directOverhead`, `amortizedBatchSetup`, `tooling`, and logistics + procured + the part of the process cost that is neither labor nor machine | available; share of the sum, which is the piece part cost |
| Cost by Process | each process and its share | process rows: cycle cost + amortized setup, share of all the processes | available |
| Costs and Targets | Piece Part Cost, Total Capital Investments | cost table `pieceCost`, `capitalInvestment` | available |
| | Fully Burdened Cost | needs indirect overhead, SG&A and margin | **not modelled**: formula G-10 is UNSUPPORTED (no authoritative formula in `memory/`; the staged `sGandARate` and `markUpRate` exist but their use is not defined). A provisional model needs explicit approval |
| | Target Cost, variances | cost table `targetCost` | not modelled (the Ask Price is a quoted price, not a target cost; it is not used as one) |
| | Target Mass, variance | nothing on file | not modelled |
| Banner | "failed to cost" | cost objects with no cost (cost table status) and the "not costed" warnings of the cost summary | available |

## Finding from the audit (not changed here)

On the real Back cover the applied material record holds a unit cost of 5.864 USD/kg and the net mass (0.0266 kg), which gives 0.182 USD per part. The staged price of that grade in `memory/Plastic Modeling/materials_final.csv` is 11.486 USD/kg, and the live cost summary uses it with the gross mass (0.0287 kg): 0.33 USD per part. 5.864 is the library price of Aluminum AA 3105. Every view that reads the applied records (Part Details, Excel, this tab) shows the lower figure until the scenario is applied again. The cause (the Apply snapshot, or an earlier manual edit) is not established.
