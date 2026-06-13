                                                                                                                                     
● Plan revised. Key changes from your review:
                                                                                                                                     
  1. Tool explosion fixed — 11 propose tools collapsed to 2 (expand_candidates + save_draft). Typical generation now 1–3 tool calls, 
  not 20–25.
  2. Retrieval pre-ranking added — new Stage 1 RetrievalService + per-kind rankers produce top-N candidates before Claude opens.     
  Scales to 50k-row masters.                                                                                                       
  3. Reasoning separated from execution — three-stage pipeline (Brief → AbstractPlan → DraftLines). LLM uses symbolic candidateIds;
  backend resolver maps to real DB IDs. Hallucinated IDs become impossible.
  4. Launch scope guardrail — explicit Phase-1 coverage (CNC turn/mill, sheet metal, child parts). ScopeClassifierService soft-blocks
   castings/forgings/composites/assemblies with zero LLM cost.
  5. Feedback capture loop — new process_plan_line_edits table records every user edit with original-vs-new values. Becomes the
  offline-eval and per-customer-calibration dataset.

  Cost/latency targets accordingly tightened: P50 < 12s, < 12K cached input tokens, ≥ 80% of generations using a single tool call.

─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 Ready to code?
                                                                                                                                     
 Here is Claude's plan:
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 Mithran — AI Process Plan & Cost Generator ("Better than aPriori")                                                                

 Context

 Today, a user opens a BOM item in Process Planning and manually adds rows to five tables: Raw Materials, Manufacturing Processes,
 Packaging & Logistics, Procured Parts, Tooling & Fixtures. Each row requires choosing a material from the master, a calculator, a
 machine (MHR), a labour band (LHR), entering setup/cycle/batch numbers, and picking the right process operation from the
 hierarchical catalog. Done correctly it takes 20–40 minutes per part. aPriori automates this with a rules engine but is rigid,
 US-centric, and opaque about why it chose a particular machine or rate.

 We will add a "Generate Process Plan" action on the active BOM item that uses Claude (already integrated, claude-sonnet-4-6) as a
 grounded reasoner over the platform's own master data plus the existing CAD/DFM analysis. The model produces a draft with proposed
 lines for all five sections (with reasoning per line); the user reviews/edits in a side panel and clicks Apply to commit them
 atomically. When a needed master row doesn't exist, the LLM proposes adding it — the user approves before that write.

 Why this beats aPriori: grounded in the user's own India-localised rates; every line carries an auditable reason; actively grows
 the user's masters over time; DFM-aware via the existing cad-engine; covers the full route + tooling + logistics + procured parts,
 not just primary process.

 Product decisions (confirmed):
 - Draft → review → Apply (one transaction).
 - Master-data gap → propose-new-row, ask before writing to masters.
 - Scope: just the active BOM item (whole-project batch is Phase 2 once BullMQ is added).

 Launch scope guardrail (Phase 1):
 Cover only the part families the model can be ≥ 90% accurate on at launch. Wider coverage at 60% accuracy collapses user trust on
 day one.

 ┌───────────────────────────────────────────────┬───────────────────────────────────────────┐
 │                   In scope                    │          Out of scope (Phase 1)           │
 ├───────────────────────────────────────────────┼───────────────────────────────────────────┤
 │ CNC turned parts                              │ Castings (sand, die, investment)          │
 ├───────────────────────────────────────────────┼───────────────────────────────────────────┤
 │ CNC milled / machined parts                   │ Forging                                   │
 ├───────────────────────────────────────────────┼───────────────────────────────────────────┤
 │ Sheet metal (laser cut, bend, punch)          │ Composites / FRP                          │
 ├───────────────────────────────────────────────┼───────────────────────────────────────────┤
 │ Simple child parts (item_type = CHILD PART)   │ Complex assemblies (item_type = ASSEMBLY) │
 ├───────────────────────────────────────────────┼───────────────────────────────────────────┤
 │ Drilling, tapping, deburring as secondary ops │ Welded fabrications                       │
 └───────────────────────────────────────────────┴───────────────────────────────────────────┘

 If the orchestrator's classifier flags the part as out-of-scope (see "Scope gate" below), the button surfaces a soft block: "Phase
 1 doesn't yet cover castings. Use the deterministic auto-fill or fill manually." This is a deliberate trust-preservation move.

 ---
 Architecture — three-stage pipeline

 The earlier version of this plan used a 11-tool propose-per-line catalog. That produced a 20–25 tool-call explosion per generation.
  The revised architecture splits the work into three stages, with the LLM only handling stage 2 (reasoning). Stages 1 and 3 are
 deterministic backend code.

                 ┌─────────────────────────────────────────────────────────┐
    Stage 1      │  RETRIEVAL & SCOPE GATE  (deterministic, server-side)   │
    "Brief"      │  - Load BOM item + project + organization               │
                 │  - Ensure DFM features exist (call analyze-for-autofill │
                 │    if stale)                                            │
                 │  - Classify part family (turned / milled / sheet metal  │
                 │    / out-of-scope) using dims + DFM + material hint     │
                 │  - Pre-rank candidates against the user's masters:      │
                 │      • Top 8 raw_materials (group + location filter)    │
                 │      • Top 6 mhr_records (process family)               │
                 │      • Top 4 lsr_records (skill bands at location)      │
                 │      • Top 6 processes (matching family + DFM features) │
                 │      • Top 4 calculators (matching part family)         │
                 │  - Output: EngineeringBrief + CandidateSet              │
                 └─────────────────────────────────────────────────────────┘
                                           │
                                           ▼
                 ┌─────────────────────────────────────────────────────────┐
    Stage 2      │  REASONING  (Claude, abstract plan only)                │
    "Plan"       │                                                         │
                 │  System prompt + EngineeringBrief + CandidateSet are    │
                 │  marked cache_control=ephemeral (the big chunk).        │
                 │                                                         │
                 │  Tools available to Claude:                             │
                 │   - expand_candidates(kind, query)   # only if Stage 1  │
                 │                                       missed something  │
                 │   - save_draft(AbstractPlan)         # the only write   │
                 │                                                         │
                 │  Claude emits AbstractPlan with symbolic refs:          │
                 │   { rawMaterials: [{ candidateId: "rm-3",               │
                 │                      grossUsageKg, scrapPct, reason }], │
                 │     processes:   [{ candidateId: "op-2",                │
                 │                     machineCandidateId, labourBand,     │
                 │                     setupMin, cycleSec, scrapPct,       │
                 │                     calculatorCandidateId, reason }],   │
                 │     tooling: [...], logistics: [...],                   │
                 │     procuredParts: [...],                               │
                 │     proposedMasters: [...]                              │
                 │   }                                                     │
                 │                                                         │
                 │  Expected tool-call budget:                             │
                 │    - 0–2 expand_candidates calls for hard parts         │
                 │    - 1 save_draft                                       │
                 │    → typically 1–3 tool calls total (down from 20–25)   │
                 └─────────────────────────────────────────────────────────┘
                                           │
                                           ▼
                 ┌─────────────────────────────────────────────────────────┐
    Stage 3      │  RESOLVER  (deterministic, server-side)                 │
    "Draft"      │  - Map AbstractPlan.candidateId → real DB row IDs       │
                 │  - Validate each line against Create<X>CostDto (Zod)    │
                 │  - Reject lines that fail validation; surface to user   │
                 │  - Produce DraftLine[] + ProposedMaster[]               │
                 │  - Compute cost preview using existing engines          │
                 │  - Persist as process_plan_generations.draft_lines      │
                 │  - Stream draft to frontend                             │
                 └─────────────────────────────────────────────────────────┘
                                           │
                                           ▼
                                   User reviews → Apply
                                           │
                                           ▼
                 ┌─────────────────────────────────────────────────────────┐
    Stage 4      │  APPLY  (transactional, on user click)                  │
                 │  - Optionally insert approved proposed_masters          │
                 │  - Insert all draft lines into the 5 cost tables        │
                 │  - Mark bom_item_costs.is_stale=true → existing         │
                 │    aggregator recomputes                                │
                 │  - Capture LineEdit deltas (see "Feedback loop" below)  │
                 │  - Charge credits (one debit at apply; discards = free) │
                 └─────────────────────────────────────────────────────────┘

 Why this is cheaper, faster, and less hallucination-prone

 ┌──────────────────────────┬───────────────────────────────────────────┬───────────────────────────────────────────────────────┐
 │         Concern          │    Old design (propose-per-line tools)    │         New design (brief → reason → resolve)         │
 ├──────────────────────────┼───────────────────────────────────────────┼───────────────────────────────────────────────────────┤
 │ Tool calls per           │ 20–25 typical                             │ 1–3 typical                                           │
 │ generation               │                                           │                                                       │
 ├──────────────────────────┼───────────────────────────────────────────┼───────────────────────────────────────────────────────┤
 │ Input tokens (with       │ ~25–40K (every lookup result re-enters    │ ~8–12K (candidates resolved once, cached)             │
 │ caching)                 │ context)                                  │                                                       │
 ├──────────────────────────┼───────────────────────────────────────────┼───────────────────────────────────────────────────────┤
 │ Hallucinated IDs         │ Possible if model invents a UUID          │ Impossible — model uses symbolic candidateId, backend │
 │                          │                                           │  resolves                                             │
 ├──────────────────────────┼───────────────────────────────────────────┼───────────────────────────────────────────────────────┤
 │ Latency P50              │ ~25s                                      │ target < 12s                                          │
 ├──────────────────────────┼───────────────────────────────────────────┼───────────────────────────────────────────────────────┤
 │ Scale to 50k-row masters │ Lookup tools become noisy                 │ Retrieval pre-ranks; LLM sees only top-N              │
 └──────────────────────────┴───────────────────────────────────────────┴───────────────────────────────────────────────────────┘

 The candidate retrieval in Stage 1 is the most important architectural change. For large customer masters (50k materials, 20k
 machines), giving Claude raw lookup tools is unworkable. Pre-ranked candidate sets keep the prompt bounded regardless of customer
 size.

 ---
 Critical files

 New — backend (NestJS module)

 backend/src/modules/process-plan-generator/
 ├── process-plan-generator.module.ts
 ├── process-plan-generator.controller.ts        # 3 routes: generate, get, apply
 ├── services/
 │   ├── orchestrator.service.ts                 # ties stages 1–3 together
 │   ├── retrieval.service.ts                    # STAGE 1 — brief + candidate ranking
 │   ├── scope-classifier.service.ts             # STAGE 1 — in/out-of-scope gate
 │   ├── reasoning.service.ts                    # STAGE 2 — Claude session
 │   ├── resolver.service.ts                     # STAGE 3 — candidateId → DB IDs, validate
 │   ├── persistence.service.ts                  # STAGE 4 — transactional apply + edit capture
 │   ├── credit-meter.service.ts                 # debit at apply, refund on failure
 │   └── tools/
 │       ├── expand-candidates.tool.ts           # ONLY lookup tool exposed to Claude
 │       └── save-draft.tool.ts                  # ONLY write tool exposed to Claude
 ├── ranking/
 │   ├── material-ranker.ts                      # scores raw_materials vs brief
 │   ├── machine-ranker.ts                       # scores mhr_records vs process family
 │   ├── process-ranker.ts                       # scores processes vs DFM + family
 │   └── calculator-ranker.ts                    # scores calculators vs part family
 ├── dto/
 │   ├── engineering-brief.dto.ts                # output of Stage 1
 │   ├── candidate-set.dto.ts                    # top-N candidates per kind
 │   ├── abstract-plan.dto.ts                    # Stage 2 output (symbolic refs)
 │   ├── draft-line.dto.ts                       # Stage 3 output (resolved + validated)
 │   ├── apply-request.dto.ts
 │   └── generation-response.dto.ts
 └── prompts/
     ├── system.prompt.ts                        # India context + reasoning rubric + Phase-1 scope
     └── tool-schemas.ts                         # 2 tool defs

 New — DB migration

 backend/src/database/migrations/<next>_process_plan_generations.ts

 CREATE TABLE process_plan_generations (
   id              UUID PRIMARY KEY,
   bom_item_id     UUID NOT NULL REFERENCES bom_items(id) ON DELETE CASCADE,
   user_id         UUID NOT NULL,
   organization_id UUID,
   status          TEXT NOT NULL CHECK (status IN
                     ('running','draft_ready','applied','failed','discarded','out_of_scope')),
   model           TEXT NOT NULL,
   idempotency_key TEXT UNIQUE,                  -- sha256(bom_item_id || canonical(brief))
   scope_decision  JSONB NOT NULL,               -- { family, inScope: bool, reason }
   brief           JSONB NOT NULL,               -- EngineeringBrief sent to LLM
   candidates      JSONB NOT NULL,               -- CandidateSet (top-N per kind)
   tool_calls      JSONB NOT NULL DEFAULT '[]'::jsonb,
   abstract_plan   JSONB,                        -- Stage 2 output
   draft_lines     JSONB,                        -- Stage 3 output
   proposed_masters JSONB,
   applied_line_ids JSONB,
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

 -- Feedback capture: every edit a user makes to a generated line.
 -- This is the offline-eval / training dataset.
 CREATE TABLE process_plan_line_edits (
   id               UUID PRIMARY KEY,
   generation_id    UUID NOT NULL REFERENCES process_plan_generations(id) ON DELETE CASCADE,
   bom_item_id      UUID NOT NULL,
   user_id          UUID NOT NULL,
   line_kind        TEXT NOT NULL,              -- raw_material | process | tooling | logistics | procured_part
   line_index       INTEGER NOT NULL,           -- position within its draft array
   field_path       TEXT NOT NULL,              -- e.g. 'cycleTimeSeconds', 'machineId'
   original_value   JSONB,                      -- what LLM proposed
   new_value        JSONB,                      -- what user changed it to
   edit_reason      TEXT,                       -- optional free-text from user
   edited_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
 );

 CREATE INDEX idx_ppe_generation ON process_plan_line_edits(generation_id);
 CREATE INDEX idx_ppe_kind_field ON process_plan_line_edits(line_kind, field_path);

 New — frontend

 lib/api/hooks/useProcessPlanGenerate.ts          # useGenerate, useGenerationStream, useApply

 components/features/process-planning/
 ├── GenerateProcessPlanButton.tsx                # CTA in green header (~page.tsx:634)
 ├── GenerateProcessPlanPanel.tsx                 # right-side Sheet
 │   ├── DraftLineCard.tsx                        # edit/remove; captures LineEdit on every change
 │   ├── ProposedMasterCard.tsx                   # NEW MASTER tile with approve/reject
 │   ├── GenerationStreamView.tsx                 # live stage progress
 │   ├── CostPreviewStrip.tsx                     # rolled-up cost
 │   └── OutOfScopeNotice.tsx                     # "Castings not yet supported" state

 Modify

 ┌─────────────────────────────────────────────────────────┬─────────────────────────────────────────────────────────────────────┐
 │                          File                           │                               Change                                │
 ├─────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ app/(dashboard)/projects/[id]/process-planning/page.tsx │ Mount <GenerateProcessPlanButton bomItemId={...} /> in the green    │
 │                                                         │ header card (~line 634–670).                                        │
 ├─────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ backend/src/app.module.ts                               │ Register ProcessPlanGeneratorModule.                                │
 ├─────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ components/layout/MithranAICreditsBar.tsx               │ Add CR_PER_GENERATION = 50.                                         │
 ├─────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ lib/api/hooks/index.ts                                  │ Re-export new hooks.                                                │
 └─────────────────────────────────────────────────────────┴─────────────────────────────────────────────────────────────────────┘

 Reused, not modified

 - CAD/DFM: POST /api/v1/bom-items/analyze-for-autofill (backend/src/modules/bom-items/services/auto-fill.service.ts) — Stage 1
 calls this if features are stale. Same fallback STL bounding-box parser already in place.
 - Hierarchical lookups: GET /api/v1/raw-materials/grouped, GET /api/v1/mhr, GET /api/v1/lsr, GET /api/v1/processes, GET
 /api/v1/process-routes/:routeId/steps, GET /api/v1/calculators. The retrieval rankers call these services directly (no extra HTTP).
 - Cost engines: ProcessCostCalculationEngine (backend/src/modules/processes/engines/process-cost-calculation.engine.ts) and
 BomItemCostService recompute after persist via the existing is_stale flag.
 - DTOs: CreateRawMaterialCostDto, CreateProcessCostDto, CreateToolingCostDto, CreatePackagingLogisticsCostDto,
 CreateProcuredPartsCostDto — Stage 3 resolver outputs these directly.
 - Anthropic SDK: same pattern as app/api/vave/should-cost/route.ts.

 ---
 LLM contract — Stage 2 only

 System prompt sections

 1. Role: "Senior manufacturing engineer for an Indian shop. You produce process plans grounded in the candidate set provided. You
 do NOT compute final costs."
 2. Hard rules:
   - Reference candidates only by candidateId from the provided set. Never invent IDs.
   - If no candidate is acceptable, call expand_candidates(kind, refined_query) once per kind, then pick from the expanded set. If
 still none fit, use proposedMasters[] in your draft.
   - Numeric inputs only — never set total_cost.
   - For each line emit a reason (≤ 240 chars) citing BOM evidence (geometry, DFM feature, annual volume) and the chosen candidate.
   - One save_draft call ends the session.
 3. Phase-1 scope reminder: the brief contains scope.family. Tailor the plan to that family's conventions (turning route, milling
 route, sheet-metal route).
 4. Process route convention for India: primary process → secondary ops (drill/tap/deburr) → heat-treat (if hardness > 30 HRC) →
 surface finish (Ra-driven) → inspection.
 5. DFM mapping rubric: hole_count → drilling ops; pocket_count → milling time; thin_wall_count → reduce feed, add inspection;
 undercut_count → consider EDM or T-slot mill.

 Two tools exposed to Claude

 ┌───────────────────┬───────────────────────┬──────────────────────────────────────────────────────────────────────────────────┐
 │       Tool        │        Purpose        │                              Input schema (summary)                              │
 ├───────────────────┼───────────────────────┼──────────────────────────────────────────────────────────────────────────────────┤
 │                   │ One-shot widening if  │ { kind: 'rawMaterial'|'machine'|'labour'|'process'|'calculator', query: string } │
 │ expand_candidates │ Stage-1 ranking       │  → returns top 5 additional candidates                                           │
 │                   │ missed                │                                                                                  │
 ├───────────────────┼───────────────────────┼──────────────────────────────────────────────────────────────────────────────────┤
 │ save_draft        │ Final write of the    │ AbstractPlan JSON (Zod-validated)                                                │
 │                   │ abstract plan         │                                                                                  │
 └───────────────────┴───────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘

 save_draft input is a Zod schema that mirrors AbstractPlanDto. Validation rejects malformed output before Stage 3 ever runs;
 orchestrator returns the validation error to the LLM and re-prompts (max 2 retries). This is the only retry loop.

 Prompt caching

 System prompt + tool defs + EngineeringBrief + CandidateSet are marked cache_control: { type: "ephemeral" } as a single block. Hit
 rate after the first generation in a 5-min window: ~90% input savings.

 ---
 Engineering quality gates

 ┌───────────────────┬──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │      Concern      │                                              Implementation                                              │
 ├───────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Tenant isolation  │ Retrieval service applies user_id + organization_id filter at the SQL level. Candidates leaving Stage 1  │
 │                   │ are already tenant-scoped. Stage 3 resolver re-checks ownership of every resolved ID before persist.     │
 ├───────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Atomicity         │ Apply step runs inside dataSource.transaction(...). Any insert failure rolls back; generation.status     │
 │                   │ stays draft_ready so user can retry.                                                                     │
 ├───────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Idempotency       │ idempotency_key = sha256(bom_item_id || canonical(brief)). Repeat generate within 60s returns the        │
 │                   │ existing draft — prevents double-charge on misclicks.                                                    │
 ├───────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Credit accounting │ Debit at apply time, not generate. Discarded drafts are free. Out-of-scope generations are free.         │
 ├───────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Cost caps         │ 4 tool calls max (2 retries + 1 expand + 1 save), 30K total tokens, 45s wall clock. Caps are far looser  │
 │                   │ than needed in the common case — they're a safety net, not a normal limit.                               │
 ├───────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ LLM failure /     │ Falls back to deterministic auto-fill.service.ts. Generation row marked failed with error_message; UI    │
 │ timeout           │ offers "Use deterministic fallback" CTA.                                                                 │
 ├───────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Validation        │ Zod schemas on (a) generate request, (b) save_draft input (= AbstractPlan), (c) apply request. Schemas   │
 │                   │ mirror existing class-validator DTOs.                                                                    │
 ├───────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Streaming         │ SSE endpoint streams stage transitions and the abstract-plan emit. Frontend shows "Researching           │
 │                   │ candidates… Reasoning… Resolving… Draft ready." Cancellable via AbortController.                         │
 ├───────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │                   │ Every generation row is the audit log. Plus structured logs at each stage transition: retrieval.done,    │
 │ Observability     │ reasoning.tool_call, resolver.done, apply.done, with generationId, bomItemId, userId, tokens,            │
 │                   │ latency_ms.                                                                                              │
 ├───────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Replay & "Why     │ Draft panel reads brief, candidates, abstract_plan, and tool_calls from the generation row. Per-line     │
 │ this?"            │ drill-down shows the candidate set considered + the chosen one's reason.                                 │
 ├───────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │                   │ ScopeClassifierService decides in-scope vs out-of-scope before Stage 2. Decision + reason stored in      │
 │ Scope gate        │ scope_decision. Out-of-scope generations skip Claude entirely (zero LLM cost) and return                 │
 │                   │ OutOfScopeNotice payload.                                                                                │
 ├───────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │                   │ Tool inputs JSON-schema-validated before execution. expand_candidates query is parameterised — never     │
 │ Security          │ concatenated into SQL. No tool runs arbitrary SQL or shell. Tenant filter enforced in retrieval, not     │
 │                   │ trusted from LLM.                                                                                        │
 ├───────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Backwards         │ Pure additive. No schema changes to existing tables, no behavior change to existing CRUD endpoints, no   │
 │ compatibility     │ change to the 5 section components.                                                                      │
 └───────────────────┴──────────────────────────────────────────────────────────────────────────────────────────────────────────┘

 ---
 Feedback loop — the edit-capture dataset

 Every time a user modifies a draft line in the panel (changes a machine, edits cycle time, removes a tooling line), DraftLineCard
 posts a LineEdit to POST /api/v1/process-plan-generator/generations/:id/edits. Stored in process_plan_line_edits.

 What this unlocks:

 1. Offline eval set — top edited fields per line_kind show where the model is weakest. E.g., if cycleTimeSeconds is edited on 70%
 of milling lines but setupTimeMinutes only 10%, we know what to focus on.
 2. Per-customer calibration — over time, each customer's edit history can shift the system prompt with their preferences ("this
 customer always uses Skilled labour for drilling, never Highly Skilled").
 3. Regression tests — replay historical briefs through new model versions; diff against the accepted-after-edit final lines, not
 the original draft. Real accuracy metric.

 This table is the moat. Without it, the system never learns what engineers actually correct.

 ---
 UX details

 Header CTA (in the green card around page.tsx:634-670)

 ┌─ Complete BOM Details & Process Planning ────── [Generate Process Plan ✨ ~50 cr] [Edit All] ─┐

 Disabled if no STL/STEP file uploaded.

 Streaming status during generation

 Researching candidates · ✓ 8 materials · ✓ 6 machines · ✓ 4 labour bands · ✓ 6 ops
 Reasoning · ▸ "CNC turned aluminum pin, 1000 yr volume…"
 Resolving and validating · ✓ 5 lines, 1 proposed new master
 Draft ready — review on the right.

 Draft panel (right-side Sheet)

 Process Plan Draft  ·  PIN-2-20260519-231                                          [×]
 Generated in 11.4s · 1 LLM call · est ₹47.20 unit cost · Family: CNC TURNED
 ──────────────────────────────────────────────────────────────────────────────────
 Reasoning trail ▾

 Raw Materials (1)                                                       [+ Add line]
 ┌ Aluminum 6061-T6, India · 0.0027 kg net, 0.0033 kg gross (22% scrap)         ░ ✓ ┐
 │ Reason: Pin geometry + 1000 yr volume → low-cost wrought aluminum. 6061-T6   │
 │         is candidate rm-3 in your master at ₹342/kg.                        │
 │ Candidates considered: rm-1 (Al 6063), rm-2 (Al 7075), rm-3 (6061-T6 ★),    │
 │                       rm-4 (MS), rm-5 (SS304)                               │
 └────────────────────────────────────────────────────────── [edit] [remove] ────┘

 Manufacturing Processes (3) · Tooling (1) · Logistics (1) · Procured Parts (0)   ▸

 ⚠ Proposed new master row (1)
 ┌ NEW PROCESS · "Centerless grinding for tight-tolerance pins"                 ⚠ ┐
 │ Not in your processes table. Reason: IT8 tolerance + Ra 3.2 implies grind.   │
 │ Defaults: machine_required=Centerless Grinder, setup 20min, cycle 22s/pc.    │
 │                                                  [approve & add] [skip]      │
 └──────────────────────────────────────────────────────────────────────────────┘

 Estimated unit cost after apply: ₹47.20
                                                                   [Discard]  [Apply All]

 Out-of-scope state

 If Stage 1's classifier flags the part as out-of-scope (e.g. castings), the panel shows:

 This part looks like a sand casting (large bounding box + low DFM feature count + grade GG25).
 Phase 1 of AI generation covers CNC turning, milling, and sheet metal only.
 Castings, forgings, and complex assemblies are coming in Phase 2.

 [Use deterministic auto-fill]   [Fill manually]

 No LLM call, no credit charge.

 ---
 Phasing

 Phase 1 (this plan): CNC turned / milled / sheet-metal child parts. Single-item scope. India-localised. Edit-capture table live
 from day one.

 Phase 2 (follow-ups, not in this plan):
 - Castings, forgings, welded assemblies (new family classifiers + system-prompt routes).
 - Whole-project batch via BullMQ + Redis (Redis already wired).
 - Per-customer calibration using process_plan_line_edits aggregates.
 - "Explain this cost" deep-dive on any persisted line (uses stored tool_calls).
 - Eval harness: nightly replay of last week's briefs against the current model + acceptance-after-edit accuracy metric.

 ---
 Verification

 End-to-end happy path

 1. cd backend && npm run db:migrate — confirm process_plan_generations and process_plan_line_edits exist.
 2. npm run dev (root) + npm run start:dev (backend).
 3. Open /projects/<id>/process-planning?bomItem=<pin-2>.
 4. Click Generate Process Plan.
 5. Stream panel shows the 4 stage transitions inside ~12s.
 6. Draft panel opens with ≥ 1 raw material, ≥ 2 process ops, ≥ 1 tooling line. Each line shows its candidate set.
 7. Edit one cycle time. Check process_plan_line_edits has a new row with original_value and new_value.
 8. Click Apply All. Confirm:
   - All five section tables render new rows.
   - bom_item_costs.total_cost updates within 2s.
   - Credit bar decrements by 50.
   - process_plan_generations.status='applied', applied_line_ids populated.

 Failure paths to test

 - LLM timeout → row marked failed, UI offers deterministic fallback, no credits charged.
 - save_draft validation error → retried once with the validation message; if still invalid, failed status.
 - Apply transaction fails (FK to a material the user deleted between draft and apply) → full rollback, draft remains, user can edit
  and re-apply.
 - Tenant injection — try to send a candidateId from another tenant. Verify resolver rejects with 403.
 - Idempotency — double-click Generate within 60s. Verify one process_plan_generations row, same idempotency_key.
 - Scope gate — upload a casting STL (large bbox, no DFM features). Verify out_of_scope status, no Claude call, no credit charge.

 Unit tests

 - scope-classifier.service.spec.ts — turned / milled / sheet-metal / casting / unknown.
 - retrieval.service.spec.ts — ranking determinism, tenant filter, top-N cap.
 - reasoning.service.spec.ts — mocks Anthropic, asserts retry on Zod failure, asserts tool-call cap.
 - resolver.service.spec.ts — candidateId → DB ID mapping, rejects foreign-tenant IDs.
 - persistence.service.spec.ts — transactional rollback on partial failure; LineEdit insert on user edit.

 Cost & latency baselines (capture in PR description)

 - Tokens in/out per generation: target < 12K input cached / 10K input first-call / < 4K output.
 - Wall-clock latency: target P50 < 12s, P95 < 30s.
 - Cost per generation: target < ₹3 raw LLM cost, charged as 50 credits ≈ ₹15 internal.
 - Tool-call distribution: target ≥ 80% of generations use exactly 1 tool call (save_draft only).
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌