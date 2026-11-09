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

## Enabling the nightly checks

The workflow runs for an environment only once it is enabled. Until then the `plan` job ends the run with a yellow warning ("Operations
is not enabled for any environment") and nothing else runs, so an environment whose database does not exist yet is not reported as a
failed backup every night.

After the three steps above are done for an environment (and its backup secrets `MIGRATE_DATABASE_URL` and `BACKUP_AGE_RECIPIENT`
are set), add it to the repository variable `OPS_ENVIRONMENTS` (Settings -> Secrets and variables -> Actions -> Variables), for example
`stage` first and later `stage production`. Names are separated by spaces, commas or lines; any name other than `stage` and
`production` fails the plan job, so a typo cannot silently switch off a live environment's backups. Then run the workflow once by hand
(Actions -> Operations -> Run workflow) and confirm the backup artifact and a clean comparison.

From that moment every rule below applies: a missing secret or baseline fails the job. Do not enable an environment before its
database exists, and do not leave a live one out of the variable.

## When it fails

- **`-` lines** are in main but not live: a migration was not applied (`npm run db:migrate -- --env <env> --dry-run` lists it) or
  an object was dropped by hand.
- **`+` lines** are live but not in main: something was created or changed outside migrations (a dashboard edit, a hotfix). Either
  write a migration that makes main match (and review it like any other change), or remove the object.
- A function or policy that differs in body is the dangerous case: it may be a security change nobody reviewed. Treat it as an
  incident until explained.

Fix by migration, never by editing the baseline. Re-run the job (Actions → Operations → Run workflow) to confirm.
