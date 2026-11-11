# Testing audit (Step 1)

Audit date: 2026-11-10, on `develop` at `10d5998` (CI green, 15 jobs). Everything under "Result" was executed; nothing is reported as passing from memory.
This is the audit only. No test system was added or changed to produce it.

## Result

| Category | What runs | Result | In CI? |
|---|---|---|---|
| Unit: backend | `cd backend && npx jest` | **360 suites, 4,358 tests pass** | Yes (Backend) |
| Unit: frontend | `npx vitest run` | 138 files, 1,087 tests pass (run 2026-11-10 before #322) | Yes (Frontend) |
| Unit: CAD engine | `pytest` in the engine image (native arm64, OCCT 7.8.1.1) | **549 pass, 1 skipped** | **No**: CI only builds the image |
| Unit: ECAD engine | `python -I -m pytest` | pass | Yes |
| Unit: Rust core, C++ workers | cargo test; hand-worked checks run in the image build | pass | Yes (x86 and ARM) |
| Integration | `test:sql`, `test:postgrest`, `test:baseline`, `test:schema-drift`, `test:boot`, `test:local`, S3 | all exit 0 | Yes |
| Smoke | `test:boot`, `test:local` smoke; live on stage: `/api/health/ready` 200, tunnel healthy, queue up past 5 minutes | pass | CI part yes; the stage part is manual |
| Backend e2e | `APP_ENV=local npx jest --config ./test/jest-e2e.json` | **58 pass, 21 FAIL (4 of 11 suites)** | **No** |
| Playwright (14 specs) | `npm run test:e2e` | **cannot run** (see below) | **No** |
| Performance | none for the API or queues (only worker benchmark scripts) | none | No |

Skipped or todo markers in the test code: 0.

## Failures and root causes (backend e2e)

All four are stale test harnesses, not product defects. No production code is wrong.

1. `auth-bypass-on`, `auth-bypass-off` (16 tests): expect 200/401, get **404**. Commit 40f04751 ("API: /api/v1 only") moved the prefix into `configureApiPrefix(app)` in `main.ts`. These specs wire versioning by hand and never apply the `api` prefix, so every URL misses. **These are the only tests that prove an unauthenticated request gets 401 from the real app, and they currently prove nothing.**
2. `turret-reference-tables`, `waterjet-speed` (5 tests): `Nest can't resolve dependencies of ExchangeRateService ... AuditService`. The test module no longer provides what the service now needs.

## Playwright cannot run

- `e2e/auth.setup.ts` fills `#email` / `#password` on `/auth`. That page has neither (login is Auth0 now), so the setup would fail even with credentials.
- It also needs `E2E_EMAIL` / `E2E_PASSWORD`; the stage app sits behind Cloudflare Access, which the specs do not pass.
- The specs target `localhost:3000`/`:4000` dev servers, not the self-hosted stack.

## Coverage gaps

- Feature tests (Playwright and backend e2e) are not part of any CI workflow.
- CAD engine tests (549) do not run in CI.
- No performance, load or queue-throughput test exists. The queue bug fixed in #334 (a 5-minute token expiry) is the kind a throughput/soak test finds.
- No golden-dataset regression for costing outputs; correctness rests on hand-worked unit tests and the C++/Python parity test.
- Smoke after deployment is manual.

## petrus-demo

The 13 tracked files that mention it are provenance comments (design lineage), not code or test dependencies. `~/Developer/emithran-petrus` and `~/Developer/petrus-sandcast` are outside the repo and still exist. Remove them only after the readiness work is verified.

## Proposed PR sequence (each small, none stacked)

1. Repair the e2e harnesses: one shared `createE2eApp()` that applies `configureApiPrefix`, and give the turret/waterjet module the missing provider. Expected result: 79/79.
2. Run the CAD engine tests in CI (a job using the existing `Dockerfile.dev`).
3. Playwright against the local stack in CI: Auth0-compatible setup (a service session, not a form), critical-path set per PR, full set nightly.
4. Golden dataset: a few STEP parts with hand-worked expected costs, compared on every PR.
5. k6 load and queue tests with budgets, nightly against stage.
6. Post-deploy smoke script, then add the new jobs to the required checks.
