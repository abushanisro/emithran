# Drawing Forming Costing Template

## Legend
- **Changed**
- **Addition**
- **To be removed**

## Part Information

| Field | Value | Logic / Default | Formula | Notes |
|---|---|---|---|---|
| Internal Part Number | | Populated from template upload / User Input | | |
| Part Description | | Populated from template upload / User Input | | |
| Annual Volume (#) | 12,000 | Populated from template upload / User Input | | |
| Commodity | Sheet Metal | Populated from template upload / User Input | | |
| Process Name | Stamping - Progressive | System suggestion / User Input | | |
| Current Supplier Name | | Template upload / Dropdown | | |
| Current Manufacturing Country | USA | Template upload / Dropdown | | |
| Delivery Country | USA | Template upload / Dropdown | | |
| BOM Qty | 1 | Template upload / User Input | | |
| Part Complexity | Medium | System suggestion / Dropdown | | |
| Lot Size (#) | 1,000 | Default = Annual Volume / 12 | | |
| Supply Chain Model | Buy | Default | | |
| Packaging Type | No Packing | Dropdown | | |
| HS Code | N/A | Template upload / User Input | | |
| Inco Terms | EX-W | Supplier / Client Master | | |
| Payment Terms | 60 Days | Supplier / Client Master | | |

## Material Information

| Field | Value | Logic / Formula |
|---|---:|---|
| Category | Ferrous | Drawing / User Input |
| Family | HDG Steel | Drawing / User Input |
| Grade | 2mm × 500mm SGCC | Drawing / User Input |
| Density (g/cc) | 7.85 | Material DB |
| Material Price ($/kg) | 1.5 | Material DB |
| Scrap Price ($/kg) | 0.4 | Material DB |
| Unfolded Length (mm) | 50 | Drawing |
| Unfolded Width (mm) | 30 | Drawing |
| Thickness (mm) | 2 | Drawing |
| Net Weight (g) | 23.1 | Drawing |
| Area (mm²) | 1,500 | Drawing |
| Volume (mm³) | 3,000 | Area × Thickness |
| Part Allowance (Kerf) | 1.00 | Lookup Table 5 |
| No. of Impressions | Removed | To be removed |
| Sheet Width (mm) | 1250 | System suggestion |
| Sheet Length (mm) | 2500 | System suggestion |
| Edge Allowance (mm) | 2 | Default |
| Parts per Sheet | 1,972 | ((SW-EA)×(SL-EA))/((L+PA)×(W+PA)) |
| Sheet Weight (g) | 49,063 | L×W×T×Density /1000 |
| Scrap Weight / Part (g) | 1.7814 | Gross−Net |
| Net Weight / Part (g) | 23.1000 | Drawing |
| Gross Weight / Part (g) | 24.8814 | Sheet Weight / Parts per Sheet |
| Utilisation (%) | 92.84% | Net/Gross |
| Scrap Recovery (%) | 90% | User editable |
| Gross Material Cost ($) | 0.0373 | (Gross wt/1000)×Price |
| Scrap Recovery Cost ($) | 0.0006 | Scrap×Recovery×Price |
| Net Material Cost ($) | 0.0367 | Gross−Recovery |

## Manufacturing 1 – Laser Cutting

- Process: **Laser Cutting**
- Cutting Length (L): **178.84 mm**
- Piercings (P): **2**
- Cutting Speed (N): **4.2 m/min**
- Cutting Time (CT): **L / N**
- Piercing Time (PT): **X × P**
- Total Time (T): **CT + PT = 4.95 sec**
- Machine: **6000 W TruLaser**
- Automation: **Auto**
- Setup Time: **0.0100 min/part**
- Sheet Loading Time: **10 min**
- **Recommend (T): Removed**
- **Cycle Time: Removed**
- Direct Labors: **0.5**
- Skilled Labors: **0**

### Cost Drivers
| Item | Value | Notes |
|---|---:|---|
| Direct Labor Rate | $30/hr | Country table |
| Skilled Labor Rate | $45/hr | Country table |
| QA Rate | $50/hr | |
| Sampling | 1% | Sampling plan |
| Inspection Time | 0.5 min | Based on complexity |
| Yield | 98% | Editable |
| Machine Hour Rate | $30/hr | Machine DB |
| Machine Cost | $0.0413 | **Formula changed** |
| Setup Cost | $0.0075 | **Formula changed** |
| Labor Cost | $0.0206 | **Formula changed** |
| Inspection Cost | $0.0042 | **Formula changed** |
| Yield Cost | $0.0020 | **Formula changed** |
| Net Process Cost | $0.0756 | Sum of all costs |

## Manufacturing 2 – Bending

- UTS: **440 MPa**
- Bending Length (B): **2200 mm**
- Shoulder Width (L): **15 mm**
- Coefficient (C): **1.33**
- **Force Formula:** `F=((T²×B×UTS×C)/L)/9810`
- Theoretical Force: **35 Ton**
- Number of Bends: **1**
- Total Tonnage: **35 Ton**
- Recommended Force: **43.75 Ton (F × 1.25)**
- Selected Machine: **80T Press Brake**
- Automation: **Manual**
- Recommend (T): **Removed (shifted to top)**
- Cycle Time: **7 sec**
- Setup Time: **0.0100 min/part**
- Tool Loading Time: **10 min**
- Sheet Loading/Unloading: **0.0833 min**

### Cost Drivers

| Item | Value | Notes |
|---|---:|---|
| Direct Labors | 1 | Machine DB |
| Skilled Labors | 0 | Hidden |
| Direct Labor Rate | $30/hr | |
| Skilled Labor Rate | $45/hr | |
| QA Rate | $50/hr | |
| Sampling | 1% | |
| Inspection | 0.5 min | |
| Yield | 98% | |
| Machine Hour Rate | $15/hr | |
| Machine Cost | $0.0292 | **Formula changed** |
| Setup Cost | $0.0075 | **Formula changed** |
| Labor Cost | $0.0686 | **Formula changed** |
| Inspection Cost | $0.0042 | **Formula changed** |
| Yield Cost | $0.0027 | **Formula changed** |
| Net Process Cost | $0.1122 | Sum of all costs |
