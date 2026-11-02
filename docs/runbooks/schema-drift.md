# Schema drift (nightly check)

`.github/workflows/ops.yml`, job `schema-drift`, runs every night for stage and production: it builds the schema main describes
(the schema-only baseline, then every migration after `backend/migrations/BASELINE.json`) in a throwaway Postgres, dumps the live
`public` schema read-only, and fails on any difference. A failed run is the alert (GitHub notifies on failed scheduled runs; the
diff is in the run summary). Script: `backend/scripts/schema-drift.sh`; test: `npm run test:schema-drift` in `backend/`.

Compared: tables, columns, defaults, constraints, indexes, views, functions, triggers, policies. Not compared: grants (the baseline
dump carries none) and owners.

## One-time setup per environment

1. **A read-only role.** As the database owner:
   ```sql
   CREATE ROLE schema_reader LOGIN PASSWORD '<generate: openssl rand -hex 24>';
   ALTER ROLE schema_reader SET default_transaction_read_only = on;
   -- pg_dump locks every table it describes (ACCESS SHARE), which needs SELECT; this role can read but never write.
   GRANT pg_read_all_data TO schema_reader;
   ```
2. **The secret.** GitHub → Settings → Environments → `stage` / `production` → secret `SCHEMA_READER_DATABASE_URL` =
   `postgresql://schema_reader:<password>@<host>:5432/postgres?sslmode=require`. Without it the job fails ("not set"): an unchecked
   schema is never reported as clean.
3. **The baseline.** The schema the migrations after `BASELINE.json` were first applied to, structure only (no rows, no users):
   `backend/scripts/baseline-dump.sh --schema-only "<read-only url of that database>" backend/migrations/baseline`, committed. It
   is the same baseline a new installation starts from. Until it is committed the job fails ("no schema-only baseline").

## When it fails

- **`-` lines** are in main but not live: a migration was not applied (`npm run db:migrate -- --env <env> --dry-run` lists it) or
  an object was dropped by hand.
- **`+` lines** are live but not in main: something was created or changed outside migrations (a dashboard edit, a hotfix). Either
  write a migration that makes main match (and review it like any other change), or remove the object.
- A function or policy that differs in body is the dangerous case: it may be a security change nobody reviewed. Treat it as an
  incident until explained.

Fix by migration, never by editing the baseline. Re-run the job (Actions → Operations → Run workflow) to confirm.
