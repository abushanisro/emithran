# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Engineering Standards (Non-Negotiable)

Think and act as a Principal Engineer. One careless change in a shared service, a DTO, or a database migration can corrupt cost calculations across every BOM in production. Hold every change to this bar:

### Before writing any code, ask:
- **What breaks if this is wrong?** — Cost figures, process routes, and material weights are used for quoting. Wrong data = wrong quotes = financial damage.
- **What is the blast radius?** — A change to `BOMItem` entity, `AutoFillService`, or `ProcessPlanGeneratorModule` touches every part in every project. A change to a UI component is local. Scope awareness is mandatory.
- **Is this the right layer?** — Business logic belongs in NestJS services, not Next.js API routes. Formatting belongs in the UI, not the API. Calculation formulas belong in the backend, not the frontend.

### Code quality rules:
- **No `any` types without a comment explaining why.** Untyped data flows are how bugs reach production silently.
- **Validate at every boundary.** DTOs validate API input. TypeScript guards validate inter-service data. Never trust data from the CAD engine or Claude AI without checking for null/undefined/nonsense values (e.g. density < 0.5 g/cm³ is physically impossible — reject it).
- **No silent failures in cost-critical paths.** If `populateFormFromResult`, the live weight calculation, or any process cost step fails, it must log and surface a recoverable error — not return 0 quietly. Wrong zeros are worse than visible errors.
- **Database migrations are irreversible in production.** Never drop a column or rename a field without a multi-step migration strategy. Always add columns as nullable first.
- **No hardcoded constants for physics values.** Laser speeds, material densities, pierce times, and MHR rates are data — they belong in the database or in a clearly named lookup table/constant file, not embedded in calculation logic.

### What NOT to do:
- Do not add abstractions for hypothetical future use. Three direct calls are better than a premature factory.
- Do not add new npm packages without checking if an existing dependency already covers it (e.g. date-fns is already installed; don't add moment).
- Do not replicate backend logic in the frontend. The backend is the single source of truth for all cost, material, and process calculations.
- Do not bypass the `SupabaseAuthGuard` with `@Public()` unless the endpoint genuinely needs to be unauthenticated.
- Do not write a migration that rewrites existing rows without a tested rollback path.

---

## Architecture Overview

Mithran is a **three-service monorepo** for manufacturing cost engineering:

| Service | Stack | Port | Purpose |
|---|---|---|---|
| **Frontend** | Next.js 16 (App Router), React 19 | 3000 | UI, Next.js API routes, Supabase auth |
| **Backend** | NestJS 11, TypeORM, PostgreSQL | 4000 | Business logic, all REST APIs |
| **CAD Engine** | Python FastAPI | 5000 | STEP/STL geometry extraction, DFM analysis |

All three run independently. The frontend calls the backend directly via `NEXT_PUBLIC_API_URL`. The backend calls the CAD engine via `CAD_ENGINE_URL`. Supabase (hosted) handles auth and file storage; PostgreSQL (Railway in prod, local in dev) stores all application data.

---

## Commands

### Frontend (root)
```bash
npm run dev          # Development with .env.development
npm run dev:prod     # Development with .env.production
npm run build        # Production build
npm run lint         # ESLint check
npm run lint:fix     # ESLint auto-fix
npm run type-check   # tsc --noEmit
```

### Backend (`cd backend/`)
```bash
npm run start:dev    # NestJS with watch mode (TLS disabled for local Supabase)
npm run build        # Compile TypeScript to dist/
npm run start:prod   # Run compiled dist/main
npm run test         # Jest unit tests
npm run test:e2e     # End-to-end tests
npm run typecheck    # tsc --noEmit
npm run db:migrate   # Run pending migrations
npm run db:migrate:reset  # Reset + re-run all migrations
```

### CAD Engine (`cd cad-engine/`)
```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 5000
```

---

## Key Conventions

### Environment Switching
The frontend uses `copy .env.development .env` / `copy .env.production .env` to switch configs. Never commit `.env` — only `.env.development` and `.env.production`. The `.env` file is gitignored and runtime-only.

### API Client Pattern
All frontend→backend calls go through `lib/api/client.ts` (`apiClient`). React Query hooks in `lib/api/hooks/` wrap these with caching and invalidation. Do not call `fetch` directly from components — use the hook layer.

### Authentication
`SupabaseAuthGuard` is the `APP_GUARD` on the NestJS backend — every endpoint is protected unless decorated with `@Public()`. The frontend uses Supabase SSR (`@supabase/ssr`) with cookie-based sessions. The JWT token is forwarded as `Authorization: Bearer` to the backend.

### Backend Module Structure
Each feature follows NestJS convention: `module → controller → service → entity/DTO`. Entities use TypeORM decorators. DTOs use class-validator with `@IsOptional()` / `@IsString()` etc. The global `ValidationPipe` with `transform: true` handles DTO transformation automatically.

### Supabase vs PostgreSQL
- **Supabase** = auth, file storage (drawings, 3D models), and the Supabase JS client for auth checks
- **PostgreSQL** (TypeORM) = all application data (BOMs, costs, projects, materials, etc.)
- Don't store application records in Supabase tables; don't use TypeORM for auth.

### Path Aliases
- Frontend: `@/` → project root (configured in `tsconfig.json`)
- Backend: `@/` → `backend/src/` (configured in `backend/tsconfig.json`)

### Code Style
Prettier is enforced: `semi: true`, `singleQuote: false`, `trailingComma: "all"`, `printWidth: 90`, `tabWidth: 2`, `endOfLine: "lf"`.

---

## Data Flow: BOM Auto-Fill Pipeline

The most complex feature — understanding this unlocks most of the codebase:

1. **File drop** in `components/features/bom/BOMItemDialog.tsx` → `analyzeForAutoFill(file)` in `lib/api/hooks/useBOMItems.ts`
2. **Backend** `POST /bom-items/analyze-for-autofill` → `AutoFillService` → calls CAD Engine `POST /analyze`
3. **CAD Engine** extracts geometry (volume, surface area, bounding box, hole count, bend count, cut length, weight) and returns `AutoFillResponse`
4. **`populateFormFromResult()`** in `BOMItemDialog.tsx` patches form fields and writes `fieldLineage` (`'cad' | 'drawing' | 'derived'`) for each filled field
5. **2D Drawing upload** (`file2d`) triggers `POST /api/vave/drawing-analysis` Next.js route → Claude AI vision API → extracts material, dimensions, sheet thickness, bend count, coating from PDF/image
6. Drawing values **always override CAD** for material; CAD is authoritative for geometry
7. **Live weight recalculation** fires when `volume` or `materialGrade` changes → `GET /bom-items/material-density?grade=...` → `weight = (volume_mm3 / 1e6) * density_g_cm3`

The `AutoBadge` component in `BOMItemDialog.tsx` reads `fieldLineage[field].source` to render **CAD** (cyan) / **DRAWING** (blue) / **DERIVED** (purple) badges.

---

## Process Plan Generator

Located at `backend/src/modules/process-plan-generator/`. Takes a BOM item and generates a manufacturing process route with cost estimates:

- `services/` — orchestration, cost calculation, material/machine lookup
- `ranking/` — `machine-ranker.ts`, `material-ranker.ts` for scoring candidates
- `prompts/system.prompt.ts` — LLM system prompt for process reasoning
- `dto/` — typed DTOs for every stage (engineering brief → candidate set → draft lines → generation response)

Uses MHR (Machine Hour Rate) and LSR (Labour Standard Rate) data from their respective modules.

---

## Key Backend Modules

| Module | Path | Notes |
|---|---|---|
| `BOMItemsModule` | `modules/bom-items/` | Auto-fill, CAD analysis, file upload |
| `ProcessPlanGeneratorModule` | `modules/process-plan-generator/` | AI-driven process routing + costing |
| `RawMaterialsModule` | `modules/raw-materials/` | Material DB with density, cost, `partFamily` ranking |
| `MHRModule` | `modules/mhr/` | Machine hour rates |
| `LSRModule` | `modules/lsr/` | Labour standard rates |
| `VaveModule` | `modules/vave/` | Value analysis / value engineering |
| `BenchmarkSessionsModule` | `modules/benchmark-sessions/` | Competitive benchmarking |

---

## Frontend Structure

- `app/(dashboard)/` — all authenticated pages, grouped by feature
- `app/api/` — Next.js API routes (thin proxies or AI calls needing server-side secrets)
- `components/features/` — complex feature components (e.g. `bom/BOMItemDialog.tsx`)
- `components/ui/` — shadcn/ui primitives (Button, Dialog, Input, etc.)
- `lib/api/hooks/` — React Query hooks, one file per backend resource
- `lib/api/client.ts` — base `apiClient` with auth header injection
- `lib/api/vave.ts` — types for VAVE/drawing analysis responses

---

## Drawing Analysis Route

`app/api/vave/drawing-analysis/route.ts` — server-side Next.js route that calls the Anthropic Claude API directly (uses `ANTHROPIC_API_KEY`). Accepts PDF or image (base64), sends to `claude-sonnet-4-6` vision, returns structured JSON with material, dimensions, tolerance, surface finish, sheet thickness, bend count, heat treatment, coating, and per-field confidence scores (0–1). PDFs use `type: 'document'`; images use `type: 'image'` in the Claude API message payload.

---

## Deployment

- **Frontend** → Vercel (auto-deploy from main). Env vars set in Vercel dashboard.
- **Backend** → Railway. `railway.json` configures build/start commands.
- **CAD Engine** → Railway. Separate service with its own `Dockerfile`.
- Database migrations run via `npm run db:migrate` in the backend before each deploy.
- CSP headers are toggled by the `VERCEL` env var: permissive on localhost, strict in production.
