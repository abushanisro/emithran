-- Read-only. Run in the Supabase SQL editor (or psql) for each project and keep the output with the budget in
-- docs/DEPLOYMENT_SECURITY.md. It answers: what is using the free tier's 0.5 GB database and 1 GB of storage?
-- If a statement fails because a table does not exist in that project, skip it and run the rest.

-- 1. Whole database against the 0.5 GB limit
SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size,
       round(100.0 * pg_database_size(current_database()) / (500 * 1024 * 1024), 1) AS percent_of_free_tier;

-- 2. The 25 biggest tables (data + indexes + TOAST), with row counts
SELECT n.nspname || '.' || c.relname AS "table",
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
       pg_size_pretty(pg_relation_size(c.oid)) AS table_only,
       pg_size_pretty(pg_total_relation_size(c.oid) - pg_relation_size(c.oid)) AS indexes_and_toast,
       c.reltuples::bigint AS approx_rows
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 25;

-- 3. Average and largest size of the big jsonb columns (how much one analysed part costs)
SELECT 'bom_items.feature_graph' AS "column", count(*) AS rows_with_value,
       pg_size_pretty(avg(pg_column_size(feature_graph))::bigint) AS average, pg_size_pretty(max(pg_column_size(feature_graph))::bigint) AS largest
FROM bom_items WHERE feature_graph IS NOT NULL
UNION ALL
SELECT 'bom_items.geometry_analysis', count(*),
       pg_size_pretty(avg(pg_column_size(geometry_analysis))::bigint), pg_size_pretty(max(pg_column_size(geometry_analysis))::bigint)
FROM bom_items WHERE geometry_analysis IS NOT NULL
UNION ALL
SELECT 'cad_uploads.result', count(*),
       pg_size_pretty(avg(pg_column_size(result))::bigint), pg_size_pretty(max(pg_column_size(result))::bigint)
FROM cad_uploads WHERE result IS NOT NULL;

-- 4. Tables that only ever grow: how many rows, and how old
SELECT 'api_request_logs' AS "table", count(*) AS rows, min(created_at) AS oldest FROM api_request_logs
UNION ALL SELECT 'cad_analysis_history', count(*), min(created_at) FROM cad_analysis_history
UNION ALL SELECT 'fx_rate_snapshots', count(*), min(created_at) FROM fx_rate_snapshots;

-- 5. Storage against the 1 GB limit (the free tier also refuses any single object over 50 MB)
SELECT bucket_id, count(*) AS objects,
       pg_size_pretty(coalesce(sum((metadata ->> 'size')::bigint), 0)) AS size,
       pg_size_pretty(coalesce(max((metadata ->> 'size')::bigint), 0)) AS largest_object
FROM storage.objects GROUP BY bucket_id ORDER BY coalesce(sum((metadata ->> 'size')::bigint), 0) DESC;

-- 6. Is pg_cron available here? (retention in migration 918 depends on it)
SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name = 'pg_cron';
