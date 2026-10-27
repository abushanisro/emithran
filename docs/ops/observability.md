# Observability

Operational telemetry (traces, metrics, logs) for the NestJS backend, `cad-engine`, `ecad-engine` and pg-boss jobs.
Separate from the customer-facing request logs (`backend/src/modules/developer`), which are a product feature and stay as they are.

## Design rules
- Applications speak **OTLP only**. The backend is chosen by `OTEL_EXPORTER_OTLP_ENDPOINT`; no vendor SDK in application code.
- **Fail open.** Telemetry never blocks, delays or fails a costing request or a CAD/ECAD job. Unset endpoint = telemetry fully off.
- **Not a system of record.** Losing telemetry (redeploy gap, restore from an older backup) is acceptable; losing business data is not.
- No customer data, credentials, headers, BOM contents or CAD/ECAD filenames in any attribute. Metric labels are bounded enums only.

## Backend: OpenObserve, single node
Pinned image: `public.ecr.aws/zinclabs/openobserve:v1.0.4` (see `docker-compose.observability.yml`).

### Verified locally (2026-10-20, Docker 29.8.0 in WSL2)
| Check | Result |
|---|---|
| OTLP/HTTP JSON trace ingest, `POST /api/default/v1/traces`, Basic auth | 200 |
| Same request without credentials | 401 |
| Query the span back through the search API | 1 hit |
| `docker restart`, query again | 1 hit (data survives a restart) |
| Cold volume backup (container stopped, `tar` of the volume), delete volume, restore into a new volume, start, query | 3 hits before and 3 after |

Not yet verified: logs and metrics OTLP paths (expected `/api/<org>/v1/logs` and `/v1/metrics`; confirm in Phase 1 against real exporter output), behavior under a hot (running) volume copy, and any S3-compatible object store.

### Facts taken from vendor docs (re-check before relying on them)
- Single-node mode (`ZO_LOCAL_MODE=true`): SQLite metadata, data on local disk or S3-compatible storage.
- HA mode needs PostgreSQL/MySQL metadata and object storage; the docs list S3, GCS, MinIO, Swift. Kubernetes/Helm oriented.
- Supabase Storage is **not** a documented OpenObserve backend. Its S3 layer supports multipart and conditional GET/HEAD but has no versioning and a full-access key; range reads are undocumented. Do not use it unless a real ingest-and-query test passes, and then only with a scoped key and a dedicated bucket.
- Railway volumes: one per service, no replicas, brief downtime on every redeploy of a service with a volume, grow-only, scheduled backups (daily 6 days, weekly 1 month, monthly 3 months), restore creates a new volume.

Consequence: single node on Railway has no HA and a short telemetry gap on each redeploy. Move to HA (Postgres metadata + object store) when retention needs exceed one volume, when the redeploy gap becomes unacceptable, or when ingest outgrows one node.

## Backend instrumentation (Phase 1: NestJS)
All of it lives in `backend/src/telemetry/` and is **off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set**. When unset, `main.ts` loads no SDK package (asserted by test), `@Traced` returns the original promise, and the logs are unchanged.

| Variable | Meaning |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP/HTTP base URL without a signal path, e.g. `http://<openobserve-private-host>:5080/api/default`. A bad value disables telemetry with a warning; it never stops the API. |
| `OTEL_EXPORTER_OTLP_HEADERS` | Standard OTel variable, read by the exporters, e.g. `Authorization=Basic%20<base64 of user:token>`. Set it only in the deploy environment; it is never logged or declared in code. |
| `OTEL_SERVICE_NAME` | Defaults to `mithran-backend`. |
| `OTEL_TRACES_SAMPLER_ARG` | Sampling ratio, 0..1, default `0.1`. **The backend decides locally**: an incoming `traceparent` lends its trace id (correlation) but never its sampling flag, because the web client marks every request "sampled" and any caller can send that flag. The engines, which only the backend calls, honour the backend's decision. |

What is recorded:
- **Traces:** one server span per request (named `METHOD /route/:pattern`, never the URL), Nest handler spans, one client span per outbound axios or fetch call (Supabase, cad-engine, ecad-engine, FX, ...), and `costing.cost_summary` / `costing.route_comparison` spans around `BOMItemsService.getCostSummary` / `getRouteComparison` (the Apply path goes through the latter). W3C `traceparent` is accepted and forwarded; baggage is not.
- **Metrics:** `emithran.http.server.duration` (labels: method, route pattern, status class; counts guard rejections and 404s too), `emithran.costing.duration` (operation, outcome), and `http.client.request.duration` (method, host, status) for outbound calls. Every label is a closed set.
- **Logs:** the active `trace_id` / `span_id` is appended to Nest log lines and added as fields on winston entries, only while a trace is active. Logs are not exported over OTLP yet; they stay on stdout.
- **Not recorded:** URLs and query strings, headers, request/response bodies, exception messages and stacks (only the exception class), process arguments, filenames. Spans pass through an allow-list before export; a span that cannot be sanitised is dropped.

Fail-open limits (see `telemetry.config.ts`): queue 2048 spans, batch 512, export timeout 5 s, shutdown flush 3 s, at most 4 exports in flight. Beyond that new spans are dropped. Exporter problems print at most one `[telemetry] ...` warning per minute with a count.

## Engines and jobs (Phase 2)
Same contract as the backend: off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set (and nothing from OpenTelemetry is imported when it is not), fail-open, no sensitive data, bounded queues and timeouts. Set the same `OTEL_*` variables on each engine's service (`OTEL_SERVICE_NAME` defaults to `mithran-cad-engine` / `mithran-ecad-engine`).

- **Engines (FastAPI):** `cad-engine/shared/telemetry.py` and `ecad-engine/telemetry.py` are **the same file** (the two images have separate build contexts, so they cannot share one; a change is made in both). They continue the backend's `traceparent`, name the server span by route pattern, skip `/health` and `/ready`, and add one stage span plus a duration metric around the heavy steps: cad-engine `step_load`, `geometry_analysis`, `component_features` (the 30-70 s adjacency walk); ecad-engine `extract_board`, `render_board`. A stage's outcome is `ok`, `error`, or `rejected` (a deterministic refusal such as an unreadable STEP file or a bad board set, not shown as an error). Spans pass through the same allow-list (no URL, query, header, filename, exception message or stack; a span that cannot be sanitised is dropped). Metric labels: stage and outcome, plus HTTP method and status. Logs gain `trace_id` / `span_id` only inside a trace.
- **cad-engine `GET /ready`** (new): 200, or 503 with reason codes (`temp_dir_not_writable`, `api_key_not_configured` in production). The backend's readiness probes it instead of `/health`, so **deploy cad-engine before the backend**.
- **Jobs (pg-boss):** `TracedJobQueue` wraps whichever queue adapter is configured (no adapter or use case changed). The producer's `traceparent` rides in the job payload as `__traceparent` (a trace id and span id, no customer data) and is stripped before any handler sees the payload; each worker attempt is a `job.<queue>` span that continues the producer's trace, with `emithran.job.duration` (queue, outcome) and a `emithran.job.queue.depth` gauge read at collection time (2 s bound per queue). A failing depth read is skipped; note an OpenTelemetry cumulative gauge keeps the last value of a series it stops observing, so use the readiness probe, not the gauge, to detect an unreachable queue.
- **Readiness** now also probes the electronics queue (`electronics_queue`; `configured: false` when no backend is set up).

### Health endpoints
| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Unchanged (still the stub the compose healthcheck uses). |
| `GET /api/health/live` | Process only, depends on nothing. Use for restart decisions. Railway's check stays `/ping`. |
| `GET /api/health/ready` | Database (one minimal query, 2 s bound), cad-engine (`/ready`), ecad-engine (`/ready`), electronics queue. 503 with a per-dependency reason code (`unreachable`, `timeout`, `http_<status>`, `query_failed`) and no addresses or driver messages. An unconfigured engine or queue reports `configured: false` and does not fail readiness. **Alerting only: do not wire it to restart or traffic removal.** |

`/api/health/ready` is public and does real work per call (a database query, two engine probes, a queue read); it is covered by the global rate limit.

### Verified (2026-10-20)
- Jest: config, sanitiser, both log paths, `@Traced`, metric label allow-list, middleware, diagnostics, health (all in `backend/src/telemetry/*.spec.ts` and `modules/health/health.controller.spec.ts`).
- Child-process scenarios with the real http/undici instrumentation (`backend/test/telemetry/*.fixture.ts`, run by `telemetry.integration.spec.ts`): traceparent joined and forwarded over axios and fetch, exactly one client span per call, no secret in any exported span or metric, disabled mode loads no SDK, dead and hanging collectors (requests unaffected, memory flat, shutdown bounded, no unhandled rejection).
- Real OTLP export from this code into a real OpenObserve v1.0.4: traces and `emithran_*` metric streams arrived and were queried back. OTLP **logs** are not used yet, so that path remains unverified.
- **Phase 2, across services (real ecad-engine process, real OpenObserve):** one backend request called `POST /extract/board`; querying that trace id returned one trace across `e2e-backend` and `mithran-ecad-engine` (backend request -> outbound client span -> engine server span, parented on the client span -> `engine.extract_board` with outcome `rejected`), and the engine's `emithran_engine_stage_duration` metric arrived. pytest: ecad-engine 57 passed (Windows venv); cad-engine full suite plus the new tests green in the Linux/OpenCascade image built from its Dockerfile with the new pinned requirements.
- Not verified: a real pg-boss job against a real database (`test/electronics-pgboss.e2e-spec.ts` needs the live database; the jest tests cover the wrapper with the in-memory adapter and the adapter's probe with pg-boss mocked).
- SIGTERM with a hanging collector, on Linux (Docker, `node:22-slim`): exit by SIGTERM, shutdown 3001 ms. The Jest case for it is skipped on Windows (signals) and runs on Linux CI.

## Frontend tracing (Phase 3)
**What the code did before (found 2026-10-20):** the web client sent a W3C `traceparent` and `x-request-id`, but from a context cached for the whole browser session, so every request of a tab shared one trace id, one parent span id and one request id; it marked every request "sampled"; a second, parallel implementation (`lib/utils/tracing.ts`, registered through `lib/api/init.ts`) overwrote those headers and could send `x-user-id`; the span map grew without bound; nothing was exported. Page vitals already come from Vercel (`@vercel/analytics`, `@vercel/speed-insights`).

**What it does now:**
- One trace id and one `x-request-id` **per logical API request**, kept across that request's retry attempts, with a new span id per attempt (`createRequestTrace` / `requestTraceHeaders` in `lib/api/distributed-tracing.ts`, used at the one call site in `lib/api/client.ts`). The local debug span carries the same trace id the backend receives.
- The flag is `00` ("not sampled"): the browser records and exports nothing, so it claims no decision. The backend ignores a caller's flag anyway (see the sampling row above).
- `correlationIdInterceptor` (the session-level context) no longer writes `traceparent`, `x-request-id`, `tracestate` or `x-user-id`; it only adds the session-grouping `x-correlation-id` and `x-session-id`. Nothing on the backend reads `x-user-id`, `x-session-id` or `x-correlation-id`.
- `TraceManager` keeps at most 200 spans (oldest dropped).
- No browser export, no ingest endpoint, no CSP change, no `@vercel/otel`, no Next.js server tracing. `lib/utils/tracing.ts` and the exported `getTraceHeaders` are left in place (now unused for headers).

Still open: browser JS error reporting (decision 4: a first-party, authenticated, rate-limited ingest endpoint on the backend) and Next.js server tracing (decision 5). Neither is started; both need a design review first.

Verified: vitest 565 passed (new: per-request identity, retry sharing, span bound, interceptor, and a request-level test through the real `apiClient` with only `fetch` replaced); the new tests fail against the previous client and interceptor (5 of 10). `tsc` clean. `next build` was not run (it would overwrite `.next` and read `.env.local`).

## Security model
- OpenObserve is **not** publicly exposed. Backend and engines send over Railway private networking with a server-side ingest token held in the deploy environment.
- The UI sits behind SSO / zero-trust. The root password is never reused as an ingest credential in application config: create a dedicated ingest user and token per environment.
- Local compose binds to `127.0.0.1` only.
- Browser telemetry is **not enabled**. If approved later: first-party ingest endpoint on the backend (authenticated session, per-user and per-IP rate limit, strict CORS, size and field allow-list). A write-only token alone is insufficient (spam, cost abuse, injection). No privileged token ever ships in a client bundle.
- Vercel (Next.js server) cannot reach Railway private networking, so server-side Next tracing stays off until a protected ingest path exists.

## Open decisions (owner: platform lead)
Each gates **production deployment**, not local development.

| # | Decision | Recommendation |
|---|---|---|
| 1 | Data store: Railway volume only / volume + dedicated S3-compatible bucket / Supabase Storage | Volume only to start. Add a bucket only after a real ingest-and-query test passes against it. |
| 2 | Hosting: Railway single node / managed OpenObserve Cloud / Kubernetes HA | Railway single node with the backup schedule below; written HA trigger above. |
| 3 | Ingest security (private network, ingest token, SSO for the UI) | As in the security model. |
| 4 | Browser RUM | Deferred. Needs an approved first-party endpoint design. |
| 5 | Next.js server tracing | Deferred until a protected ingest path exists. |
| 6 | Alert destination, per-stream retention | Slack or email (confirm). Logs 14d, traces 7d, metrics 30d. |
| 7 | Sampling | Head sampling, default 0.1 (`OTEL_TRACES_SAMPLER_ARG`). Errors are guaranteed through unsampled counters and log lines, not through traces. Revisit tail sampling only if baseline data shows missing error traces. |

## Backup and restore
Production (once deployed on Railway): enable the volume's daily backup schedule (6-day retention), plus a weekly one (1 month).
- Restore creates a **new** volume; the previous volume is kept unmounted. Re-attach the restored volume, redeploy, then query a known stream to confirm.
- Drill, locally verified (above): stop the container, archive the volume, delete it, recreate it from the archive, start, query. Repeat the equivalent drill on Railway once before relying on it, and after any OpenObserve upgrade.
- A hot copy of a running volume is not a verified path. Use Railway's volume backups, not ad-hoc file copies.

## Rollback
Unset `OTEL_EXPORTER_OTLP_ENDPOINT` (and redeploy or restart the service): the SDK is not loaded and behavior is identical to before. The telemetry backend can be stopped independently with no effect on the application.

## Local use
```bash
export OPENOBSERVE_ROOT_EMAIL=you@example.test
export OPENOBSERVE_ROOT_PASSWORD='<choose one; never commit it>'
docker compose -f docker-compose.observability.yml up -d
# UI: http://127.0.0.1:5080
```
