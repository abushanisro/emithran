# Mithran AI Feature PRD
**Project:** Mithran Manufacturing Platform  
**Version:** 1.0.0  
**Date:** March 2026  
**Status:** Ready for Implementation

---

## Overview

```
mithran ai-features --init

✓ Project: Mithran Manufacturing Platform
✓ Stack: Next.js + NestJS + Python FastAPI + Supabase
✓ CAD Engine: OpenCascade (existing)
✓ Features: 3 AI modules queued for implementation
```

---

## Feature Modules

```
mithran features --list

  [1] step-bom-extraction      STEP → Auto BOM Tree Generation
  [2] dfm-engine               Design for Manufacturing Analysis  
  [3] cost-engine              Geometry-based Cost Prediction

  Run: mithran implement --module <name>
```

---

## Module 1 — STEP → BOM Auto Extraction

```
mithran implement --module step-bom-extraction --describe
```

### What It Does

User uploads a STEP file. The system automatically walks the assembly
tree and generates a full hierarchical BOM that populates directly into
the existing Mithran BOM UI — with part numbers, quantities, types,
and AI-enriched metadata.

### Acceptance Criteria

```
mithran test --module step-bom-extraction --criteria

  ✓ STEP file with assembly → full BOM tree in < 30 seconds
  ✓ Single solid STEP → single Child Part node + warning
  ✓ Nested assemblies → correct parent/child relationships
  ✓ Duplicate parts counted → correct quantity per level
  ✓ Part number auto-generated (ASM / SUB / PRT prefix)
  ✓ AI material inference on all child parts
  ✓ Make/Buy default applied by rules
  ✓ BOM saved to Supabase bom_items table
  ✓ Frontend BOM tree renders without manual input
```

### System Flow

```
mithran flow --module step-bom-extraction

  POST /extract/bom (cad-engine FastAPI)
    │
    ├── [1] File Validation
    │         magic number check (.stp / .step)
    │         max file size: 100MB
    │         virus scan (optional)
    │
    ├── [2] CAD Parser
    │         OpenCascade STEPCAFControl_Reader
    │         reads product names, hierarchy, instances
    │
    ├── [3] Assembly Tree Walker
    │         recursive descent
    │         level 0 → Assembly
    │         level 1+ with children → Sub-Assembly
    │         level 1+ no children → Child Part
    │
    ├── [4] Quantity Counter
    │         group instances by part name per assembly
    │         set quantity = instance count
    │
    ├── [5] Part Number Generator
    │         ASM-001, ASM-002...
    │         SUB-001, SUB-002...
    │         PRT-001, PRT-002...
    │
    ├── [6] AI Enrichment (async, non-blocking)
    │         material inference (rules → LLM fallback)
    │         make/buy classification
    │         description generation
    │
    └── [7] Save to Supabase → return BOM JSON
```

### Data Schema Output

```json
{
  "assembly_name": "Main Assembly",
  "source_file": "main_assembly.step",
  "extracted_at": "2026-03-08T10:00:00Z",
  "bom_tree": [
    {
      "id": "uuid",
      "parent_id": null,
      "part_no": "ASM-001",
      "part_name": "Main Assembly",
      "type": "Assembly",
      "level": 0,
      "quantity": 1,
      "uom": "pcs",
      "material_grade": "6061-T6",
      "make_buy": "Make",
      "ai_confidence": 0.92,
      "children": [
        {
          "id": "uuid",
          "parent_id": "parent-uuid",
          "part_no": "SUB-001",
          "part_name": "Motor Sub-Assembly",
          "type": "Sub-Assembly",
          "level": 1,
          "quantity": 1,
          "children": [...]
        }
      ]
    }
  ]
}
```

### AI Enrichment Rules

```
mithran rules --module step-bom-extraction --enrichment

  MATERIAL INFERENCE
    priority 1: keyword match in part name
      "bracket", "plate", "housing" + context → AISI 304
      "bolt", "screw", "fastener"              → Grade 8.8
      "gear", "shaft", "rotor"                 → 1045 Steel
      "enclosure", "cover"                     → ABS / AL6061
    priority 2: parent material inheritance
    priority 3: LLM inference (Claude API)
    fallback: "Review Required"

  MAKE/BUY RULES
    has children                     → Make (Manufacturing)
    name matches standard parts DB   → Buy (Purchasing)
      (bolts, bearings, seals, PCBs...)
    no children + no match           → Make (flag for review)
```

### Edge Cases

```
mithran edge-cases --module step-bom-extraction

  CASE: single solid body STEP
    action: create 1x Child Part node
    warn: "No assembly structure detected"

  CASE: unnamed parts in STEP
    action: generate name from geometry type + tag ID
    flag: "Auto-named — review required"

  CASE: same part in multiple assemblies
    action: same part_no, different parent_id per instance
    note: matches your current UI (Bolt appears in both assemblies)

  CASE: STEP file > 100MB
    action: reject at validation layer
    message: "File too large — max 100MB"

  CASE: corrupted STEP file
    action: OpenCascade returns error
    message: "Invalid STEP file — re-export from CAD"
```

---

## Module 2 — DFM Engine (Design for Manufacturing)

```
mithran implement --module dfm-engine --describe
```

### What It Does

Analyzes extracted geometry from each STEP part and returns
manufacturability warnings, difficulty score, and human-readable
engineering feedback. Runs after BOM extraction automatically.

### Acceptance Criteria

```
mithran test --module dfm-engine --criteria

  ✓ Geometry features extracted per part (volume, walls, holes)
  ✓ DFM rules applied against ISO 2768 standards
  ✓ Manufacturability score 0.0 – 1.0 returned per part
  ✓ Warnings categorized (critical / warning / info)
  ✓ LLM generates plain English feedback per warning
  ✓ LLM only called when warnings exist (cost optimization)
  ✓ Results stored per bom_item in Supabase
  ✓ Frontend shows issue count badge on BOM tree nodes
```

### System Flow

```
mithran flow --module dfm-engine

  Triggered after BOM extraction for each Child Part
    │
    ├── [1] Geometry Extraction (OpenCascade)
    │         volume (mm³)
    │         surface area (mm²)
    │         bounding box (L x W x H)
    │         min wall thickness (mm)
    │         hole count + depth/diameter ratio
    │         pocket depth vs tool reach
    │         face count
    │
    ├── [2] DFM Rules Engine
    │         check each feature against ISO thresholds
    │         produce: warnings[], score (0.0–1.0)
    │
    ├── [3] Process Classifier
    │         geometry ratios → likely process
    │         CNC / Sheet Metal / Casting / 3D Print
    │
    └── [4] LLM Feedback (only if warnings > 0)
              input: warnings JSON + geometry data
              output: plain English engineering advice
              model: Claude API (claude-sonnet-4-6)
              cache: hash(geometry features) → skip repeat calls
```

### DFM Rules Table

```
mithran rules --module dfm-engine --table

  RULE                          THRESHOLD         SEVERITY
  ──────────────────────────────────────────────────────────
  Wall thickness (CNC)          < 0.8mm           CRITICAL
  Wall thickness (Cast)         < 2.0mm           CRITICAL
  Hole depth ratio              depth/dia > 10    WARNING
  Pocket depth (tool reach)     > 3x tool length  CRITICAL
  Hole spacing                  < 1.5x dia        WARNING
  Draft angle (casting)         < 1°              WARNING
  Surface finish complexity     > 50 faces        INFO
  Thin feature aspect ratio     > 4:1             WARNING
  Undercut detection            present           CRITICAL
```

### DFM Output Schema

```json
{
  "part_no": "PRT-001",
  "manufacturability_score": 0.72,
  "difficulty": "medium",
  "recommended_process": "CNC Machining",
  "warnings": [
    {
      "type": "CRITICAL",
      "code": "DFM-001",
      "message": "Wall thickness 0.6mm below CNC minimum 0.8mm",
      "location": "feature_face_12",
      "cost_impact_pct": 18
    }
  ],
  "llm_feedback": "The wall at face 12 is 0.6mm thick, which is below the recommended minimum of 0.8mm for CNC machining in aluminum. Consider increasing this wall to at least 1.0mm to improve tool stability and reduce scrap risk. This change would reduce estimated cost by approximately 18%.",
  "geometry": {
    "volume_mm3": 180000,
    "surface_area_mm2": 62000,
    "holes": 6,
    "min_wall_mm": 0.6,
    "bounding_box": "120x80x40"
  }
}
```

---

## Module 3 — Cost Engine

```
mithran implement --module cost-engine --describe
```

### What It Does

Calculates accurate part cost from geometry + your existing MHR data
in Supabase. Uses deterministic math formulas (no LLM). Trains an
XGBoost model on historical quotes once 50+ records exist.

### Acceptance Criteria

```
mithran test --module cost-engine --criteria

  ✓ Material cost calculated from volume + density + price/kg
  ✓ Machining cost calculated from MRR + your MHR rates (Supabase)
  ✓ Setup cost calculated from feature count
  ✓ Total cost stored per bom_item
  ✓ Cost breakdown visible in UI (material / machining / setup)
  ✓ XGBoost model trains when >= 50 quotes in DB
  ✓ ML correction factor applied on top of formula baseline
  ✓ Model version logged with every cost estimate
  ✓ No LLM in cost critical path
```

### Cost Formula Engine

```
mithran rules --module cost-engine --formulas

  MATERIAL COST
    = volume_cm3 × density_g_cm3 × price_per_kg / 1000
    + (bounding_box_volume - part_volume) × scrap_factor

  MACHINING COST
    = (volume_to_remove / MRR) × MHR
    where:
      volume_to_remove = bounding_box_vol - part_vol
      MRR = material removal rate (from materials DB)
      MHR = machine hour rate (from your Supabase)

  SETUP COST
    = base_setup_time × MHR
    + (hole_count × drill_setup_min / 60) × MHR
    + (pocket_count × pocket_setup_min / 60) × MHR

  OVERHEAD
    = (material + machining + setup) × overhead_pct

  TOTAL
    = material + machining + setup + overhead
```

### ML Layer (Phase 2 — after 50 quotes)

```
mithran ml --module cost-engine --describe

  MODEL: XGBoost regressor
  
  INPUT FEATURES:
    volume_mm3
    surface_area_mm2
    hole_count
    pocket_count
    min_wall_mm
    face_count
    material_id
    process_id
    quantity
    formula_cost_estimate     ← baseline from phase 1
    
  OUTPUT:
    cost_correction_factor    ← multiply against formula estimate
    confidence_score          ← 0.0–1.0
    
  TRAINING:
    source: historical quotes in Supabase
    retrain: monthly (cron job)
    min records: 50
    
  USAGE:
    final_cost = formula_cost × ml_correction_factor
    IF confidence < 0.6: use formula_cost only
```

### Data Tables Required in Supabase

```
mithran db --module cost-engine --schema

  materials_catalog
    id, name, grade, density_g_cm3,
    price_per_kg, mrr_mm3_per_min, updated_at

  machine_rates
    id, machine_name, process_type,
    mhr_per_hour, setup_time_base_min

  cost_estimates
    id, bom_item_id, material_cost, machining_cost,
    setup_cost, overhead, total_cost,
    formula_version, ml_model_version, created_at

  quote_history          ← for ML training
    id, bom_item_id, actual_cost, quoted_at,
    geometry_features_json
```

---

## Implementation Phases

```
mithran plan --all-modules --timeline

  PHASE 1 — Foundation (Weeks 1–3)
  ─────────────────────────────────
  week 1:  extend cad-engine → STEP assembly tree walker
  week 1:  BOM JSON output endpoint (/extract/bom)
  week 2:  NestJS: call cad-engine, save to Supabase
  week 2:  Frontend: auto-populate BOM tree from extraction
  week 3:  Part number generator + make/buy rules
  week 3:  Material keyword inference rules

  PHASE 2 — DFM Engine (Weeks 4–5)
  ───────────────────────────────────
  week 4:  Geometry feature extraction (OpenCascade analyzers)
  week 4:  DFM rules engine (ISO 2768 thresholds)
  week 5:  LLM feedback layer (Claude API, async)
  week 5:  Frontend: DFM badge + warning panel in BOM UI

  PHASE 3 — Cost Engine (Weeks 6–8)
  ────────────────────────────────────
  week 6:  Materials catalog + machine rates tables in Supabase
  week 6:  Formula cost engine (deterministic)
  week 7:  Cost breakdown UI in BOM items
  week 8:  XGBoost model scaffold (trains when data ready)

  PHASE 4 — LLM & Polish (Week 9–10)
  ─────────────────────────────────────
  week 9:  LLM enrichment: descriptions, material fallback
  week 9:  Response caching (geometry hash → skip repeat LLM)
  week 10: AI audit logging (model version per estimate)
  week 10: User review flags for low-confidence items
```

---

## Service Architecture

```
mithran architecture --show

  ┌─────────────────────────────────────────────┐
  │           Mithran Frontend (Next.js)        │
  │   BOM Tree UI  |  DFM Panel  |  Cost Panel  │
  └──────────────────────┬──────────────────────┘
                         │
  ┌──────────────────────▼──────────────────────┐
  │           NestJS Backend API                │
  │  /api/boms  |  /api/dfm  |  /api/costs      │
  └────────┬─────────────────────┬──────────────┘
           │                     │
  ┌────────▼──────────┐  ┌───────▼───────────┐
  │  cad-engine       │  │  Supabase          │
  │  (Python FastAPI) │  │  PostgreSQL + RLS  │
  │                   │  │                    │
  │  /extract/bom     │  │  bom_items         │
  │  /extract/dfm     │  │  cost_estimates    │
  │  /convert/step    │  │  materials_catalog │
  │                   │  │  machine_rates     │
  └────────┬──────────┘  │  quote_history     │
           │             └───────────────────┘
  ┌────────▼──────────┐
  │  ai-enrichment    │
  │  (async worker)   │
  │                   │
  │  Claude API       │
  │  XGBoost model    │
  └───────────────────┘
```

---

## Non-Functional Requirements

```
mithran requirements --non-functional

  PERFORMANCE
    BOM extraction (10MB STEP)   < 30 seconds
    DFM analysis per part        < 10 seconds
    Cost calculation             < 2 seconds
    LLM feedback (async)         < 15 seconds (non-blocking)
    API response (read)          < 200ms

  ACCURACY
    Geometry extraction          100% (deterministic, OpenCascade)
    Formula cost estimate        ± 20% (phase 1, no history)
    ML cost estimate             ± 10% (phase 3, 50+ quotes)
    Material inference (rules)   ~80% accuracy
    Material inference (LLM)     ~92% accuracy

  SECURITY
    STEP file validation         magic number + size limit
    AI output sanitization       never raw LLM to frontend
    Cost audit log               every estimate logged with model version
    RLS                          existing Supabase policy applies

  SCALABILITY
    STEP processing              queue-based (existing worker pattern)
    LLM calls                    async + cached by geometry hash
    ML model                     retrain monthly via cron
```

---

## What Uses LLM vs What Does Not

```
mithran audit --llm-usage

  USES LLM (Claude API)
  ─────────────────────
  ✓ Material grade inference (fallback only)
  ✓ DFM warning explanation in plain English
  ✓ Part description generation
  ✓ Make/Buy reasoning explanation
  ✓ User chat: "why is this part expensive?"

  DOES NOT USE LLM
  ─────────────────
  ✗ STEP geometry parsing       → OpenCascade
  ✗ Volume / surface area       → OpenCascade math
  ✗ Hole detection              → OpenCascade analyzers
  ✗ Cost formulas               → deterministic math
  ✗ Machine rates               → your Supabase data
  ✗ Material prices             → your materials_catalog table
  ✗ DFM threshold checks        → ISO rule engine
  ✗ Quantity counting           → assembly instance count
```

---

## Definition of Done

```
mithran done --check

  MODULE 1: step-bom-extraction
  [ ] Upload STEP → BOM tree renders in UI automatically
  [ ] Correct hierarchy (Assembly > Sub > Child)
  [ ] Correct quantities per level
  [ ] Part numbers generated (ASM / SUB / PRT)
  [ ] Material + make/buy populated
  [ ] Edge cases handled (single body, unnamed parts)

  MODULE 2: dfm-engine
  [ ] Geometry features extracted per Child Part
  [ ] ISO DFM rules applied
  [ ] Score 0–1 returned
  [ ] LLM feedback in plain English
  [ ] Warnings show in BOM UI

  MODULE 3: cost-engine
  [ ] Formula cost calculated from geometry + your DB rates
  [ ] Cost breakdown by material / machining / setup
  [ ] Costs stored per bom_item in Supabase
  [ ] XGBoost scaffold ready for training

  CROSS-CUTTING
  [ ] All AI inferences logged with confidence score
  [ ] LLM calls cached by geometry hash
  [ ] Model version stored with every cost estimate
  [ ] No LLM in cost critical path
```

---

*Mithran Manufacturing Platform — AI Feature PRD v1.0.0*  
*Generated: March 2026*
