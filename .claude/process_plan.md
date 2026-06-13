                                                                                                                               Here is Claude's plan:                                                                                                              
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 Mithran — AI Process Plan & Cost Generator ("Better than aPriori")                                                                  
                                                                                                                                     
 Context                                                                                                                             
                                                                                                                                     
 Today, a user opens a BOM item in Process Planning and manually adds rows to five tables: Raw Materials, Manufacturing Processes,   
 Packaging & Logistics, Procured Parts, Tooling & Fixtures. Each row requires choosing a material from the master, a calculator, a
 machine (MHR), a labour band (LHR), entering setup/cycle/batch numbers, and picking the right process operation from the
 hierarchical catalog. Done correctly it takes 20–40 minutes per part. aPriori automates this with a rules engine but is rigid,
 US-centric, and opaque about why it chose a particular machine or rate.

 We will add a "Generate Process Plan" action on the active BOM item that uses Claude (already integrated, claude-sonnet-4-6) in a
 grounded tool-use loop against the platform's own master data (raw_materials, mhr_records, lsr_records, processes, calculators)
 plus the existing CAD/DFM analysis. The model produces a draft containing proposed lines for all five sections (with reasoning per
 line); the user reviews/edits in a side panel and clicks Apply to commit them atomically. When a needed master row doesn't exist,
 the LLM proposes adding it to the master — the user approves before that write.

 This is "better than aPriori" because: (1) it's grounded in the user's own India-localised rates and masters, not a generic cost
 library; (2) every line carries an auditable reason; (3) it actively grows the user's masters over time; (4) it's DFM-aware (uses
 hole/pocket/thin-wall/undercut counts from the existing cad-engine); (5) it covers the full route + tooling + logistics + procured
 parts, not just primary process.

 Product decisions (confirmed):
 - Draft → review → Apply (one transaction).
 - Master-data gap → propose-new-row, ask before writing to masters.
 - Scope: just the active BOM item (whole-project batch is Phase 2 once BullMQ is added).

 ---
 Architecture

 High-level flow

 User clicks "Generate Process Plan" on active BOM item
    │
    ▼
 [1] POST /api/v1/process-plan-generator/:bomItemId/generate
    │  → creates `process_plan_generations` row (status=running, idempotency key)
    │  → loads BOM item + project + organization (tenant guard)
    │  → ensures cad-engine DFM features exist (call analyze-for-autofill if stale)
    │  → builds "engineering brief" (geometry, material hint, annual volume, DFM features, location)
    │
    ▼
 [2] Orchestrator opens Claude session
    │  - System prompt: India manufacturing context, calculator catalog, schema for proposed lines
    │  - Tool catalog: lookup_* (read-only) + propose_* (typed, validated) + propose_master_row
    │  - Prompt caching enabled on system prompt + tool defs (they're large and stable)
    │
    ▼
 [3] Claude tool-use loop (server-side, streamed back via SSE)
    │  Claude reasons → calls lookup tools → calls propose_* tools
    │  Each tool result is logged to generations.tool_calls (JSONB)
    │  Hard caps: 25 tool calls max, 60K token budget, 90s wall-clock
    │
    ▼
 [4] Claude emits final summary; orchestrator stores draft (status=draft_ready)
    │  Response: { generationId, draftLines[], proposedMasters[], reasoning, costPreview }
    │
    ▼
 [5] Frontend side panel renders draft
    │  User edits/removes lines, accepts/rejects proposed masters
    │
    ▼
 [6] POST /api/v1/process-plan-generator/generations/:id/apply
    │  - Postgres transaction:
    │     a) Insert approved proposed_masters into raw_materials / processes
    │     b) Insert all draft lines into the 5 cost-record tables
    │     c) Mark bom_item_costs.is_stale=true (existing recalc flag triggers aggregation)
    │     d) Update generation row → status=applied, applied_lines snapshot
    │  - Charge credits (one debit at apply time, not at generate, so a discarded draft is free)
    │
    ▼
 [7] Frontend invalidates React Query keys for the 5 sections → tables refresh

 Why tool use, not single-shot JSON

 A single-shot "give me the whole plan as JSON" approach fails for three reasons:
 1. Hallucinated IDs — Claude would invent material_id UUIDs that don't exist in raw_materials.
 2. Stale grounding — Stuffing all masters into the prompt is expensive and gets pruned by attention.
 3. No auditability — There's no record of why the model chose what it chose.

 With tool use, the model must call lookup_raw_material(group, query) before it can reference a material; the lookup returns real
 rows with real IDs. Each tool call is logged. The propose tools are typed against the existing Create<X>CostDto shapes, so the JSON
  the model emits is the same DTO the controllers already accept.

 Why backend computes costs, not the LLM

 The platform already has ProcessCostCalculationEngine, raw-material gross/scrap formulas, and tooling amortization. The LLM
 populates inputs only (gross_usage, scrap_percentage, setup_time_minutes, cycle_time_seconds, parts_per_cycle, unit_cost,
 amortization_parts, etc.). Backend re-derives total_cost after persist via the existing bom_item_costs aggregation. This avoids the
  LLM fighting the calculator and guarantees cost math is identical to manual-entry flow.

 ---
 Critical files

 New — backend (NestJS module)

 backend/src/modules/process-plan-generator/
 ├── process-plan-generator.module.ts
 ├── process-plan-generator.controller.ts        # 3 routes (generate, get, apply)
 ├── services/
 │   ├── orchestrator.service.ts                 # Claude tool-use loop
 │   ├── grounding.service.ts                    # builds engineering brief (BOM + DFM)
 │   ├── persistence.service.ts                  # transactional apply
 │   ├── credit-meter.service.ts                 # debit at apply, refund on failure
 │   └── tools/
 │       ├── lookup-raw-material.tool.ts         # wraps raw-materials/grouped
 │       ├── lookup-machine.tool.ts              # wraps mhr.service
 │       ├── lookup-labour.tool.ts               # wraps lsr.service
 │       ├── lookup-process-operations.tool.ts   # wraps processes hierarchical
 │       ├── lookup-calculator.tool.ts           # wraps calculators.service
 │       ├── propose-raw-material-line.tool.ts   # validates → draft
 │       ├── propose-process-line.tool.ts
 │       ├── propose-tooling-line.tool.ts
 │       ├── propose-logistics-line.tool.ts
 │       ├── propose-procured-part-line.tool.ts
 │       └── propose-master-row.tool.ts          # new master (raw_material | process)
 ├── dto/
 │   ├── generate-request.dto.ts
 │   ├── draft-line.dto.ts                       # discriminated union for 5 line types
 │   ├── apply-request.dto.ts
 │   └── generation-response.dto.ts
 └── prompts/
     ├── system.prompt.ts                        # India manufacturing context + reasoning rubric
     └── tool-schemas.ts                         # Claude tool-input JSON Schemas (mirror DTOs)

 New — DB migration

 backend/src/database/migrations/<next>_process_plan_generations.ts

 CREATE TABLE process_plan_generations (
   id              UUID PRIMARY KEY,
   bom_item_id     UUID NOT NULL REFERENCES bom_items(id) ON DELETE CASCADE,
   user_id         UUID NOT NULL,
   organization_id UUID,
   status          TEXT NOT NULL CHECK (status IN ('running','draft_ready','applied','failed','discarded')),
   model           TEXT NOT NULL,                  -- e.g. 'claude-sonnet-4-6'
   idempotency_key TEXT UNIQUE,                    -- (bom_item_id, hash(brief)) — dedupes accidental double-clicks
   brief           JSONB NOT NULL,                 -- engineering brief sent to LLM
   tool_calls      JSONB NOT NULL DEFAULT '[]'::jsonb,
   draft_lines     JSONB,                          -- DraftLineDto[] before apply
   proposed_masters JSONB,                         -- new master rows proposed
   applied_line_ids JSONB,                         -- after apply: { rawMaterials: [...], processes: [...], ... }
   tokens_in       INTEGER,
   tokens_out      INTEGER,
   cache_read_tokens INTEGER,
   credit_cost     INTEGER,
   error_message   TEXT,
   started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   completed_at    TIMESTAMPTZ,
   applied_at      TIMESTAMPTZ
 );

 CREATE INDEX idx_ppg_bom_item ON process_plan_generations(bom_item_id, started_at DESC);
 CREATE INDEX idx_ppg_user_status ON process_plan_generations(user_id, status);

 New — frontend

 lib/api/hooks/useProcessPlanGenerate.ts          # 3 hooks: useGenerate, useGenerationStream, useApply

 components/features/process-planning/
 ├── GenerateProcessPlanButton.tsx                # the CTA, placed in green header (line 634–670)
 ├── GenerateProcessPlanPanel.tsx                 # side-sheet (Sheet component) draft review UI
 │   ├── DraftLineCard.tsx                        # one card per proposed line; edit, remove, reason
 │   ├── ProposedMasterCard.tsx                   # "NEW MASTER" tile with approve/reject
 │   ├── GenerationStreamView.tsx                 # live tool-call log during streaming
 │   └── CostPreviewStrip.tsx                     # rolled-up cost before apply

 Modify

 ┌─────────────────────────────────────────────────────────┬─────────────────────────────────────────────────────────────────────┐
 │                          File                           │                               Change                                │
 ├─────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ app/(dashboard)/projects/[id]/process-planning/page.tsx │ Mount <GenerateProcessPlanButton bomItemId={...} /> in the green    │
 │                                                         │ header card (~line 634–670).                                        │
 ├─────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ backend/src/app.module.ts                               │ Register ProcessPlanGeneratorModule.                                │
 ├─────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ components/layout/MithranAICreditsBar.tsx               │ Add CR_PER_GENERATION = 50 constant for credit-bar math.            │
 ├─────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ lib/api/hooks/index.ts                                  │ Re-export new hooks.                                                │
 └─────────────────────────────────────────────────────────┴─────────────────────────────────────────────────────────────────────┘

 Reused, not modified (intentional — leverage existing surface)

 - CAD/DFM: POST /api/v1/bom-items/analyze-for-autofill (backend/src/modules/bom-items/services/auto-fill.service.ts) — orchestrator
  calls this if DFM features aren't cached. Reuses the same fallback STL bounding-box parser already in place.
 - Hierarchical lookups: GET /api/v1/raw-materials/grouped, GET /api/v1/mhr, GET /api/v1/lsr, GET /api/v1/processes, GET
 /api/v1/process-routes/:routeId/steps, GET /api/v1/calculators. The lookup_* tools are thin wrappers — no duplicate querying logic.
 - Cost engines: ProcessCostCalculationEngine (backend/src/modules/processes/engines/process-cost-calculation.engine.ts) and
 BomItemCostService (backend/src/modules/bom-items/services/bom-item-cost.service.ts) recompute after persist via the existing
 is_stale flag. No changes.
 - DTOs: CreateRawMaterialCostDto, CreateProcessCostDto, CreateToolingCostDto, CreatePackagingLogisticsCostDto,
 CreateProcuredPartsCostDto — used directly as the validated shape inside each propose_* tool. The LLM emits these JSON shapes; the
 existing controllers can already persist them.
 - Anthropic SDK: same pattern as app/api/vave/should-cost/route.ts. Reuse the same client instantiation and credit-debit helper.

 ---
 LLM contract details

 System prompt (key sections)

 1. Role: "Senior manufacturing engineer for an Indian shop. You build process plans grounded in the provided master data."
 2. Hard rules:
   - Always call lookup_* before any propose_* that references a master.
   - For each proposed line emit a reason (≤ 240 chars) citing the BOM evidence (geometry, DFM feature, annual volume) and the
 chosen master (machine name, material grade).
   - Numeric inputs only — never set total_cost (backend computes).
   - Currency is INR. Location defaults to organization location (e.g. India-Bangalore) unless masters point elsewhere.
   - If no good match exists after one lookup retry, call propose_master_row with an engineering-defensible default.
 3. Process route convention for India: primary process → secondary ops (drill/tap/deburr) → heat-treat (if hardness > 30 HRC) →
 surface finish (Ra-driven) → inspection. Encode this as a checklist.
 4. DFM mapping rubric: hole_count → drilling op count; pocket_count → milling op time; thin_wall_count → reduce feed, add
 inspection; undercut_count → consider EDM or T-slot mill.

 Tool catalog (Anthropic tool-use format)

 ┌────────────────────────────┬───────────────────────────────────────────────────────────┬─────────────────────────────────────┐
 │            Tool            │                          Purpose                          │               Returns               │
 ├────────────────────────────┼───────────────────────────────────────────────────────────┼─────────────────────────────────────┤
 │ lookup_raw_material        │ Search raw_materials by group + query + country           │ Top 5 rows with id, grade, cost,    │
 │                            │                                                           │ density, location                   │
 ├────────────────────────────┼───────────────────────────────────────────────────────────┼─────────────────────────────────────┤
 │ lookup_machine             │ Search mhr_records by process group + location            │ Top 5 machines with rate            │
 ├────────────────────────────┼───────────────────────────────────────────────────────────┼─────────────────────────────────────┤
 │ lookup_labour              │ Lookup lsr_records by skill level + location              │ All matching rows                   │
 ├────────────────────────────┼───────────────────────────────────────────────────────────┼─────────────────────────────────────┤
 │ lookup_process_operations  │ Drill into processes hierarchy (group → route → ops)      │ Operations with default times       │
 ├────────────────────────────┼───────────────────────────────────────────────────────────┼─────────────────────────────────────┤
 │ lookup_calculator          │ Find calculators by category (costing/material/process)   │ Calculator metadata with field      │
 │                            │                                                           │ definitions                         │
 ├────────────────────────────┼───────────────────────────────────────────────────────────┼─────────────────────────────────────┤
 │ propose_raw_material_line  │ Add a draft raw_material_cost_records row                 │ Echoes DraftLine id                 │
 ├────────────────────────────┼───────────────────────────────────────────────────────────┼─────────────────────────────────────┤
 │ propose_process_line       │ Add a draft process_cost_records row (includes            │ Echoes DraftLine id                 │
 │                            │ calculator_id, machine_id, labour_id)                     │                                     │
 ├────────────────────────────┼───────────────────────────────────────────────────────────┼─────────────────────────────────────┤
 │ propose_tooling_line       │ Add a draft tooling_cost_records row                      │ Echoes DraftLine id                 │
 ├────────────────────────────┼───────────────────────────────────────────────────────────┼─────────────────────────────────────┤
 │ propose_logistics_line     │ Add a draft packaging_logistics_cost_records row          │ Echoes DraftLine id                 │
 ├────────────────────────────┼───────────────────────────────────────────────────────────┼─────────────────────────────────────┤
 │ propose_procured_part_line │ Add a draft procured_parts_cost_records row               │ Echoes DraftLine id                 │
 ├────────────────────────────┼───────────────────────────────────────────────────────────┼─────────────────────────────────────┤
 │ propose_master_row         │ Propose a NEW raw_material or process row                 │ Echoes ProposedMaster id; line      │
 │                            │                                                           │ tools may then reference it         │
 └────────────────────────────┴───────────────────────────────────────────────────────────┴─────────────────────────────────────┘

 All propose_* tool inputs use Zod schemas mirroring the existing DTOs. Validation rejects malformed output before it touches the
 draft; the orchestrator returns the validation error to the LLM so it can correct itself within the tool-call budget.

 Prompt caching

 System prompt + tool definitions are stable per generation, so we mark them with cache_control: { type: "ephemeral" }. Per-call
 savings: ~80–90% on input tokens. Expected blended cost per generation: ~$0.06 INR-equivalent — well under the 50-credit
 allocation.

 ---
 Engineering quality gates

 ┌─────────────────┬────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │     Concern     │                                               Implementation                                               │
 ├─────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Tenant          │ Every lookup_* tool re-applies user_id + organization_id filter inside the wrapped service. LLM cannot     │
 │ isolation       │ bypass via parameter injection — the orchestrator overrides any tenant fields in tool inputs.              │
 ├─────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Atomicity       │ Apply step runs inside dataSource.transaction(...). If any insert fails, the whole apply rolls back and    │
 │                 │ generation.status stays draft_ready (user can retry apply).                                                │
 ├─────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Idempotency     │ idempotency_key = sha256(bom_item_id || canonical(brief)). Repeat generate within 60s on the same brief    │
 │                 │ returns the existing draft — prevents double-charge on accidental re-click.                                │
 ├─────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Credit          │ Debit happens at apply time, not generate time. Discarded drafts are free, which matches the user-trust    │
 │ accounting      │ model. Credit bar shows estimated cost during draft.                                                       │
 ├─────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Cost cap per    │ Hard caps: 25 tool calls, 60K total tokens, 90s wall clock. Orchestrator emits partial_draft status if cap │
 │ generation      │  hit so user still gets value.                                                                             │
 ├─────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ LLM failure /   │ Falls back to the existing deterministic auto-fill.service.ts path. Generation row marked status=failed    │
 │ timeout         │ with error_message; UI offers "Use deterministic fallback" CTA.                                            │
 ├─────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Validation      │ Zod schemas on (a) the generate request, (b) every tool input, (c) the apply request. Schemas mirror       │
 │                 │ existing class-validator DTOs — single source of truth in dto/.                                            │
 ├─────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │                 │ SSE endpoint streams tool_call_started, tool_call_result, draft_line_added, done, error events. Frontend   │
 │ Streaming       │ renders a live "what the engineer is doing" panel — this is the visible "better than aPriori" moment.      │
 │                 │ Cancellation via AbortController.                                                                          │
 ├─────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │                 │ Every generation row is the audit log. Plus structured logs:                                               │
 │ Observability   │ generation.started/tool_call/completed/applied/failed with generationId, bomItemId, userId, tokens,        │
 │                 │ latency_ms. Pluggable into existing logger.                                                                │
 ├─────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Replay & "Why   │ The draft panel reads tool_calls JSONB and shows, per proposed line, which masters were considered and why │
 │ this?"          │  this one was chosen. This is the auditability feature aPriori lacks.                                      │
 ├─────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │                 │ Tool inputs are JSON-schema-validated before execution. No tool can write outside the generation's own     │
 │ Security        │ draft until apply. No tool runs arbitrary SQL or shell. Tenant filter is enforced in the wrapped service,  │
 │                 │ not trusted from the LLM.                                                                                  │
 ├─────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Backwards       │ Pure additive — no schema changes to existing tables, no behavior change to existing CRUD endpoints, no    │
 │ compatibility   │ change to the 5 section components. The new button is the only UI surface change.                          │
 └─────────────────┴────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

 ---
 UX details

 Header CTA (in the green card around page.tsx:634-670)

 ┌─ Complete BOM Details & Process Planning ─────────────── [Generate Process Plan ✨] [Edit All] ─┐

 The button shows ~50 credits next to it (matches existing credit bar weights). Disabled if no STL/STEP file uploaded (we need
 geometry).

 Draft panel (right-side Sheet, opens when generation completes)

 Process Plan Draft  ·  PIN-2-20260519-231                                          [×]
 Generated in 18.2s · 14 tool calls · est ₹47.20 unit cost
 ──────────────────────────────────────────────────────────────────────────────────
 Reasoning trail ▾   (collapsible — shows the 14 tool calls in order)

 Raw Materials (1)                                                       [+ Add line]
 ┌ Aluminum 6061-T6, India · 0.0027 kg net, 0.0033 kg gross (22% scrap)         ░ ✓ ┐
 │ Reason: Pin geometry + 1000 yr volume → low-cost wrought aluminum is the      │
 │         match. 6061-T6 stocked in your master (id …) at ₹342/kg.             │
 └────────────────────────────────────────────────────────── [edit] [remove] ────┘

 Manufacturing Processes (3)                                             [+ Add line]
 ┌ Op 10 · CNC Turning · ASC Lathe 320 ₹540/hr · Skilled ₹62/hr · 35s cycle    ░ ✓ ┐
 │ Reason: 19mm length cylindrical pin → turning primary. Chose your ASC Lathe  │
 │         (closest match in mhr_records). Cycle from DFM volume 515mm³ + …    │
 └──────────────────────────────────────────────────────────────────────────────┘
 … (Op 20 Drilling, Op 30 Deburr)

 Tooling (1) · Logistics (1) · Procured Parts (0)                                 ▸

 ⚠ Proposed new master row (1)
 ┌ NEW PROCESS · "Centerless grinding for tight-tolerance pins"                 ⚠ ┐
 │ Not in your processes table. Reason: IT8 tolerance + Ra 3.2 implies grind.   │
 │ Defaults: machine_required=Centerless Grinder, setup 20min, cycle 22s/pc.    │
 │                                                  [approve & add] [skip]      │
 └──────────────────────────────────────────────────────────────────────────────┘

 Estimated unit cost after apply: ₹47.20  (raw ₹0.92 + process ₹38.40 + tooling ₹2.08 + …)
                                                                   [Discard]  [Apply All]

 Generation in progress (streaming)

 A small status strip on the page shows: "Engineer is researching… lookup_raw_material → found 4 matches". Cancellable. This is the
 "wow" surface.

 ---
 Phasing

 Phase 1 (this plan, ~5 days of focused build):
 - DB migration for process_plan_generations.
 - Backend module + orchestrator + 11 tools + Zod schemas.
 - Frontend button + panel + streaming.
 - Single-item scope. India-localised system prompt.

 Phase 2 (follow-up, not in this plan):
 - Whole-project batch via BullMQ + Redis (Redis already wired, just no queue lib).
 - Re-generate on geometry change.
 - "Explain this cost" deep-dive (uses stored tool_calls to answer per-line questions).
 - VAVE integration — propose VA/VE alternatives at generation time.

 ---
 Verification

 End-to-end happy path

 1. cd backend && npm run db:migrate — confirm process_plan_generations exists.
 2. npm run dev (root) + npm run start:dev (backend).
 3. Open /projects/<id>/process-planning?bomItem=<pin-2>.
 4. Click Generate Process Plan.
 5. Watch streaming panel show ≥ 8 tool calls (at least one lookup_raw_material, one lookup_machine, three propose_*).
 6. Draft panel opens with ≥ 1 raw material, ≥ 2 process ops, ≥ 1 tooling line.
 7. Click Apply All. Confirm:
   - All five section tables render the new rows.
   - bom_item_costs.total_cost updates within 2s (the existing aggregator).
   - Credit bar decrements by 50.
   - process_plan_generations.status='applied', applied_line_ids populated.

 Failure paths to test

 - LLM timeout (mock 100s response) → row marked failed, UI offers deterministic fallback CTA, no credits charged.
 - Tool validation error (LLM emits invalid scrap_percentage=150) → tool returns error to LLM, retry happens within tool-call
 budget; if budget exhausted, partial draft delivered.
 - Apply transaction fails (e.g. FK to a material the user deleted between draft and apply) → full rollback, draft remains, user can
  edit and re-apply.
 - Tenant injection — craft a tool input with a foreign organization_id. Verify orchestrator overrides it.
 - Idempotency — double-click Generate within 60s. Verify only one process_plan_generations row exists.

 Unit tests

 - orchestrator.service.spec.ts — mocks Anthropic SDK, asserts tool-call → DraftLine mapping, asserts cap enforcement.
 - persistence.service.spec.ts — uses a test transaction; asserts rollback on partial failure.
 - One spec per tool — happy path + tenant-injection guard + validation rejection.

 Cost & latency baselines (capture in PR description)

 - Tokens in/out per generation (target: < 12K input with caching, < 4K output).
 - Wall-clock latency (target: P50 < 25s, P95 < 60s).
 - Cost per generation (target: < ₹5 raw LLM cost, charged as 50 credits ≈ ₹15 internal).
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

 Claude has written up a plan and is ready to execute. Would you like to proceed?

 ❯ 1. Yes, auto-accept edits
   2. Yes, manually approve edits
   3. No, refine with Ultraplan on Claude Code on the web
   4. Tell Claude what to change
      shift+tab to approve with this feedback