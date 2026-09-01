# Mithran Costing Module & BOM Management Architecture

## Overview

The costing and BOM management system is a **Domain-Driven Design (DDD)** micromodule architecture embedded within the NestJS monolith. It separates concerns into specialized services with clear responsibility boundaries.

---

## 1. System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Next.js React)                        │
│              BOM Viewer → Item Details → Manufacturing Intel            │
└────────────────────────────┬───────────────────────────────────────────┘
                             │
                ┌────────────┴────────────┐
                │                         │
        ┌───────▼───────┐        ┌────────▼────────┐
        │ BOM Management│        │ Cost Analysis   │
        │   Controller  │        │   Controller    │
        └───────┬───────┘        └────────┬────────┘
                │                         │
    ┌───────────┴──────────────────────────┴──────────────┐
    │                                                      │
┌───▼──────────────────────────┐    ┌──────────────────────▼─────┐
│  BOM Items Service           │    │  Cost Aggregation Service   │
│  ───────────────────          │    │  ────────────────────────   │
│  • Item CRUD                  │    │  • Compute BOM item cost    │
│  • Cost calculation trigger   │    │  • Location comparison      │
│  • DFM scoring               │    │  • Cost driver analysis     │
│  • Material intelligence      │    │  • Confidence metrics       │
└───┬──────────────────────────┘    └────────────────────────────┘
    │
    │ uses
    │
┌───▼──────────────────────────────────────────────────────────────┐
│                    Cost Engine (Pure Calculation)                │
│  ──────────────────────────────────────────────────              │
│  • Material cost synthesis                                        │
│  • Process line cost (setup + cycle + labor)                     │
│  • Multi-stage costing (raw material → finished part)            │
│  • Yield, scrap, overhead calculations                           │
│  • CO2 emissions + sustainability metrics                        │
│                                                                   │
│  Inputs from:                                                    │
│  ├─ Raw Materials DB (material cost/density/properties)          │
│  ├─ MHR Database (machine rates by class, commodity, location)   │
│  ├─ LHR Records (direct labor rates, QA rates)                   │
│  ├─ Calculators (physics-based cycle times)                      │
│  ├─ Sheet Metal Lookup (nest optimization, table lookups)        │
│  └─ Process Calculator Mappings (part family → calculator)       │
└────────────────────┬──────────────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
    ┌───▼────────────────┐   ┌────▼──────────────┐
    │ Sheet Metal Engine │   │ Process Planning  │
    │ • Nesting          │   │ • Route selection │
    │ • Cutting ops      │   │ • Cost by route   │
    │ • Bending          │   │ • DFM review      │
    │ • Inspection       │   │ • Manufacturabil. │
    └────────────────────┘   └───────────────────┘
        │                             │
        └──────────────┬──────────────┘
                       │
        ┌──────────────▼────────────────┐
        │    Supabase Database (RLS)    │
        │  ─────────────────────────    │
        │  • bom_items                  │
        │  • cost_records_{type}        │
        │  • process_plans              │
        │  • raw_materials              │
        │  • mhr_records                │
        │  • lhr_records                │
        │  • mhr_database               │
        │  • process_calculators        │
        └───────────────────────────────┘
```

---

## 2. Core Modules

### 2.1 BOM Items Module (`backend/src/modules/bom-items/`)

**Purpose**: Manages hierarchical BOM structure, triggers cost calculation, and orchestrates DFM analysis.

| Component | Responsibility |
|-----------|-----------------|
| **BOMItemsController** | REST API for item CRUD, cost retrieval, DFM scoring |
| **BOMItemsService** | Orchestration: item lifecycle, cost update triggers, entity validation |
| **BomItemCostService** | Wraps cost engine, caches results, handles retry logic |
| **CADAnalysisService** | Interfaces with external CAD engine (OCCT/Python) |
| **MaterialIntelligenceService** | Material substitution, sourcing candidates, sustainability |
| **DFMScoringService** | Manufacturability scoring, risk detection, design hints |
| **AutoFillService** | Auto-populate cost fields from parent BOM or defaults |
| **FileStorageService** | STEP/CAD file upload and versioning |

**Key Files**:
- [backend/src/modules/bom-items/bom-items.service.ts](backend/src/modules/bom-items/bom-items.service.ts)
- [backend/src/modules/bom-items/services/bom-item-cost.service.ts](backend/src/modules/bom-items/services/bom-item-cost.service.ts)
- [backend/src/modules/bom-items/costing/](backend/src/modules/bom-items/costing/)

---

### 2.2 BOMs Module (`backend/src/modules/boms/`)

**Purpose**: BOM lifecycle management (create, version, aggregate child costs to parent).

| Component | Responsibility |
|-----------|-----------------|
| **BOMsController** | List/fetch BOMs, manage versions, export |
| **BOMsService** | BOM CRUD, cost aggregation (roll-up from items) |

**Data Flow**:
```
Project
  └─ BOM (version 1, 2, 3, ...)
       ├─ Item 1 (cost = material + process)
       ├─ Item 2 (cost = material + process)
       └─ Item N
    
  Total BOM cost = Sum of all item costs + assembly labor
```

---

### 2.3 Costing Module (`backend/src/modules/costing/`)

**Purpose**: Cost analysis, aggregation, and cross-location comparison (compute true cost to serve).

| Component | Responsibility |
|-----------|-----------------|
| **CostAggregationService** | Reads all cost record tables, computes cost breakdown, cost drivers |
| **LocationComparisonService** | Re-cost same route across 10 digital factory locations (MHR+LHR variance) |
| **CostAnalysisController** | REST API: `/api/cost-analysis/bom-item/:id` |

**Cost Drivers** (what breaks down a $100 part):
```
Raw Material:     $25 (25%)
Process Labor:    $15 (15%)
Tooling:          $10 (10%)
Procured Parts:   $30 (30%)
Packaging:        $5  (5%)
Overhead (SGA):   $10 (10%)
Profit Margin:    $5  (5%)
──────────────────────────
Selling Price:    $100
```

---

## 3. Cost Calculation Pipeline

### 3.1 Single BOM Item Cost Flow

```
User views BOM item detail page
  ↓
Frontend calls: GET /api/v1/bom-items/:id
  ↓
BOMItemsService.findOne(id)
  ├─ Fetches bom_items row (geometry, material, process plan selection)
  ├─ Calls BomItemCostService.calculateCost(item)
  │   ├─ Resolves Material: raw_materials lookup + cost/kg
  │   ├─ Resolves Process: selected process_plan + cost steps
  │   ├─ Resolves MHR rates: mhr_database by machine class + location
  │   ├─ Resolves LHR rates: lhr_records by category
  │   ├─ Calls computeCostSummary() from cost-engine.ts
  │   │   └─ Returns: {material, process, tooling, packaging, procured}
  │   ├─ Applies markups: overhead + profit margin
  │   └─ Returns CostSummaryDto
  │
  └─ Returns BOMItemResponseDto with nested cost

User exports BOM item for quote
  ↓
Frontend calls: GET /api/cost-analysis/bom-item/:id
  ↓
CostAggregationService.computeBomItemCost(id)
  ├─ Reads 5 cost record tables (optimized queries)
  ├─ Aggregates: material_cost_records, process_cost_records, etc.
  ├─ Computes cost drivers (top 5 by % of MFG cost)
  ├─ Confidence assessment (material, routing, cycle time, supplier)
  ├─ Process lines detail (opNbr, machine, labor, cycle, setup, per-unit)
  └─ Returns BomItemCostDto (used in PDF export / quotes)
```

---

### 3.2 Multi-Part BOM Cost Roll-Up

```
BOM (parent)
  ├─ Subassembly A (child)
  │   ├─ Item A1: cost = $10
  │   ├─ Item A2: cost = $5
  │   └─ Assembly labor: $3 → Subassembly A total = $18
  │
  └─ Subassembly B (child)
      ├─ Item B1: cost = $20
      ├─ Item B2: cost = $8
      └─ Assembly labor: $2 → Subassembly B total = $30

Final BOM cost = $18 (A) + $30 (B) + Assembly labor (top level) = ~$50
```

---

## 4. Cost Engine (`backend/src/modules/bom-items/costing/shared/core/cost-engine.ts`)

### 4.1 Design Principles

1. **Pure Calculation** — No database access; all inputs pre-resolved
2. **Sheet Metal Specialist** — Optimized for laser-cut / press-brake parts
3. **Physics-Based** — Cycle times from manufacturing physics calculators, not lookup tables
4. **Transparency** — Every cost line logged with sources (MHR rate, calculator version, confidence)
5. **Sustainability** — Tracks CO2 per operation, material recyclability

### 4.2 Input Structure

```typescript
interface CostEngineInput {
  // ── Geometry ──────────────────
  sheetThicknessMm: number
  cutLengthMm: number
  flatPatternAreaMm2: number
  holeCount: number
  bendCount: number
  pierceCount: number

  // ── Material ───────────────────
  materialGrade: string
  materialCostPerKg: number
  materialDensityKgM3: number
  scrapPricePerKg?: number

  // ── Labor & Machine ────────────
  directLaborRatePerHr?: number      // DLR from lhr_records
  mhrRates?: {
    laser: MHRRateInput
    pressBrake: MHRRateInput
    tapping: MHRRateInput
    deburring: MHRRateInput
    // ... etc
  }

  // ── Cycle Times (from calculators) ──
  laserCycleTimeSecFromCalculator?: number
  pressBrakeCycleTimeSecFromCalculator?: number
  tappingCycleTimeSecFromCalculator?: number
  // ... resolved via resolvePhysicsQuantity() once only

  // ── Process Route ──────────────
  threads: Array<{ size, count, pitchMm?, depthMm? }>
  family: string
  batchSize: number

  // ── Features ───────────────────
  counterboreCount?: number
  countersinkCount?: number
  pemCount?: number
  extrudedFlangeCount?: number
}
```

### 4.3 Output Structure

```typescript
interface CostSummaryDto {
  // ── Cost Components ────────────────────
  material_cost: number
  process_cost: number
  tooling_cost: number
  packaging_cost: number
  procured_part_cost: number
  overhead_cost: number
  total_manufacturing_cost: number
  selling_price: number

  // ── Process Line Detail ────────────────
  process_lines: ProcessLineCost[]  // one per operation
  // ProcessLineCost: {
  //   opNbr, operation, processGroup,
  //   machine_rate, labor_rate, cycle_time_sec, setup_time_min,
  //   setup_cost_per_part, cycle_cost_per_part
  // }

  // ── Confidence & Physics Gaps ──────────
  confidence: ConfidenceLevel
  physics_gaps: PhysicsGap[]  // e.g., "laser cycle time missing → used fallback"

  // ── Sustainability ────────────────────
  sustainability: SustainabilitySummaryDto
  // { total_co2_kg, material_recyclability_pct, water_usage_liters }
}
```

---

## 5. Cost Record Storage (Denormalization)

Mithran stores calculated costs in **5 denormalized record tables** for fast retrieval:

| Table | Purpose | Refreshed When |
|-------|---------|----------------|
| `material_cost_records` | Raw material cost breakdown | Material changed |
| `process_cost_records` | Process labor + machine cost per operation | Process plan changed |
| `tooling_cost_records` | Tooling amortization | Item design changed |
| `packaging_cost_records` | Shipping/packaging labor | Shipping method changed |
| `procured_part_cost_records` | Vendor quotes for subcomponents | Supplier changed |

**Why denormalize?**
- Cost queries are **read-heavy** (exports, dashboards, quotes)
- Aggregation across 1000s of BOM items is expensive
- Cost is a **slowly-changing dimension** (not per-request computation)
- Audit trail: each record has `calculated_at` timestamp

---

## 6. MHR (Machine Hour Rate) Integration

### 6.1 MHR Data Model

```
mhr_database
├─ record_id (UUID)
├─ machine_class (e.g., "Laser Cutter 3.5kW")
├─ commodity_code (e.g., "1.2.3" → Sheet Metal)
├─ location_id (e.g., "us-east-1", "india-hyderabad")
├─ hourly_rate_usd (e.g., $45/hr)
├─ effective_from (date)
├─ effective_to (date)
├─ source (e.g., "benchmark_override", "default_rate")
└─ confidence_level (e.g., "high", "medium", "low")

lhr_records  (Labor Hour Rate)
├─ labor_category (e.g., "direct_labor", "qa_inspector")
├─ location_id
├─ hourly_rate_usd
├─ effective_from / effective_to
└─ source
```

### 6.2 MHR Rate Selection Logic

When calculating cost for a laser-cut part in **India Hyderabad** location:

```
1. Query: mhr_database
   WHERE machine_class = "Laser Cutter 3.5kW"
     AND commodity_code = "1.2.3" (Sheet Metal)
     AND location_id = "india-hyderabad"
     AND effective_from <= TODAY <= effective_to

2. If found:
   rate = rate from DB
   source = "mhr_database"
   confidence = "high"

3. If not found, fallback chain:
   a) Try default for machine class (no commodity filter)
   b) Try tier-synthetic (interpolate from tier benchmark)
   c) Use hardcoded default rate ($25/hr)
   source = "default_rate" | "tier_synthetic" | "no_db_rate"
   confidence = "low"

4. User override available:
   source = "benchmark_override"
   confidence = "high" (user-validated)
```

---

## 7. Process Planning Integration

### 7.1 Process Route Selection

Each BOM item has **0..N process routes** (alternatives):

```
BOM Item: "Laser-cut bracket"
  ├─ Route 1 (fastest):
  │   └─ Process steps:
  │       1. Laser cutting → 30 sec
  │       2. Deburring → 45 sec
  │       └─ Cost: $8
  │
  └─ Route 2 (cheapest, slower):
      └─ Process steps:
          1. Punch press → 60 sec
          2. Deburring → 60 sec
          └─ Cost: $5

User selects Route 1 → Cost = $8 (locked in)
Cost engine recalculates if any input (material, labor rate) changes
```

### 7.2 Cost-to-Route Mapping

```
process_plan_generations
├─ bom_item_id
├─ process_route_id
├─ operation_1
├─ operation_2
├─ total_cycle_time_sec
├─ total_setup_time_min
├─ total_manufacturing_cost
├─ generated_at
└─ confidence_score

When user clicks "Apply Route":
  1. Save selected route ID to bom_items.selected_process_route_id
  2. Trigger BomItemCostService.calculateCost()
  3. Cost engine evaluates all operations in that route
  4. Store costs in process_cost_records table
  5. Update bom_items.total_cost
```

---

## 8. Cost Aggregation Query Patterns

### 8.1 Single BOM Item Cost (Real-Time)

```sql
-- Fetch all cost components for one item
SELECT 
  mcr.material_cost,
  pcr.process_cost,
  tcr.tooling_cost,
  pck.packaging_cost,
  proc.procured_part_cost
FROM bom_items bi
LEFT JOIN material_cost_records mcr ON bi.id = mcr.bom_item_id
LEFT JOIN process_cost_records pcr ON bi.id = pcr.bom_item_id
LEFT JOIN tooling_cost_records tcr ON bi.id = tcr.bom_item_id
LEFT JOIN packaging_cost_records pck ON bi.id = pck.bom_item_id
LEFT JOIN procured_part_cost_records proc ON bi.id = proc.bom_item_id
WHERE bi.id = $1
ORDER BY mcr.calculated_at DESC LIMIT 1;
```

### 8.2 Full BOM Roll-Up

```sql
-- Sum all items + assembly labor
SELECT 
  SUM(mcr.material_cost) as total_material,
  SUM(pcr.process_cost) as total_process,
  SUM(tcr.tooling_cost) as total_tooling,
  (SELECT labor_cost FROM assembly_labor WHERE bom_id = $1) as assembly_labor
FROM bom_items bi
LEFT JOIN material_cost_records mcr ON bi.bom_id = mcr.bom_id
LEFT JOIN process_cost_records pcr ON bi.bom_id = pcr.bom_id
LEFT JOIN tooling_cost_records tcr ON bi.bom_id = tcr.bom_id
WHERE bi.bom_id = $1;
```

### 8.3 Cost Drivers (What's Expensive?)

```sql
-- Top 5 cost drivers (processes, materials, procured parts)
WITH cost_by_item AS (
  SELECT 
    bi.name,
    bi.part_number,
    (COALESCE(mcr.material_cost, 0) +
     COALESCE(pcr.process_cost, 0) +
     COALESCE(tcr.tooling_cost, 0)) as total_cost
  FROM bom_items bi
  LEFT JOIN material_cost_records mcr ON bi.id = mcr.bom_item_id
  LEFT JOIN process_cost_records pcr ON bi.id = pcr.bom_item_id
  LEFT JOIN tooling_cost_records tcr ON bi.id = tcr.bom_item_id
  WHERE bi.bom_id = $1
)
SELECT name, part_number, total_cost,
  ROUND(100.0 * total_cost / (SELECT SUM(total_cost) FROM cost_by_item), 2) as pct_of_total
FROM cost_by_item
ORDER BY total_cost DESC
LIMIT 5;
```

---

## 9. Data Flow: API to Database

### Request: Create BOM Item with Cost Calculation

```
POST /api/v1/bom-items
{
  "bom_id": "abc-123",
  "part_number": "BR-001",
  "material_grade": "SS304",
  "process_family": "sheet-metal",
  "quantity_per_assembly": 2,
  "drawing_file": "bracket.step"
}

BOMItemsController.create()
  ↓
BOMItemsService.create()
  ├─ Validate inputs (material exists, BOM exists)
  ├─ Parse STEP geometry → CADAnalysisService
  │   └─ Calls Python FastAPI: POST /analyze → {thickness, length, areas, holes}
  ├─ Extract features: holes, bends, cuts
  ├─ Trigger cost calculation: BomItemCostService.calculateCost()
  │   ├─ Resolve Material: SELECT FROM raw_materials
  │   ├─ Resolve Process: SELECT FROM process_plans
  │   ├─ Resolve MHR: SELECT FROM mhr_database
  │   ├─ Resolve LHR: SELECT FROM lhr_records
  │   ├─ Resolve Calculators: SELECT FROM process_calculators
  │   ├─ Call computeCostSummary() → {material_cost, process_cost, ...}
  │   ├─ INSERT material_cost_records, process_cost_records, etc.
  │   └─ Return CostSummaryDto
  │
  ├─ Compute DFM score: DFMScoringService.score()
  │   └─ Returns {manufacturability_score, design_risks[], suggestions[]}
  │
  └─ INSERT bom_items row with cost_summary_id (FK to cost records)

Response 201:
{
  "id": "item-456",
  "part_number": "BR-001",
  "cost": {
    "material_cost": 2.50,
    "process_cost": 5.00,
    "total": 7.50,
    "confidence": "high",
    "confidence_factors": {
      "material": "high",
      "routing": "high",
      "cycle_time": "medium"
    }
  },
  "dfm_score": 82,
  "design_hints": ["Consider filleted corners for press brake", ...]
}
```

### Request: Export BOM with Cost Breakdown

```
GET /api/cost-analysis/bom-item/item-456

CostAnalysisController.getBomItemCost()
  ↓
CostAggregationService.computeBomItemCost()
  ├─ SELECT * FROM material_cost_records WHERE bom_item_id = item-456
  ├─ SELECT * FROM process_cost_records WHERE bom_item_id = item-456
  ├─ SELECT * FROM tooling_cost_records WHERE bom_item_id = item-456
  ├─ SELECT * FROM procured_part_cost_records WHERE bom_item_id = item-456
  ├─ Aggregate all cost components
  ├─ Compute cost drivers (top 5)
  ├─ Assess confidence (material %, routing %, cycle %)
  ├─ Expand process_lines:
  │   └─ [{opNbr: 1, operation: "Laser Cut", machine: "3.5kW",
  │        machineRate: 45, laborRate: 12, cycleTimeSec: 30, ...}, ...]
  │
  └─ Return BomItemCostDto

Response 200:
{
  "bomItemId": "item-456",
  "rawMaterialCost": 2.50,
  "processCost": 5.00,
  "toolingCost": 0.50,
  "manufacturingCost": 8.00,
  "sgaCost": 1.60,
  "sellingPrice": 12.00,
  "costDrivers": [
    { "label": "Laser cutting", "category": "process", "costPerPart": 4.00, "pctOfMfgCost": 50 },
    { "label": "SS304 sheet", "category": "raw_material", "costPerPart": 2.50, "pctOfMfgCost": 31 },
    { "label": "Deburring", "category": "process", "costPerPart": 1.00, "pctOfMfgCost": 13 }
  ],
  "processLines": [
    {
      "opNbr": 1,
      "operation": "Laser Cutting",
      "machineRate": 45.00,
      "laborRate": 12.00,
      "cycleTimeSec": 30,
      "setupTimeMin": 15,
      "cycleCostPerPart": 0.38,
      "setupCostPerPart": 3.00,
      "totalCostPerPart": 3.38
    },
    {
      "opNbr": 2,
      "operation": "Deburring",
      "machineRate": 0,
      "laborRate": 12.00,
      "cycleTimeSec": 45,
      "setupTimeMin": 5,
      "cycleCostPerPart": 0.15,
      "setupCostPerPart": 0.10,
      "totalCostPerPart": 0.25
    }
  ],
  "confidence": {
    "material": "high",
    "processRouting": "high",
    "cycleTime": "medium",
    "overall": 0.87
  }
}
```

---

## 10. Key Design Patterns

### 10.1 Cost Calculation Strategy

**Lazy Calculation + Eager Cache**
- Cost is **not** recalculated on every GET
- Only **triggered** when item changed (design, material, process, rate)
- Results stored in `*_cost_records` tables (indexed, fast read)
- Cache invalidation: DELETE old cost records before INSERT new ones

### 10.2 Confidence Scoring

Each cost has a **confidence breakdown**:

```
confidence = (
  material_confidence (90%) * 0.3 +    // Did we find material in DB?
  routing_confidence (85%) * 0.3 +     // Did we auto-generate the process?
  cycle_time_confidence (70%) * 0.2 +  // Did physics calculator work?
  supplier_confidence (95%) * 0.2      // Vendor quotes available?
) = ~85%

When confidence < 60% → "Red" warning: "Cost estimates unreliable"
When confidence 60-80% → "Yellow" caution: "Consider manual review"
When confidence > 80% → "Green" approved: "Suitable for quoting"
```

### 10.3 Physics Gap Tracking

Every cost line tracks why a fallback was needed:

```
{
  opNbr: 1,
  operation: "Laser Cutting",
  laserPhysicsGap: {
    reason: "calculator_unavailable",
    message: "No 'Sheet Metal - Laser Cutting' calculator found for 1.2mm SS304",
    fallback: "used_linear_regression_model",
    confidence: "low"
  }
}
```

---

## 11. Scalability Considerations

### Query Performance

- **Cost record tables**: Indexed on `bom_item_id`, `calculated_at`
- **BOM roll-up**: Materialized view `bom_costs_summary` refreshed hourly
- **Location comparison**: Denormalized to `location_cost_matrix` (10 × N cost variants)

### Storage

- 1000 BOM items × 5 cost record tables = 5000 rows
- Per row: ~50 columns (operations, rates, totals) = ~1.2 MB per item
- Full system (10k projects × 100k items) = ~1.2 TB cost data

### Update Flow

```
User changes material grade on Item 1
  ↓
BomItemsService detects change
  ├─ DELETE FROM material_cost_records WHERE bom_item_id = Item1
  ├─ DELETE FROM process_cost_records WHERE ... (process might change due to new material)
  ├─ Recalculate BomItemCostService.calculateCost(Item1)
  ├─ INSERT new cost records
  ├─ Update bom_items.updated_at (triggers BOM roll-up refresh)
  └─ Broadcast via Supabase Realtime → Frontend shows updated cost

Full chain: 50-200ms (fast enough for UI responsiveness)
```

---

## 12. API Reference Summary

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/bom-items/:id` | Fetch item + cost |
| POST | `/api/v1/bom-items` | Create item + auto-calculate |
| PATCH | `/api/v1/bom-items/:id` | Update item + recalculate cost |
| GET | `/api/v1/boms/:id` | Fetch BOM with roll-up totals |
| GET | `/api/cost-analysis/bom-item/:id` | Detailed cost breakdown (export) |
| GET | `/api/cost-analysis/bom-item/:id/location-comparison` | Re-cost across 10 locations |
| GET | `/api/v1/bom-items/:id/routes` | List alternative process routes |
| PATCH | `/api/v1/bom-items/:id/apply-route` | Select and lock a process route |

---

## 13. Error Handling

### Common Scenarios

```
Material not found in raw_materials
  → Cost flag: "material_uncertain"
  → Fallback: Use user-entered estimate (if provided)
  → Action: Display tooltip "Confirm material grade"

Process plan couldn't auto-generate
  → Cost flag: "routing_manual"
  → Fallback: Zero process cost (prompt user to select manually)
  → Action: Show "Process Planning" button in UI

MHR rate missing for location
  → Cost flag: "rate_estimated"
  → Fallback: Use tier benchmark or default rate
  → Action: Highlight in red; suggest "Contact MFG team for actual quote"

Cycle time calculator failed
  → Cost flag: "cycle_time_gap"
  → Fallback: Linear regression from similar parts
  → Action: Log warning; mark confidence "low"
```

---

## Summary

Mithran's costing architecture is built on **clear separation of concerns**:

- **BOM Items Module**: Item lifecycle, cost trigger, DFM
- **Cost Engine**: Pure calculation (no DB), physics-based, transparent
- **Cost Aggregation**: Denormalized queries, cost drivers, confidence scoring
- **MHR/LHR Integration**: Location-aware rates, fallback chain, benchmarking
- **Process Planning**: Route selection, multi-scenario analysis

This design enables **fast, accurate, auditable manufacturing costs** suitable for quoting, make-vs-buy decisions, and supply chain optimization.
