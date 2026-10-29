# Monitoring: Prometheus + Grafana

KPI and health monitoring for the backend, `cad-engine`, `ecad-engine`, the CAD upload pipeline, costing and the database.
Builds on the OpenTelemetry layer in [observability.md](observability.md): **the applications still speak OTLP only**; Prometheus
is the metrics backend (it ingests OTLP natively), OpenObserve stays for traces. No `prom-client`, no second instrumentation, no
`/metrics` endpoint on any application.

## Architecture

```
backend (NestJS) ──OTLP push──▶ ┐
cad-engine, ecad-engine ─push─▶ ├─▶ Prometheus ◀── scrapes ── blackbox (probes) ── backend /api/health/*, engines /ready
                                │        │                └── node-exporter (host, opt-in)
                                │        └── rules/alerts.yml (14 alerts)
                                ▼
                             Grafana ──▶ Prometheus (live)        ┐ 4 dashboards
                                     └──▶ Postgres kpi.* (daily)  ┘ + 1 database alert (DatabaseConnectionsHigh)
```

| Service | Image (pinned by digest) | Exposed |
|---|---|---|
| `prometheus` | `prom/prometheus` 3.15.1 | nothing (internal network only) |
| `blackbox` | `prom/blackbox-exporter` 0.29.1 | nothing |
| `grafana` | `grafana/grafana` 13.3.0 | loopback `127.0.0.1:3001`; in stage/prd through a Cloudflare Tunnel route with Access |
| `node-exporter` (profile `host-metrics`) | `prom/node-exporter` 1.12.1 | nothing |

`docker-compose.monitoring.yml` is separate from the app files on purpose: nothing in the app depends on it, and the apps' telemetry
export fails open, so stopping or crashing the monitoring stack never affects Emithran.

### What is deliberately not here
- **cAdvisor**: it needs host mounts that conflict with the read-only, no-capability hardening of this deployment. Container restarts and per-container CPU/memory are therefore **not collected** (use `docker stats` / `docker inspect`, or add cAdvisor on a host that allows it).
- **postgres-exporter**: the app holds no direct Postgres connection (Supabase REST), and a hosted Supabase cannot run host exporters. Database capacity comes from `kpi.database_now` (below); query-level latency, locks and slow queries are **not collected**. Add postgres-exporter when a direct connection exists (self-hosted Postgres / `DB_BACKEND=postgrest`).
- **Alertmanager**: no notification destination is decided, so none is configured. See [Alerting](#alerting).
- **Loki / Tempo / OpenTelemetry Collector / Kubernetes**: not needed.

## Start and stop

Prerequisites: the app is running (the monitoring stack attaches to its networks), and `env/<name>.env` has the monitoring block
(see `env/stage.env.example`).

```bash
# stage example; the app project is emithran-stage, so its networks are emithran-stage_internal and emithran-stage_edge
docker compose -p emithran-stage-mon -f docker-compose.monitoring.yml --env-file env/stage.env up -d
docker compose -p emithran-stage-mon -f docker-compose.monitoring.yml --env-file env/stage.env --profile host-metrics up -d   # + host metrics (Linux hosts)
docker compose -p emithran-stage-mon -f docker-compose.monitoring.yml --env-file env/stage.env down                          # stop (volumes kept)
docker compose -p emithran-stage-mon -f docker-compose.monitoring.yml --env-file env/stage.env down -v                       # stop and delete the data
```

Then point the apps at Prometheus (in `env/<name>.env`, and restart backend and engines; the apps need no rebuild):

```
# metrics to Prometheus, traces to the OTLP trace backend named by the base endpoint
OTEL_EXPORTER_OTLP_ENDPOINT=http://<openobserve-private-host>:5080/api/default
OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://prometheus:9090/api/v1/otlp/v1/metrics
# metrics only (no trace backend): base endpoint = Prometheus, traces dropped by sampling
OTEL_EXPORTER_OTLP_ENDPOINT=http://prometheus:9090/api/v1/otlp
OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://prometheus:9090/api/v1/otlp/v1/metrics
OTEL_TRACES_SAMPLER_ARG=0
```

Rollback: empty `OTEL_EXPORTER_OTLP_ENDPOINT` and restart; the SDK is not loaded and behaviour is as before.
Local development: set `APP_INTERNAL_NETWORK` / `APP_EDGE_NETWORK` to the dev compose's network (`<project>_backend-network`), use `-p`, and open `http://localhost:3001`.

**Grafana in stage/prd**: add a Cloudflare Tunnel public hostname routing to `http://grafana:3000`, protect it with Cloudflare Access, set `GRAFANA_ROOT_URL` to that URL and `GRAFANA_COOKIE_SECURE=true`. Grafana's own login stays on (no anonymous access, no sign-up).

## Environment variables
All are in the monitoring block of `env/*.env.example`. Required (no default): `APP_INTERNAL_NETWORK`, `APP_EDGE_NETWORK`, `GRAFANA_ADMIN_PASSWORD`, `GRAFANA_SECRET_KEY`.

| Variable | Meaning |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` / `OTEL_TRACES_SAMPLER_ARG` | App side. Empty endpoint = telemetry off. The metrics endpoint is a full URL and overrides `<endpoint>/v1/metrics` (backend, cad-engine, ecad-engine). |
| `GRAFANA_ADMIN_USER`, `GRAFANA_ADMIN_PASSWORD`, `GRAFANA_SECRET_KEY` | Grafana admin and the key that encrypts secrets Grafana stores. Generate; never commit. **Keep `GRAFANA_SECRET_KEY` stable once set**: changing it makes secrets already stored in the Grafana volume (for example a datasource or contact point added in the UI) unreadable. |
| `GRAFANA_ROOT_URL`, `GRAFANA_COOKIE_SECURE`, `GRAFANA_PORT` | Public URL, secure cookie, loopback port. |
| `GRAFANA_PG_HOST` (`host:port`), `_DATABASE`, `_USER`, `_PASSWORD`, `_SSLMODE` | The business-KPI datasource. Empty host = business panels show no data. |
| `PROM_RETENTION_TIME` (15d), `PROM_RETENTION_SIZE` (5GB) | Whichever limit is reached first deletes the oldest data. |

### Business-KPI database access (migration 933)
Migration `933_kpi_views.sql` creates schema `kpi` with aggregate views and the role `grafana_reader` **without a login**. Enable it outside git:
```sql
ALTER ROLE grafana_reader WITH LOGIN PASSWORD '<from the secret store>';
```
(On the Supabase pooler the user is `grafana_reader.<project-ref>`.) The role can read the `kpi` views and nothing else: not the tables behind them, not the audit trail, not `pg_stat_activity` (the views run as their owner). Migration 933 is **written and tested but not applied anywhere**; run it with `npm run db:migrate -- --env stage`.

## Metrics
Names are the OpenTelemetry names with dots as underscores and the unit as suffix. All labels are closed sets (never an id, URL, filename or user).

| Metric (Prometheus name) | Type | Labels | Source |
|---|---|---|---|
| `emithran_http_server_duration_seconds` | histogram | `http_request_method`, `http_route` (pattern), `emithran_status_class` | backend middleware (every request, guard rejections and 404s included) |
| `emithran_http_server_active_requests` | gauge | none | same middleware (new) |
| `emithran_costing_duration_seconds` | histogram | `emithran_operation` (cost_summary, route_comparison), `emithran_outcome` (ok, error) | `@Traced` on `getCostSummary` / `getRouteComparison`; the `_count` is the run count |
| `emithran_cad_upload_duration_seconds` | histogram | `emithran_outcome` (ok, error, retry) | CAD upload runner, one point per processing attempt (new) |
| `emithran_job_queue_depth` | gauge | `emithran_queue` (`cad_upload`, electronics queues) | read when metrics are exported; 2 s bound per queue (CAD upload reader new) |
| `emithran_engine_stage_duration_seconds` | histogram | `emithran_stage`, `emithran_outcome` | cad-engine / ecad-engine stages that exist (step_load, geometry_analysis, component_features, assembly_analysis, extract_board, render_board) |
| `http_client_request_duration_seconds` | histogram | `server_address`, status, method | outbound calls (database API, engines, FX) |
| `probe_success`, `probe_duration_seconds` | gauge | `job` (probe-live, probe-ready, probe-database, probe-engines), `engine` | blackbox |
| `node_*` | | | node-exporter |

Histogram buckets are explicit: HTTP 25 ms-30 s; costing 0.1-300 s; jobs and engine stages up to 10-30 minutes.
Resource labels: `job` = service name (`mithran-backend`, `mithran-cad-engine`), `deployment_environment_name` = `APP_ENV` (stage, prd).

## Dashboards (folder "Emithran")
| Dashboard | Shows |
|---|---|
| **Executive KPI Overview** | Top: live operational numbers (24 h). Bottom: daily business KPIs from the database. The two kinds are separated and labelled. |
| **Application Performance** | Service health, availability, throughput, status distribution, 5xx/4xx rate, p50/p95/p99, ordinary-route p95, slowest endpoints, requests in flight, outbound latency. |
| **CAD and Costing Engine** | Upload outcomes, duration, queue depth, engine stage durations, costing runs/duration/failure rate. |
| **Infrastructure and Database** | CPU, memory, disk, network, disk I/O, Prometheus footprint, database availability, connections, size, deadlocks, rollbacks. |

Use the **Environment** variable at the top to filter stage/prd when one Prometheus holds both.

## Business KPI definitions
Source of truth is the database (`kpi.*`, daily in UTC), not Prometheus. A job that is queued or running is never counted as failed.

| KPI | Definition | Unit | Window | Source |
|---|---|---|---|---|
| CAD processing success rate | uploads `done` / (`done` + `failed`) x 100, by `finished_at` day | % | day | `cad_uploads` via `kpi.cad_processing_daily` |
| BOM extraction success rate | same value: BOM extraction is the same job (the runner creates the BOM items in the upload job). Engine-only analysis success is not recorded separately. | % | day | same |
| Average BOM processing time | mean `finished_at - started_at` of `done` uploads (last attempt); also mean `durationMs` of audit `upload.completed` | s | day | `kpi.cad_processing_daily`, `kpi.bom_extraction_daily` |
| BOM items / parts created | sum of `items` / `parts` in audit `upload.completed` | count | day | `audit_events` |
| Costing analyses completed | count of audit `cost.applied` with outcome ok (a user applied a costed route) | count | day | `audit_events` via `kpi.costing_daily` |
| RFQs sent | count of audit `rfq.sent` | count | day | `kpi.rfq_daily` |
| Active organizations | distinct organizations with at least one successful audited event | count | day | `kpi.active_orgs_daily` |
| Upload queue | uploads `queued` or `analysed`, and the age of the oldest | count, s | now | `kpi.cad_queue_now` |
| Database | size, sessions (total, active, limit), deadlocks, commits, rollbacks | | now | `kpi.database_now` |
| Live success rates (Executive, top) | `ok` / (`ok` + `error`) of `emithran_cad_upload_duration_seconds_count` and `emithran_costing_duration_seconds_count` over 24 h; `retry` excluded | % | 24 h sliding | Prometheus |

**Not implementable today** (nothing durable records it; smallest change in brackets):
- Failed costing runs as a business KPI (an audit action `cost.failed`, recorded where a costing run ends in error). The live counter above covers operations.
- Supplier-evaluation and VAVE completions (an audit action where each workflow completes, then one more `kpi` view).
- Active users (no reliable per-user activity record that is safe to aggregate; would need a decision on what counts as activity).
- Material / machine-rate lookup failures (no code path reports a missing lookup as a distinct event; detect first, then count).
- Request timeouts (the backend has no request-timeout handler to count).
- Container restarts and per-container resources (cAdvisor, above). Query latency / slow queries (postgres-exporter, above).

## Alerting
`monitoring/prometheus/rules/alerts.yml`, 14 rules, evaluated by Prometheus; unit tests in `monitoring/prometheus/tests/alerts.test.yml`.
Thresholds are literals in the file (Prometheus rules take no variables): edit, `promtool check rules`, restart Prometheus. All are **initial values to tune from about a week of real baseline**.

| Alert | Condition | Hold | Severity | Response |
|---|---|---|---|---|
| AppDown | `/api/health/live` probe fails | 3 m | critical | Backend container/process or network; liveness depends on nothing external. |
| DatabaseUnavailable | database entry of `/ready` fails while live is up | 3 m | critical | Database provider status; Supabase free projects pause after a week idle. |
| EngineUnavailable | cad/ecad `/ready` fails | 5 m | warning | Engine container, memory limit (about 16 MB per MB of STEP). |
| BackendTelemetryMissing | backend live but no `target_info` for 10 m | 5 m | warning | `OTEL_*` on the backend; Prometheus receiver flag. Other alerts are blind without it. |
| HighServerErrorRate | 5xx > 5% of requests, and > 0.05 req/s | 10 m | critical | Application Performance dashboard; DB and engine alerts first. |
| HighApiLatencyP95 | p95 > 5 s on ordinary routes (long-running routes excluded), traffic > 0.05 req/s | 15 m | warning | Slowest endpoints panel; outbound latency. |
| CadProcessingFailureSpike | `error` / (`ok` + `error`) > 25% over 1 h, at least 5 finished; retries excluded | 10 m | warning | `error_code` in `cad_uploads`; engine alert and logs. |
| CostingFailureSpike | failed / all > 25% over 1 h, at least 10 runs | 10 m | warning | Costing traces; recent rate/reference-data migrations. |
| CostingSlow | costing p95 > 180 s over 30 m | 15 m | warning | Backend CPU, engine stage durations, database latency. |
| BackgroundQueueBacklog | queue depth > 10 for 15 m (minimum over the window) | 5 m | warning | Runner stopped (`CAD_UPLOAD_RUNNER=off` everywhere) or slow. |
| HighCpuUtilization | host CPU > 85% | 15 m | warning | `docker stats`; lower `MAX_CONCURRENT_ANALYSES`. |
| HighMemoryUtilization | host memory > 90% | 10 m | critical | Engine memory limits and concurrency. |
| DiskSpaceLow | < 15% free on any real filesystem | 10 m | critical | `docker system df`; log volumes; `PROM_RETENTION_SIZE`. |
| DiskWillFillIn24h | `predict_linear` over 6 h reaches 0 within 24 h | 30 m | warning | Find what is growing before the 15% alert. |
| DatabaseConnectionsHigh (Grafana-managed) | sessions > 80% of `max_connections` | 10 m | warning | The pooler, PostgREST, a runaway job; raise the limit or lower pools. Quiet when the KPI datasource is unreachable. |

**Notifications are not configured and nothing sends silently.** Alerts show at Prometheus `/alerts` (via `docker compose exec prometheus wget -qO- localhost:9090/api/v1/alerts`) and in Grafana. To notify: add Alertmanager (`prom/alertmanager`) with a receiver (email SMTP, Slack incoming webhook) kept in the env file / secret store and an `alerting:` block in `prometheus.yml`; or create a Grafana contact point in the UI and a notification policy. Do not commit webhook URLs or SMTP credentials.

## Security
- **Network**: Prometheus, blackbox and node-exporter are on private networks with no published port. The OTLP receiver has no authentication; the app's internal network is its boundary (the frontend also sits on it: keep it that way, and do not add untrusted containers to `internal`).
- **Grafana**: login required, no anonymous access or sign-up, loopback-only host port; deployed access through the tunnel plus Cloudflare Access.
- **Data**: no organization, user, file name, BOM or cost value is a metric label (closed label sets, enforced by the SDK allow-list and tests). Business panels read aggregate views only; `grafana_reader` has no access to base tables. Dashboards expose no tenant data, so one Grafana is operator-only: **operators see totals across all customers; no per-organization view exists**. A self-hosted customer runs its own isolated stack.
- **Secrets**: only in `env/*.env` (git-ignored) or the secret store; the compose file holds references. `test/deploy/monitoring-stack.test.ts` fails the build if an image is unpinned, a second port is published, the Docker socket is mounted, anonymous access is enabled, a dashboard queries a base table or groups by an identifier, or an alert lacks severity/hold/response.

## Troubleshooting
| Symptom | Check |
|---|---|
| Panels empty | Prometheus `/api/v1/label/__name__/values` has `emithran_*`? If not: `OTEL_*` set on the service, `BackendTelemetryMissing`, `--web.enable-otlp-receiver`, network attachment (`docker network inspect`). `increase()`/`rate()` need two exported samples (metrics export every 30 s). |
| Business panels empty | `GRAFANA_PG_HOST` set; migration 933 applied; `grafana_reader` has a login; datasource Test in Grafana; for pooler, user is `grafana_reader.<ref>`. |
| `AppDown` firing but the app works | Blackbox target names (`backend:4000`, `cad-engine:5055`, `ecad-engine:5100`) differ from your compose service names; edit `prometheus.yml`. |
| Engine panels empty | The engine has `OTEL_*` set; cad-engine and ecad-engine need a rebuild to include the metrics-endpoint override. |
| Node panels empty | Start with `--profile host-metrics` on a Linux host (Docker Desktop reports its VM; `rslave` on `/` is not supported there). |
| Restart Prometheus to apply rules | `docker compose ... restart prometheus` (rules are read at start), or `kill -HUP` via `docker kill -s HUP`. |

## Validation record (2026-10-30, local Docker Desktop)
What ran: the real Prometheus 3.15.1, Grafana 13.3.0, blackbox 0.29.1 and node-exporter 1.12.1 images; the backend's real telemetry code (`start.ts`, the HTTP middleware, the metric recorders) inside a small stand-in HTTP server on port 4000 (not the NestJS app); the real `cad-engine/shared/telemetry.py` driving stage metrics; a throwaway Postgres 17 with migrations 917-923, 930, 931, 933 and fixture rows.

| Check | Result |
|---|---|
| OTLP push to Prometheus from Node and Python, separate metrics endpoint | arrived; names and labels as in the table above |
| Every panel query of all 4 dashboards, executed through Grafana's query API | 0 errors; every panel returned rows once its source existed (engines, node-exporter, fixtures) except RFQs sent (no fixture rows) |
| Business panels | read the `kpi.*` views through `grafana_reader` (datasource health OK) |
| `promtool check config`, `check rules`, `test rules` | pass (14 rules, 8 unit-test scenarios incl. low-traffic and retry-only negatives) |
| Live alerts | `HighServerErrorRate`, `CadProcessingFailureSpike` went pending on injected failures; stopping the stand-in backend made `AppDown` go pending and **fire exactly after its 3 m hold**, and `EngineUnavailable` pending |
| Persistence | `docker compose down` (no `-v`) then `up`: Prometheus samples from before the restart still queryable; Grafana dashboards and datasource back |
| Security | only Grafana published (loopback); Prometheus unreachable from the host; anonymous API and sign-up answered 401; containers read-only, all capabilities dropped; no label value looked like an id, file name, email or token |
| Overhead | middleware cost with the real SDK: about 2.7 us per request (0.7 us with telemetry off), 200,000-request micro-benchmark; export every 30 s |
| Tests | backend jest 226 suites / 2,841 tests, SQL suite 10/10, `test/deploy` 40/40; engine telemetry config tests pass in a Python 3.12 container (the full-app engine test needs OpenCascade/slowapi and was not run there) |

Not exercised: the real NestJS app against Supabase, a real STEP upload through the full app, the real stage/prd networks, the Cloudflare Tunnel route, the Supabase pooler role, `DatabaseConnectionsHigh` firing (the rule loaded and its datasource query works; no real overload was produced), and host metrics on a Linux host (node-exporter ran against Docker Desktop's VM).

## Known limitations and next steps
- Not verified: behaviour against the real stage/prd networks, the Cloudflare Tunnel route to Grafana, the Supabase pooler role, and a real STEP upload through the full app (the runner metrics are unit-tested and driven through the real recorders, not through a live upload).
- Engines still need a rebuild to pick up the metrics-endpoint override.
- Per-environment Prometheus; a single Prometheus for stage and prd would need `deployment_environment_name` kept (it is) and one network path.
- Future: Alertmanager with a destination; cAdvisor and postgres-exporter where the host/DB allow; `cost.failed` and supplier/VAVE audit actions for the missing business KPIs; per-route timeouts and a timeout counter.
