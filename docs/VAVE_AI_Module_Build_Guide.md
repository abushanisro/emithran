# VAVE AI & Automation Module — Build Guide for Mithran
> **Module:** VAVE CoE — AI and Automation Journey 2026  
> 

---

## 1. Executive Summary

The VAVE (Value Analysis / Value Engineering) AI & Automation module transforms the traditional 21–32 week value engineering cycle into a **13–20 week AI-accelerated workflow**. This module is a commercial add-on to the Mithran Manufacturing OS targeting enterprise customers (like ThermoFisher Scientific) who run VAVE programs.

### Business Impact Targets

| Metric | Target |
|---|---|
| End-to-end cycle time reduction | 30–40% (20–30 wks → 14–20 wks) |
| Manual workload reduction (Information Phase) | ≥ 50% |
| Accuracy in specification extraction | ≥ 90% |
| BOM creation time reduction | 50–70% |

---

## 2. Product Architecture Overview

The module is split into **3 phases**, each delivered as independently licensable sub-modules.

```
┌─────────────────────────────────────────────────────────────┐
│                   MITHRAN VAVE MODULE                       │
├──────────────┬──────────────────────┬───────────────────────┤
│   PHASE 1    │      PHASE 2         │       PHASE 3         │
│  Data Acq.   │  Intelligence &      │  Automations &        │
│  Engine      │  Ideation Engine     │  Scoping Engine       │
│  (Q3 2026)   │  (Q4 2026)           │  (Q4 2026)            │
└──────────────┴──────────────────────┴───────────────────────┘
```

---

## 3. Phase 1 — Data Acquisition Engine (Before Q3 2026)

### 3.1 Goal
Automate the collection of product data, cost data, and supplier data from enterprise systems — eliminating 1–3 weeks of manual data gathering.

### 3.2 Sub-modules

#### 3.2.1 ERP Integration Tool *(Status: IN-PROGRESS)*
- **Purpose:** Automated Product Model & BOM Extraction
- **What it does:**
  - Connects to ERP (SAP, Oracle, etc.) via API or ETL pipeline
  - Extracts Bill of Materials (BOM) hierarchically (L1–L3 assemblies)
  - Pulls current standard costs, actual costs per component
  - Auto-structures into a VAVE-ready format (Part No. | Description | Level | Cost | Supplier)
- **Tech Stack:**
  - REST API connectors for SAP S/4HANA / Oracle ERP
  - ETL layer: Apache Airflow or Prefect
  - Storage: PostgreSQL (BOM table, cost table)
  - Output format: JSON + downloadable Excel BOM
- **Mithran Integration:** Add as a Mithran data source plugin under `integrations/erp/`

#### 3.2.2 PLM Integration *(Status: YET TO START)*
- **Purpose:** Retrieval of 2D Drawings & 3D Models for teardown analysis
- **What it does:**
  - Connects to PLM systems (Teamcenter, Windchill, Enovia)
  - Fetches associated drawings (PDF/DXF) and 3D models (STEP/IGES) per BOM line item
  - Indexes drawings with part number metadata for AI analysis
- **Tech Stack:**
  - PLM REST API / SOAP connectors
  - File storage: S3/MinIO for drawing blobs
  - Vector embedding of drawing metadata for semantic search
- **AI Layer:** Use a vision model (Claude claude-sonnet-4-20250514 with vision or GPT-4V) to extract:
  - Material callouts
  - Tolerance specifications
  - Manufacturing process indicators (turned, cast, stamped, etc.)

#### 3.2.3 Supply Chain Integration *(Status: IN PLACE — Wayfinder)*
- **Purpose:** Supplier Spend, Current & Historical Costs
- **What it does:**
  - Ingests supplier master data from Wayfinder
  - Pulls spend data: top suppliers, tail-spend, historical pricing
  - Correlates spend to BOM line items
- **Data Schema:**
  ```sql
  CREATE TABLE supplier_spend (
    part_number     VARCHAR,
    supplier_id     VARCHAR,
    supplier_name   VARCHAR,
    spend_current   DECIMAL,
    spend_historical JSONB,   -- {year: spend}
    is_tail_spend   BOOLEAN,
    created_at      TIMESTAMP
  );
  ```

### 3.3 Phase 1 Output
- Unified **Product Data Hub**: BOM + drawings + supplier costs in one place
- Powers all downstream Phase 2 analyses automatically

---

## 4. Phase 2 — Intelligence & Ideation Engine (Before Q4 2026)

### 4.1 Goal
Replace 8–18 weeks of manual analysis with AI-driven insights across cost, supplier, and ideation dimensions.

### 4.2 Pipeline Flow

```
BOM + Drawing Data                Supplier Master (Wayfinder)
        │                                    │
        ▼                                    ▼
[1] Product Cost Analysis     [2] Supplier Spend Analysis
    (Focus Area Report)            (Supplier Spend Report)
        │                                    │
        └──────────────┬─────────────────────┘
                       ▼
           [3] Should / Delta Costing Engine
               (Should Cost Report + Negotiation Deck)
                       │
                       ▼
           [4] Ideation Phase-2 & Competitor Benchmarking
               (Ranked Idea Repository + Action Plan)
```

---

### 4.3 Sub-module 1 — Product Cost Analysis | Ideation Phase-1

**Input Data:** BOM Hierarchy + Drawing Data

**Methods to implement:**

| Method | Implementation |
|---|---|
| 80/20 Pareto Analysis | Sort BOM by cost descending, flag top 20% parts driving 80% cost |
| Affinity Mapping | Cluster parts by functional group using embedding similarity |
| QFD (Quality Function Deployment) | Matrix linking customer needs → part functions → cost drivers |
| Cost Waterfall by Subsystem | Stacked bar chart: Assembly → Sub-assembly → Component cost split |

**AI Prompt (GPT Agent):**
```
Given this BOM: [BOM JSON], perform:
1. Pareto cost analysis — identify the top 20% cost drivers
2. Group parts by functional affinity
3. Flag high-risk cost concentration areas
Return JSON: {pareto_items, affinity_groups, focus_areas}
```

**Output:** `focus_area_report.pdf` — highlights which assemblies/parts to pursue in VAVE

**Mithran Route:** `POST /api/vave/phase2/cost-analysis`

---

### 4.4 Sub-module 2 — Supplier Spend Analysis

**Input Data:** Supplier Master Data from Wayfinder

**Methods to implement:**

| Method | Description |
|---|---|
| Top Spend Supplier Ranking | Ranked list by total annual spend |
| Tail Spend Identification | Suppliers below threshold (e.g., <$50K/yr) — consolidation candidates |
| Supplier Consolidation Opportunities | Identify parts sourced from multiple suppliers that could be consolidated |
| Spend-to-Part Cost Correlation | Which suppliers drive cost on which assemblies |

**Output:** `supplier_spend_report.pdf`

**Mithran Route:** `POST /api/vave/phase2/supplier-analysis`

---

### 4.5 Sub-module 3 — Should / Delta Costing Engine

**Input Data:** Focus Area Report + Supplier Spend Report

**Methods to implement:**

| Method | Description |
|---|---|
| AI-driven Should Cost Model | Estimate what a part *should* cost based on geometry + material + process |
| Material + Process + Overhead Build-up | Bottom-up cost model: raw material cost + machining + overhead + margin |
| Market Benchmark Comparison | Compare should cost vs. market rates (web search + historical DB) |
| Gap Analysis: Actual vs Should Cost | Δ cost = Actual − Should Cost; flag savings opportunities |
| Competitor Delta Costing | Estimate competitor product cost from teardown data |

**Should Cost Calculation Logic:**
```python
def should_cost(part):
    material_cost = part.weight_kg * material_price_per_kg[part.material]
    process_cost  = estimate_process_cost(part.geometry, part.process)
    overhead      = (material_cost + process_cost) * OVERHEAD_RATE
    margin        = (material_cost + process_cost + overhead) * MARGIN_RATE
    return material_cost + process_cost + overhead + margin
```

**AI Enhancement:** Use Claude API to extract manufacturing process from 2D drawings:
```javascript
const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: drawingBase64 }
        },
        {
          type: "text",
          text: "Extract: material, manufacturing process, key dimensions, tolerances, surface finish. Return JSON."
        }
      ]
    }]
  })
});
```

**Output:** `should_cost_report.pdf` + `negotiation_deck.pptx`

**Mithran Route:** `POST /api/vave/phase2/should-costing`

---

### 4.6 Sub-module 4 — Ideation Phase-2 & Competitor Benchmarking

**Input Data:** All 3 prior reports (PCA, Supplier Spend, Should Cost Gap)

**Ideation Frameworks to implement:**

| Framework | AI Implementation |
|---|---|
| FAST Diagram (Function Analysis) | AI maps part functions → basic/secondary/unwanted functions |
| SCAMPER Methodology | AI generates ideas: Substitute, Combine, Adapt, Modify, Put to other use, Eliminate, Rearrange |
| TRIZ Inventive Principles | AI matches contradictions to TRIZ principles and generates solution directions |
| AI-generated Idea Cards | Each idea: title, description, estimated savings, feasibility, risk |
| Competitor Benchmarking | Teardown insights + cost benchmarks vs. known competitor products |

**AI Ideation Prompt:**
```
You are a Value Engineering expert. Given:
- Focus areas: [focus_area_report]
- Should cost gaps: [cost_gaps]
- Competitor insights: [competitor_data]

Generate 10 VAVE ideas using SCAMPER and TRIZ. For each idea provide:
{
  "idea_title": "",
  "framework": "SCAMPER|TRIZ|FAST",
  "description": "",
  "affected_parts": [],
  "estimated_savings_usd": 0,
  "feasibility": "High|Medium|Low",
  "implementation_complexity": "L1|L2|L3",
  "risk": "High|Medium|Low"
}
```

**Output:** `ranked_idea_repository.xlsx` + `action_plan.pdf`

**Mithran Route:** `POST /api/vave/phase2/ideation`

---

## 5. Phase 3 — Automations & Scoping Engine (Before Q4 2026)

### 5.1 Goal
Convert ranked VAVE ideas into executable business cases with ROI, impact matrix, and approval-ready documents.

### 5.2 Sub-module: Sizing | Scoping | Business Case

**Input Data:**
- All ranked ideas (with technical + cost details)
- Business case criteria (investment threshold, payback period, strategic alignment)

**Methods to implement:**

| Method | Description |
|---|---|
| 4-Blocked Prioritization | 2×2 matrix: Impact (cost savings) vs. Effort (implementation difficulty) |
| Impact Matrix | Multi-criteria scoring: savings, feasibility, time-to-implement, risk |
| Timeline Generation | Auto-generate Gantt chart: Idea approval → ECO → Serial Dev → Production |
| Business Case Template (ROI) | Auto-fill NPV, payback period, IRR from inputs |
| AR (Approval Request) Creation | Auto-generate capital approval document |

**4-Block Matrix Logic:**
```
High Savings + Low Effort  → QUICK WINS (Do First)
High Savings + High Effort → STRATEGIC BETS (Plan)
Low Savings + Low Effort   → FILL-INS (Do if capacity allows)
Low Savings + High Effort  → AVOID (Deprioritize)
```

**Business Case Template Fields:**
```markdown
## VAVE Business Case — [Idea Title]
- **Part/Assembly:** [name]
- **Current Annual Cost:** $[x]
- **Projected Savings:** $[y] / year
- **Implementation Cost:** $[z]
- **Payback Period:** [months]
- **NPV (3yr):** $[calculated]
- **IRR:** [%]
- **Implementation Complexity:** L1 / L2 / L3
- **ECO Required:** Yes / No
- **Approval Required:** Capital / Engineering / Procurement
```

**Outputs:**
- `a3_report.pdf` — One-page A3 problem/solution format
- `business_case_report.pdf` — Full business case with ROI
- `implementation_timeline.xlsx` — Gantt with milestones

**Mithran Route:** `POST /api/vave/phase3/scoping`

---

## 6. Full API Route Map (Mithran Backend)

```
/api/vave/
├── phase1/
│   ├── erp-sync          POST   Pull BOM + costs from ERP
│   ├── plm-sync          POST   Pull drawings + 3D models from PLM
│   └── supplier-sync     POST   Pull spend data from Wayfinder
│
├── phase2/
│   ├── cost-analysis     POST   Pareto + Affinity + QFD analysis
│   ├── supplier-analysis POST   Top spend + tail spend + consolidation
│   ├── should-costing    POST   Should cost model + gap analysis
│   └── ideation          POST   SCAMPER + TRIZ + idea generation
│
├── phase3/
│   ├── scoping           POST   4-block + impact matrix + Gantt
│   ├── business-case     POST   ROI template + NPV/IRR calc
│   └── ar-generation     POST   Approval request document
│
└── reports/
    ├── focus-area        GET    Download Focus Area Report PDF
    ├── supplier-spend    GET    Download Supplier Spend Report PDF
    ├── should-cost       GET    Download Should Cost + Negotiation Deck
    ├── ideas             GET    Download Ranked Idea Repository
    └── business-case     GET    Download Business Case PDF
```

---

## 7. Database Schema (Add to Mithran)

```sql
-- VAVE Projects
CREATE TABLE vave_projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR NOT NULL,
  product_family  VARCHAR,
  status          VARCHAR DEFAULT 'phase1',  -- phase1|phase2|phase3|complete
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- BOM Data (from ERP)
CREATE TABLE vave_bom (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID REFERENCES vave_projects(id),
  part_number     VARCHAR NOT NULL,
  description     VARCHAR,
  level           INTEGER,  -- BOM level (1=top, 2=sub, 3=component)
  parent_pn       VARCHAR,
  quantity        DECIMAL,
  unit_cost       DECIMAL,
  annual_volume   INTEGER,
  annual_spend    DECIMAL GENERATED ALWAYS AS (unit_cost * annual_volume) STORED,
  material        VARCHAR,
  process         VARCHAR,
  supplier_id     VARCHAR,
  drawing_url     TEXT,
  model_url       TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- VAVE Ideas (from Ideation Engine)
CREATE TABLE vave_ideas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID REFERENCES vave_projects(id),
  title           VARCHAR NOT NULL,
  description     TEXT,
  framework       VARCHAR,  -- SCAMPER|TRIZ|FAST|Manual
  affected_parts  JSONB,
  est_savings_usd DECIMAL,
  feasibility     VARCHAR,  -- High|Medium|Low
  complexity      VARCHAR,  -- L1|L2|L3
  risk            VARCHAR,  -- High|Medium|Low
  quadrant        VARCHAR,  -- QuickWin|Strategic|FillIn|Avoid
  status          VARCHAR DEFAULT 'draft',  -- draft|approved|in-progress|done
  created_at      TIMESTAMP DEFAULT NOW()
);

-- Should Cost Records
CREATE TABLE vave_should_costs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID REFERENCES vave_projects(id),
  part_number     VARCHAR,
  actual_cost     DECIMAL,
  should_cost     DECIMAL,
  delta           DECIMAL GENERATED ALWAYS AS (actual_cost - should_cost) STORED,
  delta_pct       DECIMAL,
  material_cost   DECIMAL,
  process_cost    DECIMAL,
  overhead        DECIMAL,
  margin          DECIMAL,
  benchmark_source VARCHAR,
  created_at      TIMESTAMP DEFAULT NOW()
);
```

---

## 8. Frontend UI — Key Screens to Build

### Screen 1: VAVE Dashboard
- Active projects with phase progress (Phase 1 → 2 → 3)
- Key metrics: total savings identified, ideas count, cycle time
- Quick-launch: "Start New VAVE Project"

### Screen 2: BOM Explorer (Phase 1)
- Tree view of BOM hierarchy (L1 → L2 → L3)
- Columns: Part No. | Description | Unit Cost | Annual Spend | Supplier | Status
- Color coding: Red = high cost, Yellow = medium, Green = low
- Filters: by level, by supplier, by spend threshold
- Actions: "Sync from ERP", "Upload Drawing", "Enrich with AI"

### Screen 3: Cost Analysis (Phase 2)
- **Pareto Chart:** Top 20% parts driving 80% cost (bar + line combo)
- **Cost Waterfall:** Assembly breakdown waterfall chart
- **Affinity Groups:** Card-based grouped view of functionally similar parts
- **Should Cost Gap Table:** Actual vs Should Cost with Δ highlighted

### Screen 4: Idea Repository (Phase 2)
- Kanban or table view of all AI-generated VAVE ideas
- Tags: Framework (SCAMPER/TRIZ), Status, Feasibility, Savings
- Idea Card: Title | Savings Est. | Complexity | Feasibility | Actions
- Bulk approve / reject / assign ideas

### Screen 5: 4-Block Prioritization Matrix (Phase 3)
- Interactive 2×2 drag-and-drop matrix
- X-axis: Implementation Effort | Y-axis: Savings Impact
- Ideas plotted as draggable cards
- Export selected quadrant to business case

### Screen 6: Business Case Generator (Phase 3)
- Form: select ideas → enter investment cost → auto-calculate ROI
- Generates: NPV, IRR, Payback Period
- Preview and download: A3 Report, Business Case PDF, Gantt Timeline

---

## 9. AI Services Architecture

```
┌─────────────────────────────────────────────┐
│              MITHRAN VAVE MODULE            │
│                                             │
│  ┌──────────────────────────────────────┐  │
│  │        AI Orchestration Layer        │  │
│  │                                      │  │
│  │  ┌──────────┐  ┌──────────────────┐  │  │
│  │  │ Claude   │  │  GPT Agent       │  │  │
│  │  │ Vision   │  │  (Data Analysis  │  │  │
│  │  │ API      │  │   & Ideation)    │  │  │
│  │  │          │  │                  │  │  │
│  │  │ Drawing  │  │  SCAMPER / TRIZ  │  │  │
│  │  │ Analysis │  │  Should Cost     │  │  │
│  │  │ Spec     │  │  Gap Analysis    │  │  │
│  │  │ Extract  │  │                  │  │  │
│  │  └──────────┘  └──────────────────┘  │  │
│  └──────────────────────────────────────┘  │
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ ERP      │  │ PLM      │  │Wayfinder │  │
│  │ Connector│  │ Connector│  │Connector │  │
│  └──────────┘  └──────────┘  └──────────┘  │
└─────────────────────────────────────────────┘
```

**Claude API call for drawing spec extraction:**
```javascript
// services/ai/drawing-analyzer.js
export async function extractSpecFromDrawing(drawingBase64, mediaType = "image/png") {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: drawingBase64 }
          },
          {
            type: "text",
            text: `You are a manufacturing engineering expert. Analyze this engineering drawing and extract:
            1. Material specification
            2. Manufacturing process (machined / cast / stamped / injection molded / welded / etc.)
            3. Key dimensions (envelope: L x W x H in mm)
            4. Critical tolerances (tightest tolerance found)
            5. Surface finish requirements
            6. Heat treatment or coating requirements
            
            Return ONLY valid JSON: {
              "material": "",
              "process": "",
              "dimensions_mm": {"L": 0, "W": 0, "H": 0},
              "tightest_tolerance_mm": 0,
              "surface_finish_ra": 0,
              "heat_treatment": "",
              "coating": "",
              "complexity": "simple|medium|complex"
            }`
          }
        ]
      }]
    })
  });
  const data = await response.json();
  return JSON.parse(data.content[0].text);
}
```

**Claude API call for VAVE ideation:**
```javascript
// services/ai/ideation-engine.js
export async function generateVAVEIdeas(focusAreaReport, shouldCostGaps, supplierData) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: `You are a senior Value Engineering expert with 20 years of experience.
        
Focus Areas (high cost parts/assemblies):
${JSON.stringify(focusAreaReport)}

Should Cost Gaps (opportunities):
${JSON.stringify(shouldCostGaps)}

Supplier Context:
${JSON.stringify(supplierData)}

Generate 10 VAVE ideas using SCAMPER and TRIZ frameworks. 
Return ONLY a JSON array (no preamble, no markdown):
[{
  "title": "",
  "framework": "SCAMPER|TRIZ|FAST",
  "scamper_type": "Substitute|Combine|Adapt|Modify|Put to other use|Eliminate|Rearrange",
  "description": "",
  "affected_parts": ["part_number"],
  "implementation": "What needs to change (design/material/process/supplier)",
  "est_savings_usd_annual": 0,
  "est_investment_usd": 0,
  "feasibility": "High|Medium|Low",
  "complexity": "L1|L2|L3",
  "risk": "High|Medium|Low",
  "time_to_implement_months": 0
}]`
      }]
    })
  });
  const data = await response.json();
  const text = data.content[0].text.replace(/```json|```/g, "").trim();
  return JSON.parse(text);
}
```

---

## 10. Recommended Tech Stack for Mithran Integration

| Layer | Technology |
|---|---|
| Backend | Node.js / Express OR Python FastAPI (match existing Mithran stack) |
| Database | PostgreSQL (extend existing Mithran DB) |
| AI | Anthropic Claude API (vision + text), OpenAI GPT-4o (GPT Agent tasks) |
| ETL / Scheduling | Apache Airflow or Node-cron for ERP/PLM sync |
| File Storage | AWS S3 / MinIO for drawings, reports |
| Report Generation | Puppeteer (PDF), ExcelJS (XLSX), pptxgenjs (PPTX) |
| Charts | Recharts or Chart.js (frontend), Matplotlib/Plotly (server-side in reports) |
| Frontend | React (match Mithran's existing frontend framework) |
| Auth | Extend Mithran's existing auth (module-level licensing per customer) |

---

## 11. Licensing / Commercialization Strategy

Structure the VAVE module as a **tiered add-on license** to Mithran:

| Tier | Includes | Target Price |
|---|---|---|
| **VAVE Starter** | Phase 1 (Data Acquisition) only | $X/month |
| **VAVE Intelligence** | Phase 1 + Phase 2 (AI Analysis + Ideation) | $XX/month |
| **VAVE Complete** | All 3 Phases + Business Case Generator | $XXX/month |
| **VAVE Enterprise** | All phases + Custom ERP/PLM connectors + Onboarding | Custom |

Key selling points for enterprise pitch:
- **30–40% faster** time-to-savings vs. manual VAVE process
- **≥90% accuracy** in cost extraction vs. manual spec reading
- **50–70% less time** building BOMs and cost models
- Directly integrates into customer's ERP/PLM — no data re-entry
- AI-generated negotiation decks ready for supplier meetings

---

## 12. Development Roadmap

### Sprint 1–2 (Weeks 1–4): Foundation
- [ ] Set up VAVE module folder structure in Mithran repo
- [ ] Create DB schema (vave_projects, vave_bom, vave_ideas, vave_should_costs)
- [ ] Build ERP connector (BOM extraction endpoint)
- [ ] Build basic BOM Explorer UI

### Sprint 3–4 (Weeks 5–8): Phase 1 Complete
- [ ] PLM connector (drawing fetch + S3 storage)
- [ ] Wayfinder supplier spend connector
- [ ] Drawing analysis AI endpoint (Claude Vision)
- [ ] Phase 1 dashboard with data sync status

### Sprint 5–7 (Weeks 9–14): Phase 2 AI Engine
- [ ] Pareto cost analysis + chart UI
- [ ] Supplier spend analysis
- [ ] Should cost model (bottom-up calculator)
- [ ] SCAMPER/TRIZ ideation AI endpoint
- [ ] Idea Repository UI (Kanban)

### Sprint 8–9 (Weeks 15–18): Phase 3 + Reports
- [ ] 4-block prioritization UI
- [ ] Business case generator (ROI calculator)
- [ ] PDF report generation (A3, Business Case, Gantt)
- [ ] Full end-to-end test on sample VAVE project

### Sprint 10 (Weeks 19–20): Polish + Launch
- [ ] Module licensing / feature flags
- [ ] Customer onboarding flow
- [ ] Demo dataset for sales pilots
- [ ] Documentation + API docs

---

## 13. File & Folder Structure (Mithran Repo)

```
mithran/
└── modules/
    └── vave/
        ├── README.md               ← This document
        ├── backend/
        │   ├── routes/
        │   │   ├── phase1.js       ERP/PLM/Supplier sync routes
        │   │   ├── phase2.js       Analysis + Ideation routes
        │   │   └── phase3.js       Scoping + Business case routes
        │   ├── services/
        │   │   ├── erp-connector.js
        │   │   ├── plm-connector.js
        │   │   ├── supplier-connector.js
        │   │   ├── ai/
        │   │   │   ├── drawing-analyzer.js   Claude Vision
        │   │   │   ├── cost-analyzer.js      GPT Agent
        │   │   │   └── ideation-engine.js    SCAMPER/TRIZ AI
        │   │   ├── should-cost.js
        │   │   └── report-generator.js       PDF/XLSX/PPTX
        │   └── db/
        │       └── migrations/
        │           └── 001_vave_schema.sql
        ├── frontend/
        │   ├── pages/
        │   │   ├── VaveDashboard.jsx
        │   │   ├── BomExplorer.jsx
        │   │   ├── CostAnalysis.jsx
        │   │   ├── IdeaRepository.jsx
        │   │   ├── PrioritizationMatrix.jsx
        │   │   └── BusinessCaseGenerator.jsx
        │   └── components/
        │       ├── ParetoChart.jsx
        │       ├── CostWaterfall.jsx
        │       ├── IdeaCard.jsx
        │       ├── FourBlockMatrix.jsx
        │       └── RoiCalculator.jsx
        └── tests/
            ├── phase1.test.js
            ├── phase2.test.js
            └── phase3.test.js
```

---

*Built for Mithran Manufacturing OS — VAVE CoE AI & Automation Journey 2026*  
*"Automate Insight. Accelerate Value. Scale VAVE."*
