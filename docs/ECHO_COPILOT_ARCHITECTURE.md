# Echo — Mithran Manufacturing Copilot

> A floating, always-on AI assistant that knows what the user is looking at and
> uses that context to answer accurately, proactively flag problems, and guide
> the team through manufacturing workflows.

---

## 1. Purpose

We were not building a chatbot. We were building a **manufacturing copilot**.
TryHackMe's Echo widget works because it knows the room, the question, the
commands run, and the available hints. The Mithran equivalent must know the
current **Project / BOM / BOM item / Process plan / RFQ / Supplier / Production
lot / Costing sheet** — and use that to compose answers from the platform's
existing intelligence layer.

Effort allocation reflects this priority:

| Layer | Effort | Why |
|---|---|---|
| Chat UI | 20% | Necessary, but commoditised |
| Context engine | 30% | What separates Echo from "ChatGPT in a sidebar" |
| Manufacturing intelligence + alerts | 50% | The differentiation |

---

## 2. The four layers

| Layer | What it does | Status in V1 |
|---|---|---|
| **L1 Universal** | Generic Claude Q&A on any page | ✅ shipped |
| **L2 Context-aware** | Hydrates current entity, calls tools, cites real numbers | ✅ shipped |
| **L3 Proactive** | Hybrid rule + AI alerts (pending RFQs, cost spikes, stale lots, etc.) | ✅ shipped |
| **L4 Agent actions** | Echo *does* things (with approval gates) | ⏭ V2 |

---

## 3. System architecture

```
                          ┌──────────────────────────────────┐
 Browser (Next.js)        │  NestJS backend                  │   Supabase
 ─────────────────        │  ───────────────                 │   ────────
 PageContextProvider ─┐   │  EchoController                  │   echo_conversations
   usePageContext()   ├──►│   ↓                              │   echo_messages
                      │   │  EchoService (orchestrator)      │   echo_context_snapshots
 EchoProvider         │   │   ↓                              │   echo_alerts
   EchoWidget         │   │  ├ SkillRouter (route → skill)  │   echo_suggestion_dismissals
   EchoChat ──POST──► │   │  ├ EntityHydrator (snapshot)    │   echo_hints (seed)
   useEchoChat()      │   │  ├ Anthropic streaming          │
                      │   │  └ ToolDispatcher (read-only)   │
 useEchoAlerts()      │   │     ↓                            │
 useEchoSuggestions() │   │  Existing platform services:     │
 useEchoHint()        │   │   bom-item-cost / cad-analysis / │
                      │   │   process-plan-generator /       │
                      │   │   part-wise-cost-analysis /      │
                      │   │   vendor / rfq-tracking / ...    │
                      │   │                                   │
                      │   │  AlertsService                    │
                      │   │   ├ AlertDetector (rules)        │
                      │   │   └ AlertRanker (Claude Haiku)   │
                      │   │                                   │
                      │   │  SuggestionService                │
                      │   │  HintsService                     │
                      │   └──────────────────────────────────┘
                      │   cad-engine (FastAPI / OCCT)
                      └──► ai_dfm_analyzer.py (Claude Sonnet 4.6)
                          ↓
                          Deep DFM analysis (manufacturability,
                          process recommendations, material
                          alternatives, lead-time, risk)
```

---

## 4. The skill router

`backend/src/modules/echo/skills/router.ts`

| Route prefix | Skill | Tools the skill may call |
|---|---|---|
| `/projects/:id/bom*` | **BOM Expert** | `get_part_cost_breakdown`, `get_dfm_review`, `compare_cost_to_benchmark` |
| `/projects/:id/process-planning*` | **Process & DFM Expert** | `get_dfm_review`, `run_dfm_deep_analysis`, `get_process_candidates`, `get_part_cost_breakdown`, `find_suppliers_with_capability` |
| `/projects/:id/supplier-(nomination|evaluation)*` | **Supplier Expert** | `rank_suppliers_for_part`, `find_suppliers_with_capability`, `compare_cost_to_benchmark`, `get_part_cost_breakdown` |
| `/projects/:id/rfq*` | **RFQ Expert** | `get_rfq_status`, `rank_suppliers_for_part` |
| `/projects/:id/production-planning*` | **Production Expert** | `get_production_lot_status` |
| `/projects/:id/quality-control*` | **QA Expert** | (read-only context) |
| `/projects/:id` (root) | **Project Expert** | `get_part_cost_breakdown`, `get_rfq_status`, `get_production_lot_status`, `get_vave_ideas` |
| `/(raw-materials|hr-rates|mhr-database|calculators)*` | **Costing Expert** | `get_part_cost_breakdown`, `compare_cost_to_benchmark` |
| `/vave*` | **VAVE Expert** | `get_vave_ideas`, `get_part_cost_breakdown` |
| `/benchmarks*` | **Benchmark Expert** | `compare_cost_to_benchmark`, `find_suppliers_with_capability` |
| anywhere else | **Universal** | none |

Each skill ships:
- A short prompt fragment (~200–400 tokens) appended after the cached base
  persona prompt. Only the fragment varies per turn → ~10% incremental cost.
- An allow-list of tools (`SKILL_TOOLS`). This is *enforced* before tools are
  shipped to Claude; Universal cannot call entity tools, RFQ cannot call DFM.

---

## 5. Tools

All tools in V1 are **read-only**. Each tool wraps an existing platform service
or a Supabase view — no new business logic.

| Tool | Wraps | Used by skills |
|---|---|---|
| `get_part_cost_breakdown` | `bom_items` + 5 cost-record tables | BOM, Costing, Project, Supplier, VAVE |
| `get_dfm_review` | `cad_analysis_results` (cached) | BOM, Process & DFM |
| `run_dfm_deep_analysis` | guides user to cad-engine UI button | Process & DFM |
| `get_process_candidates` | `process_plan_generations` | Process & DFM |
| `rank_suppliers_for_part` | `part_wise_cost_analysis` | Supplier, RFQ |
| `find_suppliers_with_capability` | `vendor_summary` | Process & DFM, Supplier, Benchmark |
| `compare_cost_to_benchmark` | `supplier_capability_benchmarks` | BOM, Supplier, Costing, Benchmark |
| `get_rfq_status` | `rfq_tracking` + `rfq_tracking_vendors` | RFQ, Project |
| `get_production_lot_status` | `production_planning_lots` + `production_planning_subtasks` | Production, Project |
| `get_vave_ideas` | `vave_ideas` | VAVE, Project |

Caps per turn: **4 tool calls**, **30 s wall clock**, **1 024 output tokens**,
default model `claude-haiku-4-5-20251001`. Escalation to `claude-sonnet-4-6`
happens when the user clicks **Deep** in the composer (or — V2 — when the BOM
expert is triaging > 3 entities).

---

## 6. Data model (migration 315)

| Table | Purpose |
|---|---|
| `echo_conversations` | Persistent chat sessions, archived via `archived_at` |
| `echo_messages` | Per-turn rows with tokens, model, cache stats, credits, tool calls |
| `echo_context_snapshots` | Entity JSON captured every turn — **seed for the V2 Intelligence Graph** |
| `echo_alerts` | Idempotent (owner, kind, source_entity) — upserted on every refresh |
| `echo_suggestion_dismissals` | Per-user-per-route cooldown for dynamic suggestions |
| `echo_hints` | Seeded markdown library — `route_glob` + `topic_id` |

RLS: all user tables filter on `auth.uid() = owner_id`. `echo_hints` is
read-only to authenticated users; writes only via service role.

---

## 7. Streaming protocol

Echo uses **POST + SSE** (not GET + `@Sse`) because the chat request carries a
JSON body. The controller writes raw `data: <json>\n\n` frames via
`@Res() res: Response`. A ping line `: ping\n\n` every 15 s keeps proxies from
killing the connection.

The browser hook (`useEchoChat`) reads `response.body.getReader()`, splits on
`\n\n`, and dispatches on the discriminated `ChatEvent` union:

```
conversation_started → set conversationId
skill_selected       → tag the current bubble
context_hydrated     → telemetry only
token (× many)       → append to the streaming assistant bubble
tool_call_started    → render a "Running…" tool chip
tool_call_completed  → fill in the chip with result preview + duration
message_complete     → finalise IDs + counters, persistence is done
error                → surface to the user
```

---

## 8. Alert engine

`AlertDetectorService` runs **6 deterministic rules** in parallel:

1. **`rfq_pending`** — `rfq_tracking.status='sent' AND sent_at < now() - 3d`
2. **`stale_lot`** — `production_planning_lots.updated_at < now() - 5d` AND not completed
3. **`cost_spike`** — compares the two most recent `echo_context_snapshots` per bom_item, flags >10% delta
4. **`missing_plan`** — bom_items older than 14 d with no `process_plan_generated_at`
5. **`missing_drawing`** — child-part bom_items with no `drawing_file_url`
6. **`cost_outlier`** *(reserved for V1.1)*

`AlertRankerService` then calls **Claude Haiku** once per refresh:
- Inputs the candidate list as JSON.
- Returns top-5 with severity + a short `nextAction` string.
- On failure (no key, timeout, malformed JSON), falls back to severity-sorted
  order with a static `defaultActionFor(kind)` — Echo's alerts never go dark.

Results are upserted into `echo_alerts` using the
`(owner_id, kind, source_entity_type, source_entity_id)` unique constraint, so
repeated refreshes don't create duplicates.

---

## 9. Frontend integration points

| File | Change |
|---|---|
| `app/providers.tsx` | Wrapped `{children}` with `<PageContextProvider><EchoProvider>…<EchoWidget /></EchoProvider></PageContextProvider>` |
| `components/layout/MithranAICreditsBar.tsx` | Added `CR_PER_ECHO_TURN = 1` and `CR_PER_ECHO_DEEP = 5` |
| 8 page files | `usePageContext({ entityType, entityId, breadcrumbs })` near the top |

Pages registered in V1:
- `/projects/[id]` → `project`
- `/projects/[id]/bom/[bomId]` → `bom`
- `/projects/[id]/process-planning` → `project`
- `/projects/[id]/production-planning` → `project`
- `/projects/[id]/supplier-nomination` → `project`
- `/projects/[id]/rfq` → `project`
- `/projects/[id]/quality-control` → `project`
- `/projects/[id]/delivery` → `project`

To opt a new page in:

```tsx
import { usePageContext } from '@/lib/echo/PageContextProvider';

export default function MyPage() {
  const params = useParams();
  usePageContext({
    entityType: 'bom_item',
    entityId: params?.itemId as string,
    breadcrumbs: ['Project', 'BOM', 'Item'],
  });
  // ...
}
```

To attach visible content opt-in:

```tsx
<section data-echo-context>
  {/* Echo can read text inside this container when the user
      enables "Attach what you see" in the composer */}
</section>
```

To expose a hint button:

```tsx
import { EchoHintButton } from '@/components/features/echo';

<EchoHintButton topicId="bom.cost-rollup" />
```

---

## 10. Configuration

Backend uses the **existing** `ANTHROPIC_API_KEY`. No new secrets.

Optional env (defaults shown):
```
ECHO_MODEL_DEFAULT=claude-haiku-4-5-20251001
ECHO_MODEL_DEEP=claude-sonnet-4-6
CAD_ENGINE_URL=http://localhost:5000
```

Frontend honours the existing API gateway env vars:
```
NEXT_PUBLIC_API_URL          # e.g. http://localhost:4000/v1/api
NEXT_PUBLIC_API_GATEWAY_URL  # fallback
```

---

## 11. Cost model

| Action | Credits | Notes |
|---|---|---|
| Chat turn (Haiku) | 1 | base persona is `cache_control: ephemeral` → ~10% cost on turns 2..N within 5 min |
| Deep chat turn (Sonnet) | 5 | user opts in via composer toggle |
| DFM cached | 0 | direct Supabase read |
| DFM deep | 5 | triggers second Claude call inside cad-engine |
| Alert ranker | 0 | charged to platform overhead, ~1 Haiku call per user per refresh |

---

## 12. Verification

### Backend tests (Jest, mirror existing `*.spec.ts` style)

- `skills/router.spec.ts` — route → skill mapping, allow-lists per skill
- `prompts/context-formatter.spec.ts` — escaping, truncation, breadcrumbs
- `tools/schemas.spec.ts` — schema integrity + filter-by-skill
- `services/page-context.registry.spec.ts` — route lookup + suggestion presence
- `services/alert-ranker.service.spec.ts` — fallback ordering and defaults

Run:
```
cd backend && npm run test -- src/modules/echo
```

### Frontend manual smoke

1. `npm run dev` → log in → confirm floating button visible on `/`, `/projects`, `/projects/[id]/bom/[bomId]`.
2. Drag button, resize panel by dragging the left edge, reload → position and width persist.
3. On a BOM item page ask **"why is this expensive?"** → tool chip shows `get_part_cost_breakdown`; answer cites real percentages.
4. On Process Planning ask **"is this part hard to make?"** → DFM tool fires; warnings + recommended processes appear.
5. On Supplier Nomination ask **"rank suppliers for part X"** → ranking table renders.
6. Seed a pending RFQ > 3 d, a BOM with cost delta > 10 %, a stale lot → Alerts tab badge increments, alerts list shows ranked items with `nextAction`.
7. Toggle **📎 Attach what you see** → confirm in backend logs the DOM snippet is received (≤ 2 k chars).
8. Click an `EchoHintButton topicId="bom.cost-rollup"` → panel opens with the seeded hint pre-filled.

### Production checklist

- [ ] `ANTHROPIC_API_KEY` set on backend
- [ ] Run migration `315_echo_module.sql` against production Supabase
- [ ] RLS verified: a second user cannot read another user's `echo_*` rows
- [ ] Prompt cache hit rate logged ≥ 60% over a representative sample
- [ ] `EchoWidget` mounted only after `SupabaseAuthProvider` (already the case in `providers.tsx`)
- [ ] Credit meter reflects `CR_PER_ECHO_TURN` and `CR_PER_ECHO_DEEP`

---

## 13. V2 — Manufacturing Intelligence Graph

Once `echo_context_snapshots` accumulates 4–8 weeks of data, cross-entity
questions become possible:

- "Which supplier causes the most delay across all my projects?"
- "Which BOM contributes the highest cost?"
- "Which 5 parts should we redesign?"
- "What can reduce manufacturing cost by 10 %?"

Planned schema additions:
- `mfg_graph_nodes (entity_type, entity_id, attributes)`
- `mfg_graph_edges (from, to, edge_type, weight)` — e.g.
  `bom_item -[supplied_by]-> vendor`, `rfq -[delayed_by]-> vendor`,
  `part -[redesigned_via]-> vave_idea`

L4 (agent actions) lands in V2 with **mandatory approval gates** — Echo proposes,
the user clicks Approve, and Echo invokes the existing service. No silent
writes, ever.

---

## 14. Build journey (for posterity)

The plan went through three iterations before code landed:

1. **V0 — "Floating chatbot"**: standard L1-only Q&A widget.
2. **V1 — "Echo-style assistant"**: added smart suggestions, alerts, hints,
   per-page context, the SSE protocol, draggable widget.
3. **V2 — "Manufacturing Copilot" (this build)**: reframed away from chatbot.
   Added the 4-layer model, the skill router, expert prompts, tool dispatcher
   with allow-lists per skill, `echo_context_snapshots` as the seed for the
   future Intelligence Graph, the hybrid (rules + AI) alert engine, and
   first-class cad-engine integration with model alignment.

Key constraints that shaped the implementation:
- **Reuse the existing Anthropic SDK pattern** from `process-plan-generator/services/reasoning.service.ts` (raw fetch, `x-api-key`, `anthropic-version: 2023-06-01`, `cache_control: ephemeral` on the base prompt).
- **Reuse the existing Supabase auth pattern** (user-token client for RLS, admin client for shared reads).
- **Don't pull every service into EchoModule's constructor** — that creates import cycles. Instead, the `ToolDispatcherService` reads Supabase tables directly under the user's token, which is RLS-safe and decoupled.
- **POST + SSE, not GET + @Sse**, because chat needs a JSON body. Manual `Response.write` keeps the stream simple and proxy-friendly (`X-Accel-Buffering: no`, `: ping\n\n` heartbeat).
- **Cap context-snapshot fan-out**: each turn writes exactly one snapshot row, capped to ~1 KB JSON.
- **Fail open on the ranker**: if Claude is down or the JSON is malformed, fall back to severity ordering with deterministic `nextAction` strings.

---

## 15. Files added or modified

### Backend (NestJS)
```
backend/src/modules/echo/
  echo.module.ts
  echo.controller.ts
  dto/{chat-request, chat-event, conversation, page-context, suggestion, alert, hint}.dto.ts
  dto/index.ts
  prompts/{base-system, skills, context-formatter}.ts (+ .spec.ts for formatter)
  skills/router.ts (+ .spec.ts)
  tools/{schemas.ts (+ .spec.ts), tool-dispatcher.service.ts}
  services/{echo, conversation, entity-hydrator, alert-detector, alert-ranker,
            alerts, suggestion, hints, page-context.registry}.service.ts
            (+ .spec.ts for page-context.registry and alert-ranker)
backend/src/app.module.ts                    [edited: register EchoModule]
backend/migrations/315_echo_module.sql       [new: 6 tables + RLS + seeded hints]
```

### Frontend (Next.js)
```
lib/echo/
  types.ts
  config.ts
  PageContextProvider.tsx
  domSnippet.ts
  useEchoChat.ts
  useEchoApi.ts

components/features/echo/
  EchoProvider.tsx
  EchoWidget.tsx
  EchoFloatingButton.tsx
  EchoPanel.tsx
  EchoChat.tsx
  EchoMessage.tsx
  EchoToolCallChip.tsx
  EchoSuggestionBanner.tsx
  EchoAlertsList.tsx
  EchoConversationList.tsx
  EchoHintButton.tsx
  index.ts

app/providers.tsx                            [edited: wrap with EchoProvider]
components/layout/MithranAICreditsBar.tsx    [edited: add CR_PER_ECHO_*]
app/(dashboard)/projects/[id]/page.tsx                          [edited: usePageContext]
app/(dashboard)/projects/[id]/bom/[bomId]/page.tsx              [edited]
app/(dashboard)/projects/[id]/process-planning/page.tsx         [edited]
app/(dashboard)/projects/[id]/production-planning/page.tsx      [edited]
app/(dashboard)/projects/[id]/supplier-nomination/page.tsx      [edited]
app/(dashboard)/projects/[id]/rfq/page.tsx                      [edited]
app/(dashboard)/projects/[id]/quality-control/page.tsx          [edited]
app/(dashboard)/projects/[id]/delivery/page.tsx                 [edited]
```

### CAD engine
```
cad-engine/ai_dfm_analyzer.py                [edited: default model → claude-sonnet-4-6]
```
