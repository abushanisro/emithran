-- ============================================================================
-- Migration 933: aggregate business-KPI views and a read-only role for Grafana
-- ============================================================================
-- The business dashboards (docs/ops/monitoring.md) read durable records, not Prometheus. Everything here is a daily or
-- current total: no organization, user, file name, BOM or cost value is exposed, so an operator's Grafana cannot leak a tenant's data.
--
--   kpi.cad_processing_daily  uploads that reached a final state per day: done, failed, success rate, duration (from cad_uploads)
--   kpi.bom_extraction_daily  uploads completed, BOM items and distinct parts created, mean engine+create time (from audit_events)
--   kpi.costing_daily         cost analyses applied per day (audit action cost.applied)
--   kpi.rfq_daily             RFQs sent per day (audit action rfq.sent)
--   kpi.active_orgs_daily     organizations with at least one audited event per day (a count, never ids)
--   kpi.cad_queue_now         uploads waiting right now, and the age of the oldest
--   kpi.database_now          database size, sessions (total, active, limit), deadlocks, commits, rollbacks (counts only, never query text)
--
-- Not here, on purpose (nothing durable records them): failed costing runs, supplier-evaluation and VAVE completions.
--
-- grafana_reader is created without a login. The operator enables it out of band, so no password is ever in a migration:
--   ALTER ROLE grafana_reader WITH LOGIN PASSWORD '<from the secret store>';
-- (on the Supabase pooler the user name is grafana_reader.<project-ref>). It can read the kpi views and nothing else.
-- The views run as their owner, so it needs no access to the tables behind them. Idempotent.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS kpi;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grafana_reader') THEN
    CREATE ROLE grafana_reader NOLOGIN NOINHERIT;
  END IF;
END $$;

-- Terminal states only: a queued or running upload is neither a success nor a failure. Days are UTC.
-- Duration is the last attempt (started_at is set at each claim), for uploads that finished.
CREATE OR REPLACE VIEW kpi.cad_processing_daily AS
SELECT
  (finished_at AT TIME ZONE 'UTC')::date                                                    AS day,
  count(*) FILTER (WHERE status = 'done')                                                   AS completed,
  count(*) FILTER (WHERE status = 'failed')                                                 AS failed,
  round(100.0 * count(*) FILTER (WHERE status = 'done') / NULLIF(count(*), 0), 1)           AS success_rate_pct,
  round(avg(EXTRACT(EPOCH FROM finished_at - started_at)) FILTER (WHERE status = 'done' AND started_at IS NOT NULL)::numeric, 1) AS avg_seconds,
  round((percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM finished_at - started_at))
         FILTER (WHERE status = 'done' AND started_at IS NOT NULL))::numeric, 1)            AS p95_seconds
FROM public.cad_uploads
WHERE status IN ('done', 'failed') AND finished_at IS NOT NULL
GROUP BY 1;

-- upload.completed carries meta.items, meta.parts and meta.durationMs (audit-actions.ts); only numbers are read.
CREATE OR REPLACE VIEW kpi.bom_extraction_daily AS
SELECT
  (at AT TIME ZONE 'UTC')::date                                                             AS day,
  count(*)                                                                                  AS uploads_completed,
  COALESCE(sum((meta ->> 'items')::bigint), 0)                                              AS bom_items_created,
  COALESCE(sum((meta ->> 'parts')::bigint), 0)                                              AS distinct_parts,
  round((avg((meta ->> 'durationMs')::numeric) / 1000.0), 1)                                AS avg_seconds
FROM public.audit_events
WHERE action = 'upload.completed' AND outcome = 'ok'
GROUP BY 1;

CREATE OR REPLACE VIEW kpi.costing_daily AS
SELECT (at AT TIME ZONE 'UTC')::date AS day, count(*) AS analyses_applied
FROM public.audit_events
WHERE action = 'cost.applied' AND outcome = 'ok'
GROUP BY 1;

CREATE OR REPLACE VIEW kpi.rfq_daily AS
SELECT (at AT TIME ZONE 'UTC')::date AS day, count(*) AS rfqs_sent
FROM public.audit_events
WHERE action = 'rfq.sent' AND outcome = 'ok'
GROUP BY 1;

-- A denied request is not activity.
CREATE OR REPLACE VIEW kpi.active_orgs_daily AS
SELECT (at AT TIME ZONE 'UTC')::date AS day, count(DISTINCT org_id) AS active_organizations
FROM public.audit_events
WHERE org_id IS NOT NULL AND outcome = 'ok'
GROUP BY 1;

CREATE OR REPLACE VIEW kpi.cad_queue_now AS
SELECT
  count(*)                                                                                  AS waiting,
  COALESCE(round(EXTRACT(EPOCH FROM now() - min(created_at))::numeric), 0)                  AS oldest_seconds
FROM public.cad_uploads
WHERE status IN ('queued', 'analysed');

-- Counts only. The view runs as its owner, so the reader needs no pg_monitor membership and never sees a query, a user or a client
-- address. Sessions are those of this database (the pooler's and PostgREST's connections included); the limit is the server's.
CREATE OR REPLACE VIEW kpi.database_now AS
SELECT
  pg_database_size(current_database())                                                                  AS db_bytes,
  (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())                            AS connections,
  (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active')       AS active_connections,
  current_setting('max_connections')::int                                                               AS max_connections,
  d.deadlocks,
  d.xact_commit,
  d.xact_rollback
FROM pg_stat_database d
WHERE d.datname = current_database();

-- Nobody but the reader (and the owner) can touch the schema; the API roles never see it.
REVOKE ALL ON SCHEMA kpi FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA kpi FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA kpi FROM anon;
    REVOKE ALL ON ALL TABLES IN SCHEMA kpi FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON SCHEMA kpi FROM authenticated;
    REVOKE ALL ON ALL TABLES IN SCHEMA kpi FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON SCHEMA kpi FROM service_role;
    REVOKE ALL ON ALL TABLES IN SCHEMA kpi FROM service_role;
  END IF;
END $$;

GRANT USAGE ON SCHEMA kpi TO grafana_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA kpi TO grafana_reader;
