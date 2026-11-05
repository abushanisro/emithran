# eMithran Forging Costing: HLD / LLD v1.1

| Field | Value |
|---|---|
| Version | 1.1 |
| Date | 2026-11-04 |
| Status | **Draft proposal** (not an engineering standard until the Open decisions in section 11 are closed) |
| Supersedes | `FORGING_MODULE_HLD_LLD_ARCHITECTURE.md` v1.0 (kept unchanged for history) |
| Inputs | v1.0 draft, `FORGING_MODULE_REVIEW_FEEDBACK.md`, the repository as of commit `bb4cfd7b` |

How to read this document
- Every claim about the repo cites the file and line, or the migration, where it was checked.
- Every number is either **staged** (it exists in the repo's reference data, cited by key), **user input**, or marked **NEEDS SOURCE**. Nothing is a silent default.
- "823" means migration `823_stage_memory_domains_part1..9of9.sql`, which stages the `2026-Forging` reference set into `machining_reference_data`. Variable and lookup names below are the staged keys verbatim.

---

## 1. Summary of what changed from v1.0

1. **Scope is closed-die hot forging only.** The other five processes are in section 13, "Later phases".
2. **The repo already holds most of the data.** v1.0 invented a flow-stress table, a wage table, flash ratios, die lives and a machine table. The repo already has:
   - **823:** 115 forging variables, 15 lookup tables, 13 processes and 13 wage-grade assignments (`machining_reference_data`, `source_version = '2026-Forging'`).
   - **824:** 202 forging machines in `mhr_records`, each with MHR, labour rate, crew, setup time and capability specs (press force, hammer energy, table size).
   - **855 (part 3):** 105 forging materials in `raw_materials` (`material_group = 'Forging'`), plus `raw_material_properties`: forging temperature, strength coefficient C, strain-rate sensitivity m, shear strength and scrap cost percent.

   v1.1 uses these. No new machine or lookup table is proposed.
3. **What the repo does not hold is most of the formulas.** 823 stages coefficients and their descriptions, but not the equations that use them. Section 6 marks each formula as *sourced*, *candidate (verify)* or *NEEDS SOURCE*. This is the main blocker for Phase 1 (Open decision D1).

---

## 2. Scope

### 2.1 In scope for v1: closed-die (impression) hot forging

The route is assembled from the staged process list (823 `process` rows; 790 `process_taxonomy` rows 1300–1311):

| Step | Staged process | Machine class (824) | Default machine (823) |
|---|---|---|---|
| Stock | Material Stock | `forging_material_stock` | Default Material Stock |
| Cut-off | Band Saw | `forging_band_saw` (15) | BLIN HDS-J150 |
| Heat | Conveyor Induction Heat **or** Preheat (furnace) | `forging_conveyor_induction_heat` (6) / `forging_oven_furnace` (9) | Conveyor Induction Heater - 1 Module / H.K. Furnace RT4-105-12 |
| Forge (upset, block, finish hits) | Press **or** Mechanical Press **or** Hammer | `forging_press` (37) / `forging_mechanical_press` (13) / `forging_hammer` (40) | Lasco KFP 1000 / Schuler PK1250 / Chambersburg - 20,000 lb |
| Trim (and pierce) | Trim | `forging_trim` (37) | Lasco KFP 1000 |
| Reheat (only if a second heat is needed) | Reheat | `forging_oven_furnace` | H.K. Furnace RT4-105-12 |
| After forging | Heat treatment, shot blast, machining | existing engines, section 6.10 | — |

### 2.2 Out of scope for v1

Open-die, ring rolling, cold heading, warm forging and horizontal upsetting are deferred to section 13. Open Die Press and Ring Rolling are staged (823, 824), so they are the natural next processes.

---

## 3. Architecture, aligned to the repo

### 3.1 Layering

The layering follows `docs/ENGINEERING.md` (platform architecture mandate): CAD → feature extraction → canonical feature model → capability/decision → routing → process engine → machine matching → cost → versioned result → API → UI.

### 3.2 Components and repo precedent

| Concern | v1.1 design | Repo precedent (checked) |
|---|---|---|
| Pure engine | `backend/src/modules/bom-items/costing/forging/`. No DB or network I/O in engine files. | `costing/casting/hpdc-engine.ts` header lines 1–43 ("Pure."). |
| Data loading | A `forging-reference.service.ts` loads `machining_reference_data` (`source_version` from `memory-reference-domains.json`), materials and machines **before** calling the engine. | `casting-reference.service.ts`. The loads and the hand-off are in `bom-items.service.ts` (`computeHpdc`/`computeGdc` at :3960–3971). The forging domain entry is already in `src/modules/processes/memory-reference-domains.json:61-66` (`sourceVersion "2026-Forging"`, `stagedBy "823"`). |
| Missing input | A line that lacks an input is not costed. It carries a `PhysicsGap` naming the input. | `dto/cost-breakdown.dto.ts:169` `LookupGap`, `:188` `UnsupportedOperationGap`, `:195` `PhysicsGap`, `:431` `ProcessLineCost.physicsGap`. `hpdc-engine.ts:241-254` `gapLine()`; `SeedSet.missing` at `:159-185`. |
| Line cost composition | `eMithranTerms()`: machine, setup, labour, inspection and yield terms. | `costing/shared/core/engine-kernel.ts:61` (`EMithranTermsArgs`), `:99` (`eMithranTerms`). It has **no** overhead or profit term. |
| SG&A and profit | Not in the engine. Applied at roll-up from `costing_settings` `sga_pct` / `profit_pct`. A missing key is a pricing gap, not a default. | `src/modules/costing/cost-aggregation.service.ts:390-393`. |
| Machine choice | Every capable machine is priced with its own rates and cycle; the cheapest per part wins. The choice is recorded as `MachineChoiceDto`. | `casting/hpdc-machine.ts:44-82`, `hpdc-engine.ts:316-342`, `casting/machine-choice.ts`. |
| Result shape | `ProcessLineCost[]` inside `CostSummaryDto`. **No new result DTO.** A forging detail block, if needed, follows `dieCasting` / `dieTooling` on `CostSummaryDto`. | `dto/cost-breakdown.dto.ts:293-453`, `:464-`. |
| Registry | **Open decision D3.** Casting engines are not in `MANUFACTURING_PROCESS_REGISTRY` today; they are called directly. | `manufacturing-process-registry.ts:65`; casting call at `bom-items.service.ts:3960-3971`. |
| Tooling amortisation | Die sets from tool life: the same structure as the casting "Die Life" calculator. | `casting/calculators/die-casting-calculators.json:1705-1707` (`Dies Required = max(1, ceil(Lifetime Parts / Cavities / Shots per Die))`). |

### 3.3 Stack facts (v1.0 claims corrected)

| v1.0 claim | Repo fact | Where checked |
|---|---|---|
| Next.js 14 | Next.js 16.4.3, React 19 | root `package.json:60` |
| Redis/Postgres job queue | Postgres only: `cad_uploads` table, `claim_next_cad_upload()` with `FOR UPDATE SKIP LOCKED`; generic `job_queue` | `backend/migrations/917_cad_uploads.sql`, `920_job_queue.sql` |
| pgTAP tests | No pgTAP. `npm run test:sql` runs plain `*.test.sql` against a throwaway Postgres. | `backend/test/sql/run.sh` |
| `components/bom/forging-intel/` | BOM components live in `components/features/bom/` | repo tree |
| Python 3.10 | Python 3.11, pythonocc-core 7.7.2 | `cad-engine/Dockerfile:19`, `docs/CAD_ENGINE_OCC_BINDING_STANDARDS.md` |
| `backend/src/database/migrations/950_…` | `backend/migrations/`; 950–954 are taken; next free number is 955 | `ls backend/migrations` |
| `auth.current_organization_id()` | Does not exist. The RLS helper is `public.current_user_org_ids()`. | `backend/migrations/541_current_user_org_ids_function.sql:20`; policy shape in `544_org_scoped_rls_mhr_boms_bom_items.sql:49-86` |

---

## 4. Data model

### 4.1 Reuse; no new tables in v1

| Data | Table | Seeded by | Notes |
|---|---|---|---|
| Forging variables and lookups | `machining_reference_data` (`category` `variable` / `lookup_table`, `source_version '2026-Forging'`) | 823 | 115 variables (10 deprecated, section 4.4) and 15 lookups (section 4.3) |
| Process and wage grade per process | `machining_reference_data` (`process`, `wage_grade`) | 823 | Press and Trim are grade 3; Hammer, Mechanical Press, Induction, Preheat and Reheat are grade 4; Band Saw is grade 2 |
| Machines | `mhr_records` (`process_group 'Forging'`, location USA, `source_type BENCHMARK`) | 824 | 202 rows. Capability is in `specs` JSONB (section 4.2). |
| Materials | `raw_materials` (`material_group 'Forging'`) + `raw_material_properties` | 855 part 3 | 105 materials |
| Process taxonomy | `process_taxonomy` (12 forging rows, `not_modeled`) | 790, `machine_class` set by 824 | **No** `process_taxonomy_operations` rows for forging (790:21) |
| Labour rates per location | `lhr_records` (fields per `src/modules/lhr/lhr.service.ts:60-95`: `wage_grade`, `labour_code`, `labour_type`, `location`, `process_group`, `currency`, `usd_lhr_base/burden/total`, `lhr_usd_effective`, shifts and hours). No `skill_level` column; skill benchmarks are in `lhr_wage_benchmarks` (migration 417). | baseline (its `CREATE TABLE` predates migration 917) | **Reused, not duplicated.** v1 takes the labour rate from the machine row (824 `usd_labor_rate_per_hr`, which follows each machine's staged wage grade), the same as casting. `lhr_records` is where non-USA forging labour rates belong, keyed by `process_group 'Forging'` and `wage_grade` (`2/3/4 - Metal`), once a sourced rate exists (Data needed). `lhr_records` is not in `REFERENCE_DATA.json`. |

v1.0's `forging_machines` and `forging_lookup_tables` tables are **dropped**. Everything they held is either in the tables above or unsourced.

v1.0's six-region wage table (section 8.2) is **deleted**. It had no source. Labour comes from the machine row (section 6.8). Regional rates follow the platform's location handling (`mhr_records.location`). Only USA forging rows exist today; other regions are listed under Data needed.

### 4.2 Machine capability on file (824 `specs`)

| Class | Crew (`operators`) | Setup (h) | Labour USD/h | Capability fields in `specs` |
|---|---|---|---|---|
| `forging_press` | 0.33 | 0.5 | 36.30 | `press_force_kn`, `cycle_time_s` (e.g. Lasco KFP 1000: 10,000 kN, 3.6 s, MHR 136.80) |
| `forging_mechanical_press` | 1 | 1.5 | 43.21 | `max_press_force_kn`, `max_stroke_rate`, `max_shut_height_mm`, `max_stroke_length_mm`, `press_table_length_mm` / `width_mm`, `bolster_plate_thickness_mm` (e.g. Schuler PK1250: 12,500 kN, 70 SPM, MHR 300.27) |
| `forging_hammer` | 2–3 | 0.25–0.75 | 43.21 | `impact_energy_j`, `cycle_time_s`, `load_plus_unload_time_s`, `unload_time_s`, `upsetting/blocking/finishing_handling_factor`, `table_length_mm` / `width_mm` (e.g. Chambersburg 20,000 lb: 339,768 J, MHR 288.39) |
| `forging_trim` | 0.33 | 0.5 | 36.30 | `press_force_kn`, `cycle_time_s` |
| `forging_band_saw` | 1 | 0.17 | 29.95 | `axial_feed_rate_mm_per_s`, `load_plus_unload_time_s`, `unload_time_s`, `max_stock_diameter/height/width_mm`, `max_cut_angle_deg` |
| `forging_conveyor_induction_heat` | 0 | 0 | 43.21 | `maximum_coil_diameter_mm`, `total_coil_length_mm` |
| `forging_oven_furnace` | 1 | 0.25 | 43.21 | `max_operating_temperature_c`, oven `length/width/height_mm` |

Source: `backend/migrations/824_seed_forging_mhr_records.sql` (generated from `memory/Forging/Machine/*.csv`, lines 4–7; rows from line 30). v1.0 said press tonnage existed only in machine names. That was wrong: it is in `specs`.

### 4.3 Staged lookup tables (823)

| Lookup | Columns | Used for |
|---|---|---|
| `forging_partComplexityBasedData` | Part Complexity 1–12 → Hot Forging Flash Percentage Volume; SPM (mechanical press with transfer, high volume) | flash volume, mechanical-press rate |
| `forging_materialTypeFactor` | Material Cut Code Family → Impact Energy Factor | hammer energy |
| `forging_inductionHeating` | Material Type → Heat Time Coefficient (s/mm²), Induction Coil Efficiency (%) | induction heat time and energy |
| `forging_materialHandling` | Weight (kg) → Load Time (s), Unload Time (s) | forge-press handling |
| `forging_bandSawHandling` | Weight (kg) → Load, Unload (s) | saw handling |
| `forging_bandSawCutting` | Cut Code Family, Material Width (mm) → Cutting Rate (mm²/min) | saw cut time |
| `forging_numberOperatorsPress` | Weight (kg) → Num Operators (≤22.73 kg: 1; ≤227.27 kg: 2; above: 3) | crew (see D6) |
| `forging_roundBarSizes`, `forging_squareBarSizes` | stock sizes (mm), 31 round bar sizes and 27 square | stock selection |
| `forging_tblToolCoating` | Coating → Tool Life Improvement Factor (None 1, Nitrided 1.9, PVD TiN 7.2, …) | die life |
| `forging_adviceRules`, `forging_manufacturabilitySeverity` | DFM rule enablement; thresholds by material and severity (Critical/Major/Minor) | DFM (section 7) |
| `forging_tblMandrelVelocity` | ring weight → mandrel velocity | ring rolling (later phase) |
| `forging_designGuidanceDisplayControls`, `forging_validationDisplayControls` | UI panel flags | UI only |

### 4.4 Deprecated variables: not used

`asForgedDiameterToDepthRatio`, `bottomDeadCenterAdjustmentFactor`, `defaultBilletRatio`, `minAsForgedDiameter`, `minSlugThickness`, `pierceDiaToDepthRatio`, `sumOfForceDistribution` and `upsetHeightFactor` are all marked `Deprecated: Yes` in their 823 raw row. The engine must not read them. v1.0's billet-ratio default came from one of these.

### 4.5 Where new data goes

`backend/migrations/REFERENCE_DATA.json` (`"noNewRowsAfter": 935`) and `src/common/migrations/reference-data.spec.ts` forbid any migration numbered above 935 from writing rows into reference tables or shared tables. That covers `machining_reference_data`, `mhr_records`, `raw_materials`, `raw_material_properties`, `process_taxonomy*` and `calculators`. Consequences:
- Forging values that are missing today **cannot be added by a seed migration**. They need the versioned reference-data package route (on-premises plan, step 5), which is not built yet. See D7.
- Schema changes (columns, indexes) are still allowed in migrations numbered 955 or higher.

### 4.6 Tenancy and RLS (for any schema change in Phase 2)

Use `public.current_user_org_ids()` and the 544 policy shape (read includes global rows; insert, update and delete are org- or user-scoped with `WITH CHECK`). Prove isolation with `npm run test:sql`. v1.0's `USING (true)` lookup policy is not used.

---

## 5. Inputs to the pure engine

| Input | Source | If missing |
|---|---|---|
| Net volume Vp (mm³), surface area | CAD (Phase 3), or manual entry (Phase 1) | gap |
| Projected area on the parting plane Ap (mm²), parting perimeter Lp (mm), footprint (mm × mm) | CAD: `cad-engine/shared/casting_geometry.py:118` `parting_plane_silhouette` (true mesh-projection union, not a bounding box) | gap |
| Part complexity score 1–12 | CAD classification (section 6.2), or manual entry | gap |
| Material | `raw_materials` + properties (855) | gap |
| Annual volume, production life (years), batch size | user / project | tooling not amortised, named (casting precedent `die-tooling.ts:510-513`) |
| Heating method (induction or furnace) | capability (section 6.5), or user | — |
| Die coating | user; `forging_tblToolCoating`, where "None" = 1 is a staged row | — |

---

## 6. Formulas

Legend: **S** = formula and inputs sourced. **C** = candidate formula; the coefficients are staged but the equation's form is inferred and must be verified. **N** = NEEDS SOURCE.

### Worked example used throughout

Steel, Hot Worked, AISI 1045 (855 part 3 line 26; 823 material row):

| Property | Value |
|---|---|
| Cut code | 1.2 |
| Material type | Steel |
| Density ρ | 7850 kg/m³ |
| Round-bar cost | 1.479 USD/kg |
| Scrap cost percent | 4 % |
| Forging temperature | 1148 °C |
| Strength coefficient C | 67.41 MPa |
| Strain-rate sensitivity m | 0.21 |

Part: Vp = 150,000 mm³; complexity score 6 (an assumed manual input for the example); round bar Ø44.45 mm (a staged size); induction heating.

### 6.1 Net weight [S]

W_net = Vp × 10⁻⁹ m³/mm³ × ρ

Example: 150,000 × 10⁻⁹ × 7850 = **1.1775 kg**.

### 6.2 Part complexity score [N for the algorithm; S for its bounds]

The staged lookups are keyed by a score from 1 to 12. The staged variables describe the classifier but not its scoring formula:
- 2D (axisymmetric) if the share of surface area about a turning axis ≥ `surfaceAreaThreshold2D` (0.95).
- 2.5D if ≥ `surfaceAreaThreshold2_5D` (0.75).
- Otherwise 3D, with the score between `min3DComplexityScore` (7) and `max3DComplexityScore` (12).
- Refinements from cross-section analysis: `radiusCoefficientOfVariationThreshold2D/2_5D` (0.25), `angleStandardDeviationThreshold2_5D` (11), `angleStdDevSeverityThreshold2_5D` (30), the line/plane deviation thresholds (0.33 / 0.12), and `partLongitudinalRatioThreshold` (2).

The mapping from these to a score of 1–6 for 2D/2.5D parts is **not staged**.

**Replaces** v1.0's S1–S4 classes and their Cs factor of 1.1–2.5. Those were attributed to DIN 7526, but the review notes the classes are probably DIN 7523 / EN 10243-1. Either way the factor values have no source. Decision D2.

Phase 1 takes the score as a manual input. Phase 3 computes it once the algorithm is sourced.

### 6.3 Flash volume [S, interpretation to confirm]

V_flash = flash% × V_base, where flash% = `forging_partComplexityBasedData[score]."Hot Forging - Flash Percentage Volume"`:

| Score | 1–3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|
| Flash % | 0 | 12 | 15 | 20 | 21 | 23 | 25 | 30 | 35 | 40 |

The staged column name does not say what the percentage is "of". v1.1 reads it as a percentage of the net part volume (V_base = Vp). Confirm under D1.

Example: 0.20 × 150,000 = 30,000 mm³ → 30,000 × 10⁻⁹ × 7850 = **0.2355 kg** (20 % of W_net).

This resolves review B2: v1.0's land formulas gave about 4 % flash, while the staged table gives 12–40 % for flashed parts.

### 6.4 Flash land thickness and width [C: coefficients staged; equation form NEEDS SOURCE (verification)]

Staged:
- `closedDieFlashLandThicknessCoefficientA/B/C` = 1.13 / 0.89 / 0.017. Notes: "empirical equation for calculating flash land thickness based on the mass of the forged part in kg".
- `closedDieFlashLandWidthCoefficientA/B/C` = 3 / 1.25 / −1.09. Notes: "… flash land width based on the flash land thickness and the mass …".

The coefficients match the published form t_f = 1.13 + 0.89·√W − 0.017·W (mm) and w_f / t_f = 3 + 1.2·e^(−1.09·W), from Altan, Ngaile and Shen, *Cold and Hot Forging: Fundamentals and Applications* (ASM International, 2005), chapter on flash design. **The page has not been checked. The staged B (1.25) differs from the 1.2 in that form.** Verify against the book or the reference tool's documentation before Phase 1 uses it (D1).

Candidate formulas, with W = forged part mass (kg):
- t_f = A + B·√W − C·W
- w_f = t_f · (A_w + B_w·e^(C_w·W))

Example (W = 1.1775 kg):
- t_f = 1.13 + 0.89 × 1.08513 − 0.017 × 1.1775 = 1.13 + 0.96577 − 0.02002 = **2.0758 mm**
- w_f / t_f = 3 + 1.25 × e^(−1.28348) = 3 + 1.25 × 0.27705 = 3.3463
- w_f = 3.3463 × 2.0758 = **6.946 mm**

Use: die design and press force (the land area Lp × w_f adds to Ap). It is **not** used for flash weight; 6.3 covers that, so the flash is not counted twice.

v1.0 had two width definitions: "3–6 % of part width" (its 3.2) and "3–5 × thickness" (its 5.3). Both are replaced by this one.

### 6.5 Scale loss, stock, kerf and gross weight [S]

- **Scale:** V_scale = s% × (Vp + V_flash). s% = `scaleLossAllowancePercentage` (3) for a gas furnace or `scaleLossAllowancePercentageInductionHeating` (1) for induction. The staged note says "percentage of the total forged volume (including flash)".
- **Mult (billet) volume:** V_mult = Vp + V_flash + V_scale. Mult length L = V_mult / A_bar.
- **Valid stock:** `minBilletRatio` (0.3) ≤ L / D ≤ `maxBilletRatio` (3.5), from `forging_roundBarSizes` (or square bar per `virtualStockForm`, default `ROUND_BAR`).
  - Induction also needs D ≤ `inductionHeatMaxStockWidth` (101.6 mm), L / D ≥ `inductionHeatMinMultRatio` (2), and D ≤ the heater's `maximum_coil_diameter_mm`.
  - Up to `validMaterialStocksListLimit` (5) stocks are evaluated. **The rule for choosing among valid stocks is not staged.** Recommendation: price each one and take the cheapest per part (D8).
- **Kerf:** V_kerf = A_bar × `bandSawKerfWidth` (3.175 mm).
- **Tong hold:** zero for closed-die press and hammer forging from bar. Nothing is staged for it.
- **Gross:** V_gross = V_mult + V_kerf; W_gross = V_gross × 10⁻⁹ × ρ.
- `multLengthElongationFactor` (1.61) and `standardStockLength` (6096 mm) cover bar-end utilisation; that formula is not staged (N, D8).

Example, Ø44.45 mm, induction:

| Step | Arithmetic | Result |
|---|---|---|
| A_bar | π/4 × 44.45² | 1551.79 mm² |
| V_scale | 0.01 × (150,000 + 30,000) | 1,800 mm³ |
| V_mult | 150,000 + 30,000 + 1,800 | 181,800 mm³ |
| L | 181,800 / 1551.79 | 117.15 mm |
| L / D | 117.15 / 44.45 | 2.636: within 0.3–3.5 and ≥ 2, so valid for induction |
| V_kerf | 1551.79 × 3.175 | 4,926.94 mm³ |
| V_gross | 181,800 + 4,926.94 | 186,726.94 mm³ |
| W_gross | 186,726.94 × 10⁻⁹ × 7850 | **1.46581 kg** |
| Material yield | 1.1775 / 1.46581 | 80.3 % |
| Gross material cost | 1.46581 × 1.479 | **2.1679 USD** |

Note: Ø50.8 mm would give L / D = 1.80. That is valid stock but **fails** the induction minimum of 2, so it would need a furnace instead. The capability checks change the result, as intended.

### 6.6 Scrap credit [S switch, N interpretation]

- `enableScrapMaterialCredit` = **false** (staged), so by default there is no credit.
- When enabled, W_scrap = W_flash + W_kerf. Scale is not credited, because it is oxide and not solid scrap.
- Credit = W_scrap × price × `scrap_cost_percent` / 100, *if* "Scrap Cost Percent" means scrap value as a percentage of the material price. **The meaning is not documented in 823/855** (N, D1).

Example if enabled: W_scrap = (30,000 + 4,926.94) × 10⁻⁹ × 7850 = 0.27418 kg; × 1.479 × 0.04 = **0.0162 USD**.

v1.0 had no switch and used a scrap rate per kg that the repo does not have.

### 6.7 Forging force and energy

**Flow stress [S for the law and its material inputs; N for the strain rate]:**

σ_f = C × ε̇^m, with C = `strength_coefficient` (MPa) and m = `strain_rate_sensitivity`, both at the staged forging temperature (855 properties).

ε̇ depends on the machine (ram speed / part height). **No strain-rate source is staged for press or hammer** (N).

Units example only (ε̇ = 10 s⁻¹ chosen to show the arithmetic; it is not a value to use): 67.41 × 10^0.21 = 67.41 × 1.62181 = **109.33 MPa**.

This replaces v1.0's flow-stress table, whose ranges had no source.

**Closed-die press force [N]:** the staged `frictionCoefficient` (0.4) and `shapeFactorCoefficient` (0.333) are both documented as **Open Die Press** inputs ("friction between the Open Die Press machine's tooling …"). So v1.0's slab formula with μ = 0.35 and Cs = 1.4 has no staged closed-die basis. A closed-die force formula needs a source (D1). Once it exists, force acts on A_tot = Ap + Lp × w_f (6.4).

**Hammer energy [N for the formula; review B1 unit error fixed]:** v1.0 wrote E = 1.35 · Vp · σ_f · ln(h0/h1) / 1000 "kJ".
- Units: MPa × mm³ = N/mm² × mm³ = N·mm = 10⁻³ J. So /1000 gives **J**, and kJ needs **/10⁶**.
- Example (units only): 1.35 × 150,000 × 109.33 × ln 2 / 10⁶ = 1.35 × 150,000 × 109.33 × 0.693147 / 10⁶ = **15.35 kJ**.
- The factor 1.35 is unsourced. The staged route is `forging_materialTypeFactor` (Impact Energy Factor by cut-code family) × `impactEnergyFactorAdjustment` (1), compared with the hammer's `impact_energy_j`. Its formula is not staged (D1).

**Mechanical press capacity [S]:**
- Available force = `max_press_force_kn` × `mechanicalPressForceReductionFactorMultiStation` (0.7) when run as a `mechanicalPressNumberOfStations` (3)-station transfer press, or × `…SingleStation` (0.9).
- Die-block fit uses `mechanicalPressInterDieBlockSpacing` (25.4 mm), `mechanicalPressBolsterPlateAddendumThickness` (25.4), `mechanicalPressPartTransferHeightAllowance` (152.4) and `forceDistributionAngle` (20°) against the table and shut-height specs. **The die-block sizing formula is not staged** (N).

### 6.8 Cycle time, crew and line cost

**Hits [N for the adjustment formula]:** `baseNumberOfHits` (3) "is adjusted up or down based on partMultHeightRatio and materialTypeMultiplier". `blockingHitsFactor` (0.8) and `finishingHitsFactor` (0.8) apportion hits when upsetting, blocking and finishing are all enabled (`enableUpset`, `enableBlock` both true). The adjustment formula is not staged.

**Screw press (`forging_press`) and hammer [S inputs]:** cycle = hits × machine `cycle_time_s` + load / unload. Load and unload come from `forging_materialHandling` by mult weight, or from the machine's `load_plus_unload_time_s` scaled by the hammer's `*_handling_factor`. **Which of the two wins is not stated** (D6).

**Mechanical press with transfer [S]:** one part per stroke at SPM from `forging_partComplexityBasedData[score]`, capped by the machine's `max_stroke_rate`. Example: score 6 → 25 SPM → 60 / 25 = **2.4 s per part**.

**No double counting (review C3):** upsetting, blocking and finishing are hits on **one** forge line, either one machine or one transfer press. They are costed as one `ProcessLineCost` with one crew. v1.0's separate OP 50 and OP 60 rows are merged.

**Global dials [S]:** `cycleTimeAdjustmentFactor` (1), `laborRateAdjustmentFactor` (1), `overheadRateAdjustmentFactor` (1), `regionMultiplier` (1). All are 1, so they have no effect, but the engine applies them so a factory can change them.

**Crew and labour [S, with a conflict to settle]:**
- Labour rate per hour = machine row `usd_labor_rate_per_hr` × `operators` (824). This is how casting does it: `hpdc-machine.ts` crewed rate = mhr + lhr × operators.
- `forging_numberOperatorsPress` gives a crew by weight that differs from the machine rows. A 1.47 kg mult needs 1 operator, while `forging_press` rows say 0.33. Decision D6.

v1.0's eight-role crew table and A+/A/B/C grades are removed: they have no source. The staged wage grade per process is in 4.1.

**Line cost [S]:** `eMithranTerms` with mhrPerHr = machine `mhr_usd_per_hour`, dlrPerHr = labour rate, setupNDL = cycleNDL = operators, cycleTimeMin, and setupTimeMin = `setup_time_hr` × 60 / batch size. This is the same per-batch spreading as `hpdc-engine.ts:336`.

**Band saw [S inputs, lookup rule to confirm]:**

t_cut = A_bar / rate, with rate = `forging_bandSawCutting[cut-code family, width]`.

Example: family 1 (cut code 1.2 → family 1, *assumed*: confirm the cut-code → family rule, D8). Width 44.45 mm falls below the first row (50 mm), so the lookup uses 6451.6 mm²/min (row-selection rule, D8).

1551.79 / 6451.6 = 0.24053 min = **14.43 s**, plus handling from `forging_bandSawHandling` or the machine's `load_plus_unload_time_s` (D6).

**Induction heating [S inputs, N formula form]:**

t_heat = Heat Time Coefficient (s/mm²) × a section term (mm²). The coefficient for Steel is 0.0400 s/mm², from `forging_inductionHeating`.

The section term is either D² or A_bar; the table does not say which:
- D²: 0.04 × 44.45² = **79.03 s**
- A_bar: 0.04 × 1551.79 = **62.07 s**

Throughput on a conveyor heater also depends on how many mults are in the coil (`total_coil_length_mm` / L). That rule is not staged (D1).

Coil efficiency (Steel 87.5 %) is for energy and CO₂, not time.

**Furnace preheat and reheat [N]:**
- Capability: `max_operating_temperature_c` ≥ forging temperature + `ovenTemperatureOffset` (100 °C). For AISI 1045 that is 1148 + 100 = 1248 °C.
  - In 824, only the three "Oven - 8' x 4' / 12' x 8' / 20' x 10'" rows (1500 °C) qualify.
  - The staged **default** furnace, H.K. Furnace RT4-105-12, is rated 1150 °C, so it is **not** capable for this steel. So are the other H.K. rows (950–1150 °C) and the Schlager Box Furnace (700 °C).
  - Machine choice must therefore not assume the default machine is capable.
- Heat time uses `preheatInitialTemperature` (16 °C), `reheatInitialTempFactor` (0.5), `numTemperatureIntervals` (100), specific heat capacity (855) and `ovenPartSpacingFactor` (0.5). The heat-transfer formula is not staged.

### 6.9 Trim [S inputs, N force]

Trim runs on `forging_trim` machines: the press's `cycle_time_s` per stroke plus handling. Required trim force (shear strength × trim perimeter × flash thickness) uses the staged `shear_strength`, but the formula is not staged (N).

### 6.10 Downstream operations: reuse, do not rebuild

| Operation | Existing engine | State |
|---|---|---|
| Heat treatment | `costing/heat/heat-treatment-engine.ts:285` `computeHeatTreatments` (data `2026-HeatTreat`, machines `heat_treat_*`, migration 826; calculators, migration 907). Its 22 processes (`HEAT_TREATMENT_PROCESSES`, `:40-46`) cover the usual forging treatments: quench and temper = Atmosphere Oil Harden + Standard Temper; plus Stress Relief, Standard Anneal, Induction Harden, Carburize. **There is no Normalize process.** | costed, except normalising: Data needed |
| Shot blast | `costing/surface/surface-treatment-engine.ts:511` `computeSurfaceTreatments`. Conveyor Shot Blast is costed (`:226`, `defaultConveyorShotBlastLineSpeed`); batch Shot Blast is a declared gap. | partial; gap already named |
| Machining after forging | `costing/shared/tolerance/secondary-machining-cost.ts:101` `priceSecondaryMachining`. It is primary-process agnostic and already used for machining after casting. | costed |
| Inspection / NDT (MPI, UT) | No forging-specific source. The platform inspection engine applies (registered in `manufacturing-process-registry.ts`). | NDT rates: Data needed |

v1.0's OP 90–120 cycle-time ranges (8–15 min per basket, 30–120 s inspection, …) are removed: they have no source.

### 6.11 Die cost and amortisation (review B5)

**Die cost [N for the build-up; S for the bounds and compensation]:**

Staged:
- `cavityCNCSetupTime` (2 h)
- `roughingCNCRate` (0.004 h/in³)
- `forceDistributionAngle` (20°)
- `hammerDieCostComp`, `trimDieCostComp`, `piercingDieCostComp` (each 1)
- `includeTrimDieMaterial` and `includePierceDieMaterial` (both false)

**Validity bounds:**

| Die | Min (USD) | Max (USD) |
|---|---|---|
| Finish die | `minFinishDieCost` 5,000 | `maxFinishDieCost` 25,000 |
| Blocking add-on | `minBlockingDieAddOn` 300 | `maxBlockingDieAddOn` 8,000 |
| Trim die, without / with material | 500 / 3,000 | 4,000 / 15,000 |
| Pierce die, without / with material | 1,000 / 4,000 | 11,000 / 17,000 |
| Insert die | 500 | — |

The notes say a calculated cost outside its bounds "is not valid". v1.1 treats an out-of-bounds result as a **gap**, not a clamp.

The die cost build-up itself (block size, steel, CNC, EDM, heat treat) is not staged. It must be sourced, or the die cost entered as a user quote (D1).

**Amortisation [S structure]:** this mirrors the casting "Die Life" calculator.
- Lifetime parts = annual volume × production life.
- Tool life = `pressToolLifeNumberOfParts` / `mechanicalPressToolLifeNumberOfParts` / `hammerToolLifeNumberOfParts` (each 7,500) × `forging_tblToolCoating` factor. The trim die uses `trimToolLifeNumberOfParts` (7,500).
- Die sets = max(1, ceil(lifetime parts / tool life)).
- Total tooling = die cost + (die sets − 1) × replacement-die cost.
- Per part = total tooling / lifetime parts. `disableInvestmentAmortization` = false (staged).
- The staged note says tool life is "before the tooling needs refurbishing or replacing". **The cost of a refurbish (redress) compared with a new die is not staged** (N, Data needed).

Example: 10,000 a year × 5 years = 50,000 parts; uncoated die. ceil(50,000 / 7,500) = ceil(6.667) = **7 die sets**. v1.0's "die cost / total volume" ignored the 6 extra sets.

### 6.12 Route selection (closed-die only)

For the part, each forge machine class (screw press, mechanical transfer press, hammer) and each heating option (induction, furnace) is priced:

piece cost (material + all lines + tooling per part)

A machine is capable when force or energy is enough (6.7), the die block fits the table (6.7), and the stock is valid (6.5). The cheapest capable route per part wins. This is the same rule as machine choice (3.2), applied across classes.

`usePreferredMachines` (true) and each machine's `is_preferred` exist: preferred machines are tried first. If no route is capable, the result is a gap that names the binding limit. This replaces v1.0's DFM-FRG-006 "high tonnage" BLOCKER (section 7).

### 6.13 Preforming

`enableUpset` / `enableBlock` (both true) switch the upset and blocker stages on. v1.0's dA/dx rule for adding a preform step has no staged threshold (N). v1 always costs upset + block + finish hits; a variable preform decision is deferred.

---

## 7. DFM rules (one value per threshold)

Rules are data-driven from `forging_manufacturabilitySeverity` and gated by `forging_adviceRules.Enabled`. Severity uses the staged levels **Critical / Major / Minor**, not v1.0's BLOCKER / WARNING / INFO.

**No DFM rule blocks costing.** A part is uncostable only through a capability gap (6.12). This answers review C5.

| v1.0 rule | v1.1 rule (staged name) | Threshold (staged) | Severity |
|---|---|---|---|
| DFM-FRG-001 external draft (3.0°) | `InsufficientDraftAngle` (surface) | Steel, Low-Alloy, Unalloyed, Stainless, Titanium < 5°; Aluminum, Brass, Copper, Magnesium < 3°; HRSA < 7°. Any material < 0.01° is Critical. | Major (Critical at < 0.01°) |
| (internal draft, v1.0 3.3) | `InsufficientDraftAngle` (Simple Hole) | Steel, Low-Alloy, Unalloyed, Stainless < 7°; default < 5° | Major |
| DFM-FRG-002 trapped undercut | `InaccessibleFeature` ("die lock condition") | boolean | Critical |
| DFM-FRG-003 fillet (2.0 / 3.5 mm) | `InsufficientFilletRadius` | Steel 5.84 mm; Aluminum 4.83; Magnesium 7.11; Titanium 9.65; HRSA 14.48; default 5.84 | Major |
| (corner radius, v1.0 3.4: 1.5–3 mm + 0.05 × depth) | `InsufficientCornerRadius` | Steel, Aluminum, Magnesium 2.79 mm; Titanium 4.06; HRSA 6.35 | Major |
| DFM-FRG-005 thin web (3.0 / 2.0 mm) | `ThinSection`, banded by solid shadow area | Steel, min wall by solid shadow area band (mm²): 654.16 → 2.794 mm; 3,270.8 → 3.81; 6,541.6 → 4.572; 32,708 → 6.858; 65,416 → 8.128; 327,080 → 11.176. Other materials have their own bands. How a part's area selects a band is not stated: D8. | Major |
| DFM-FRG-004 rib ratio (4:1 / 4.5:1) | **not staged** | NEEDS SOURCE. Dropped from v1 unless sourced. | — |
| DFM-FRG-006 high tonnage | not a DFM rule; a capability gap (6.12) | — | — |
| — | `ThickSlug`, `ThickWalledHole`, `HighBlindHoleLengthToDiameterRatio` (Major 1.5, Minor 0.75), `Threaded`, 16 `TightTolerance*` rules | as staged | as staged |

Each staged rule's comparison operator is in its `Rule Type` column. Phase 1 must read the operator from data and must not hard-code it.

Note: `dfm-scoring.service.ts` today is hard-coded (holes and bends only), and the `dfm_rules_library` table is not read by it (migration 483 comment). Forging DFM would be the first data-driven rule set. It should still return its verdict through `dfm-scoring.service.ts`, the single DFM authority (`docs/ENGINEERING.md`, DFM section).

Also staged and relevant: `minForgeableHoleDiameter` (25.4 mm), `maxForgedEdgeRadius` and `maxForgedCurvedSurfaceRadius` (2 mm; features beyond these need machining).

---

## 8. CAD extraction (Phase 3 specification)

| Need | Reuse | Gap |
|---|---|---|
| Projected area Ap, parting perimeter Lp, footprint | `cad-engine/shared/casting_geometry.py:118` `parting_plane_silhouette`: mesh triangles projected and merged with shapely `unary_union`; perimeter = outer boundary. **True silhouette, not bbox.** Fixes review B3. | Pull axis comes from canonical axes only |
| Draft per face, undercut flag | `cad-engine/shared/draft_angle_geometry.py:22` `analyze_draft_angles` (also used by `die_casting/features/base_properties.py`) | Planar wall faces only; one canonical axis at a time; confidence is a hard-coded 0.65 ("V1 heuristic") |
| Undercut / die lock (`InaccessibleFeature`) | — | Needs a real visibility test along the pull direction, with one threshold (review B4). v1.0 used −0.5° in code and −0.05 dot product in DFM-002. |
| Wall / thin section | `casting_geometry.wall_thickness_profile` | Shadow-area banding for `ThinSection` |
| Fillet and corner radii | — | New (needed by 7) |
| Complexity score 1–12 (section 6.2) | — | Algorithm NEEDS SOURCE |
| Cross-section curve A(x) | — | Only needed if a preform rule is sourced (6.13) |
| Pull-axis choice | `die_casting/feature_extractor.py` evaluates each canonical axis | Report all three scores and the choice (review B4) |

Rules for the extractor:
- Follow `docs/CAD_ENGINE_OCC_BINDING_STANDARDS.md`: pythonocc-core 7.7.2; lowercase `brepgprop` / `brepbndlib` namespaces; catch `Exception` for OCCT failures.
- **Feature vocabulary.** Forging feature types must come from the canonical vocabulary (`cad-engine/scripts/build_reference_features.py`, `SOURCES`). That needs `memory/Forging/Processes/operations.csv` in the `Machine:Operation//Feature` grammar, plus a `forging` `Domain` in `cad-engine/shared/feature_vocabulary.py:19`, then a re-run of the generator. **`memory/` is git-ignored and absent from this checkout**, and 790 records 0 forging operations. Whether such a file exists is a Data needed item. No feature names are invented.
- **Cache key.** Analysis is cached by `geometry_hash` salted with `CACHE_VERSION` (currently `geo_v59`, `cad-engine/shared/memory_optimizer.py:161`). Any forging extractor change bumps `CACHE_VERSION`; there is no separate `extractor_version` (review C7). The backend fallback `'geo_v5'` (`bom-items.controller.ts:268`, `auto-fill.service.ts:547`) is stale and should be fixed separately.
- **Do not** compute projected area as `bbox × 0.785` or perimeter as `bbox × 1.15` (v1.0 §10.3).

---

## 9. Other cost items (review C4)

| Item | v1.1 treatment | Source |
|---|---|---|
| Setup / die change | `setup_time_hr` per machine row spread over the batch (6.8) | 824 |
| Rejection / good-part yield | `eMithranTerms` `yieldPct`. The platform default `DEFAULT_YIELD_PCT = 0.98` (`default-rates.constants.ts:7`) applies only through `resolveYieldPct`, which warns when it falls back (`:15`). Casting instead passes yield 1 and prices yield separately. A forging-specific yield is not staged. | D9 |
| Material overhead | `MATERIAL_OVERHEAD_PCT = 5` (`default-rates.constants.ts:41`) is a sheet-metal nesting allowance ("nesting skeleton + handling scrap"). **Not applied to forging**, because flash, scale and kerf are explicit. | — |
| SG&A and profit | `costing_settings` `sga_pct` / `profit_pct` at roll-up | `cost-aggregation.service.ts:390-393` |
| Packaging and freight | Existing `packaging_cost_records` / logistics path; nothing forging-specific | `docs/COSTING_AND_BOM_ARCHITECTURE.md` §5 |
| CO₂ | Platform `computeSustainability`. Induction coil efficiency (4.3) and furnace gas type (`preheatFurnaceGasType`, `reheatFurnaceGasType` = Natural Gas) are staged inputs; the energy-per-kg model is not. | Data needed |
| Rate versioning | Exists: `source_version` on reference rows, `calculatorId`/`calculatorVersion` and `mhrId` on lines. Missing: no MHR/LHR snapshot is stored with a quote; `should_cost_predictions.rate_snapshot` (migration 952) exists but nothing in `src` writes it, and calibration rewrites `mhr_records` in place (953). | D10 (platform-wide, not forging-only) |

---

## 10. Validation and accuracy

1. **Phase 1, golden tests.** Each formula gets a jest test in `backend/src/test/modules/bom-items/costing/forging/`, the folder where the costing specs live (not under `src/modules`). Each test has a hand-calculated expected value and the arithmetic in a comment. Section 6's worked examples are the first cases. At least three parts: a simple disc (score 1–3, no flash), a block, and a flanged part (score ≥ 6). Plus edge cases: a missing input becomes a named gap; no capable press; zero draft is Critical; unit checks.
2. **Phase 5, real quotes.** For each supplier quote with geometry, report the difference per line (material, forge, heat, trim, tooling, total). Calibrate with the existing `src/modules/should-cost/calibration.ts` (ridge correction per process family and location, multiplier clamped to [0.5, 2], minimum 2 organisations and 5 samples). Do not build a second mechanism.
3. **Accuracy target.** **±10–15 %** on total piece cost for should-cost, measured on quotes the model was not tuned on. v1.0's "±3 % of benchmark quote data" is withdrawn: no benchmark data exists in the repo.
4. **Latency.** No target until measured. v1.0's "< 15 ms" was not measured.

---

## 11. Open decisions

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | **Source of the forging formulas.** 823 stages coefficients without equations: flash land form, hits adjustment, hammer energy, closed-die force, induction section term, furnace heat time, die cost build-up, scrap % meaning, flash % basis. | (a) Documentation of the reference tool the 823 data was exported from (same source as the other `memory/` domains). (b) Textbook formulas (Altan et al. 2005; ASM Handbook Vol 14A) with page citations, fed by the staged coefficients. (c) Leave them as named gaps and cost only what is sourced. | **(a)**, with (b) only where (a) is silent, and each formula cited. Until then Phase 1 builds the sourced parts (6.1, 6.3, 6.5, 6.8 structure, 6.11 amortisation) and returns named gaps for the rest. |
| D2 | Complexity scale | Staged 1–12 score vs v1.0 S1–S4 + Cs | **1–12**: it drives flash % and SPM. Drop S1–S4/Cs unless sourced. |
| D3 | Registry | (a) Like casting: not registered, called directly; off the default quote path by construction. (b) Register under new `MachineClass` keys, which means editing shared `default-rates.constants.ts` `MACHINE_REGISTRY` (affects three live domains). | **(a)** for Phase 1. Revisit in Phase 4 with the shared-code impact list. |
| D4 | Labour | (a) Machine row `usd_labor_rate_per_hr` × `operators` (casting precedent). (b) Per-role crew mix from `lhr_records`. | **(a)**. (b) has no crew-mix source. |
| D5 | Severity names | Staged Critical/Major/Minor vs v1.0 BLOCKER/WARNING/INFO | **Staged names**, and no DFM rule blocks costing. |
| D6 | Conflicting staged inputs | Crew: `forging_numberOperatorsPress` vs machine `operators`. Handling: `forging_materialHandling` vs machine `load_plus_unload_time_s` × handling factors. | Ask the data owner which governs. Until then use the **machine row**, as casting does, and record the other in the trace. |
| D7 | Adding missing data | (a) Reference-data package (on-premises step 5, not built). (b) An exception to the post-935 rule. (c) User-entered values per quote. | **(c)** for Phase 1–2 (inputs named in the gap), and (a) once built. Not (b). |
| D8 | Lookup and selection rules | Stock choice among valid bars; cut code → cut-code family; out-of-range lookup rows (first row, interpolate, or gap); bar-end utilisation | Price each valid stock and take the cheapest. Treat out-of-range as a gap until a rule is sourced. The cut-code family needs a source. |
| D9 | Good-part yield | Platform default 0.98 with warning, or a named gap | **Named gap** (consistent with the no-default rule), unless a forging yield is sourced. |
| D10 | Rate snapshot on quotes | Write `should_cost_predictions.rate_snapshot` now, or defer to a platform task | **Defer** to a platform task. It is not forging-specific. |

---

## 12. Data needed

| Item | Why | Who provides |
|---|---|---|
| Formula documentation for the 823 coefficients (D1 list) | Without equations most lines stay as gaps | You / CTO (reference tool docs), or an engineer with Altan / ASM 14A page citations |
| Complexity score algorithm for 2D / 2.5D parts | Drives flash % and SPM | Same as above |
| Meaning of "Scrap Cost Percent" and the flash % basis | Material credit and flash volume | Same as above |
| Die cost build-up (block sizing, die steel price, CNC/EDM rates) **or** user die quotes | Tooling per part | Tool shop quotes, or the reference docs |
| Redress (refurbish) cost vs new die | Die sets after the first | Tool shop |
| Closed-die press force and strain-rate model | Press capability check | Reference docs / literature |
| Furnace heat-time model; confirm whether `ovenTemperatureOffset` really excludes the default furnace (RT4-105-12, 1150 °C) for steels | Furnace route | Reference docs |
| `memory/Forging/Processes/operations.csv` (operation grammar) | Canonical forging feature types | Whoever holds `memory/` (git-ignored) |
| Non-USA forging machine and labour rows | Regions other than USA | Rates team, with named source |
| NDT (MPI/UT) rates and times | Inspection line | Supplier quotes |
| Batch shot blast allowances (an existing platform gap) | Shot blast after forging | Already listed in `docs/ENGINEERING.md` |
| Real forging quotes with geometry (at least 10, across 3 part types) | Validation (section 10) | You / customers |
| Rib-ratio threshold (if the rule is wanted) | DFM rule (section 7); none is staged | Reference docs |
| Flash land equation form (verify the 6.4 candidate; staged B = 1.25 vs 1.2 published) | Die design and press force | Reference docs, or the Altan et al. 2005 page |
| Hits adjustment formula (`partMultHeightRatio`, `materialTypeMultiplier`) | Forge cycle time (6.8) | Reference docs |
| Strain rate per machine class (press, mechanical press, hammer) | Flow stress σ = C·ε̇^m (6.7) | Reference docs / literature |
| Hammer energy formula using the Impact Energy Factor | Hammer capability (6.7) | Reference docs |
| Mechanical-press die-block sizing formula | Table and shut-height fit (6.7) | Reference docs |
| Trim (and pierce) force formula | Trim press capability (6.9) | Reference docs / literature |
| Induction section term (D² or bar area) and mults-in-coil throughput rule | Induction heat time (6.8) | Reference docs |
| Forging good-part yield / rejection rate | Yield term (section 9, D9) | Supplier data or reference docs |
| Cut code → cut-code family rule; behaviour outside a lookup's rows (first row, interpolate, gap); how a part's shadow area selects a `ThinSection` band | Saw rate, handling lookups, DFM (D8) | Reference docs |
| Bar-end utilisation formula (`multLengthElongationFactor`, `standardStockLength`) | Material cost from full bars (6.5) | Reference docs |
| Preforming threshold (dA/dx) | Whether a preform step is added (6.13) | Reference docs / literature |
| Normalising process data (time, machine class) | Normalising after forging is common, but `heat-treatment-engine.ts` has no Normalize process (6.10) | Heat-treat reference owner |
| Energy per kg for induction and gas heating | CO₂ (section 9) | Reference docs / utility data |

---

## 13. Later phases (not v1)

| Process | Why it differs | Staged today |
|---|---|---|
| Open-die (press) | No impression die, no flash; operator- and manipulator-driven; uses `frictionCoefficient`, `shapeFactorCoefficient`, `openDiePressCalibrationTime`, `ram_speed_mm_per_s`, tool change times | 823 variables; 824 `forging_open_die_press` (13) |
| Seamless ring rolling | Preform upset and pierce on the open-die press, then radial-axial rolling; `ringRollingHeightFactor`, `ringRollCalibrationTime`, `tblMandrelVelocity` | 823; 824 `forging_ring_rolling` (31) |
| Cold forging / heading | No heating, no scale, no flash; lubrication and work hardening | Not staged |
| Warm forging | Partial heating, different scale and die life | Not staged |
| Horizontal upset forging | Bar-end heating, gripper dies | Not staged |

---

## 14. Phase plan (revised)

| Phase | Scope | Exit criteria |
|---|---|---|
| 0 | This document | Every review item resolved or listed in section 11 |
| 1 | Pure closed-die engine on manual geometry in `costing/forging/`; sourced formulas only, named gaps for the rest; not on the default quote path | Golden tests and typecheck pass; nothing outside `costing/forging/` changed |
| 2 | Reference service reading 823 / 824 / 855; schema-only migrations (≥ 955) if needed; data via D7 | Local Postgres only; RLS isolation test |
| 3 | CAD extractor reusing `casting_geometry` / `draft_angle_geometry` | Hand-checked solids within a stated tolerance |
| 4 | Integration, API, UI behind a flag (off) | Other domains' tests unchanged; OpenAPI drift check passes |
| 5 | Validation against real quotes | Report per line; no tuning without approval |

---

## 15. Change log (review feedback → v1.1)

| Review item | What changed | Why / where checked |
|---|---|---|
| A1 migration path | `backend/migrations/`, next free 955 | `ls backend/migrations` (954 highest before 999); BASELINE.json `upToNumber 917` |
| A2 RLS function | `public.current_user_org_ids()`; 544 policy shape (4.6) | 541:20; no `auth.current_organization_id` anywhere |
| A3 machine table | Dropped `forging_machines`; reuse `mhr_records` (4.1, 4.2) | 824 (202 rows with capability `specs`) |
| A4 lookup table | Dropped `forging_lookup_tables`; use 823 `machining_reference_data` (4.3) | 823 header line 14; `memory-reference-domains.json:61-66` |
| A5 wage rates | Deleted the 6-region table; labour from machine rows (6.8, D4) | 824 `usd_labor_rate_per_hr`; 823 `wage_grade` rows |
| A6 silent defaults | Complexity 1.4, friction 0.35, 5 % kerf removed. Kerf is the staged 3.175 mm width; friction is open-die only; complexity per 6.2. Missing items are gaps. | 823 variable notes; `hpdc-engine.ts:241-254` |
| A7 pure engine | Reference service loads first, engine is pure (3.2) | `casting-reference.service.ts`; `bom-items.service.ts:3960-3971` |
| A8 reuse CAD code | `parting_plane_silhouette`, `analyze_draft_angles`, binding standards (8) | `casting_geometry.py:118`; `draft_angle_geometry.py:22`; standards doc |
| A9 stack claims | Corrected (3.3) | `package.json:60`; 917/920; `test/sql/run.sh`; Dockerfile |
| B1 energy units | /10⁶ for kJ, with unit derivation (6.7) | Arithmetic shown |
| B2 flash too small | Flash from staged complexity table, 12–40 % (6.3); land formulas used only for die and force (6.4) | 823 `forging_partComplexityBasedData` |
| B3 extractor stub | True silhouette area and perimeter from existing code (8) | `casting_geometry.py:118-160` |
| B4 extractor gaps | Visibility test, three axes with scores, one undercut threshold: listed as Phase 3 requirements (8) | `draft_angle_geometry.py` limits |
| B5 die cost per part | ceil(volume / tool life) die sets, replacement die, coating factor, redress as data needed (6.11) | `die-casting-calculators.json:1705-1707`; 823 tool-life variables |
| B6 tonnage unvalidated | Closed-die force formula marked NEEDS SOURCE; validation in section 10 | 823 friction note says Open Die Press |
| B7 standards citations | S1–S4 / DIN citations removed; staged 1–12 score used (6.2, D2) | 823 complexity variables |
| C1 scope | Closed-die hot only (2); others in 13 | — |
| C2 missing formulas | Heating, route, preform, cycle specified with source status (6.5–6.13); heat treatment and shot blast reuse existing engines (6.10) | `heat-treatment-engine.ts:285`; `surface-treatment-engine.ts:511` |
| C3 double counting | One forge line for upset, block and finish hits (6.8) | — |
| C4 missing cost items | Section 9 | `engine-kernel.ts:99`; `cost-aggregation.service.ts:390` |
| C5 threshold conflicts | One staged value each; staged severities; no DFM blocking (7) | 823 `forging_manufacturabilitySeverity` |
| C6 schema | Write policies, indexes, CHECKs, authenticated-only reads required for any Phase 2 schema (4.6) | 544 |
| C7 cache | Extractor changes bump `CACHE_VERSION` (8) | `memory_optimizer.py:161` |
| C8 acceptance | ±10–15 % target; engine on manual geometry first (10, 14) | `should-cost/calibration.ts` |
| D1–D5 CTO questions | Answered as recommendations in section 11 (D3, D4, D1, section 8, D1/D2) | — |
