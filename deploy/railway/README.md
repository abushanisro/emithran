# Railway environments

How a Railway environment's database is created and seeded, and the rules that came out of doing it. Scripts: `provision-postgres.sh`,
`seed-environment.sh`. Everything runs from your machine with the Railway CLI (`brew install railway`, then `railway login`).

## Rules

1. **The database never has a public address.** No TCP proxy, no public URL. Other services reach it on Railway's private network through
   the reference variable `${{postgres.DATABASE_URL}}`. Loading and migrating therefore run as temporary jobs *inside* the environment.
2. **Postgres 17.** It is the major version CI's SQL tests run on, and `ops.yml`'s `pg_dump` client is 17 (a 17 client refuses to dump a
   newer server). Railway's default template is 18: `provision-postgres.sh` pins the 17 image by digest instead.
3. **No secret on a command line or on screen.** The Postgres password is generated and sent through stdin. `railway add` echoes every
   variable it is given, so its output is only shown when it fails.
4. **Railway service names are unique per *project*, not per environment.** A second environment's database is therefore created by
   *duplicating a finished environment* (`railway environment new <name> --duplicate <source>`), not by running the provisioner again
   (it refuses and says so). A duplicate copies variables, so **rotate the new environment's secrets before its database is first used**.
5. **The runtime settings of every environment are separate.** Never reuse one environment's tokens, keys or passwords in another.

## Create and seed an environment

```bash
deploy/railway/provision-postgres.sh staging                       # Postgres 17, one volume, generated password
deploy/railway/seed-environment.sh staging ~/emithran-baseline     # baseline, then every migration after it
deploy/railway/seed-environment.sh staging --migrate-only          # every later release: only the new migrations
CONFIRM_PRODUCTION=yes deploy/railway/seed-environment.sh production --migrate-only
```

`seed-environment.sh` runs two temporary services and deletes both afterwards (also on failure), and removes the temporary folder that
holds a copy of the baseline:

| Job | Runs | Result it must print |
|---|---|---|
| `bootstrap` | `backend/scripts/baseline-load.sh`, **unmodified**, in a container of the same pinned `postgres:17-alpine` image (a stand-in `docker` command runs each of the script's database commands in place). It refuses a database that already has tables. | `baseline loaded: N tables and U users, every count matches` |
| `migrate` | `backend/scripts/migrate.ts`, the repo's runner: every migration after `migrations/BASELINE.json`, each in its own transaction, under an advisory lock. Production adds `--confirm`. | the first line's `P pending` equals the number of `applied` lines, and there is no `x` line |

The script reads success from the job's log. A job's own exit status is not trusted.

**The baseline** (`~/emithran-baseline`, from `backend/scripts/baseline-dump.sh`) carries reference data and the user directory. It is never
committed and is copied only into a temporary folder. The old database did not enforce two foreign keys, so 72 rows have no parent
(`capability_criteria` 30, `nomination_evaluation_criteria` 42). The loader stops on them by design; `DROP_DANGLING=1` (the script's default)
sets them aside and loads the rest. They remain in the baseline file. Set `DROP_DANGLING=0` to stop instead.

## What was verified, and what was not

Verified on staging: Postgres 17 starts on its volume; the baseline loads (216 tables, 3 users, every row count matches); all 54
migrations apply; a second run applies none; production without `CONFIRM_PRODUCTION=yes` is refused; the provisioner refuses an existing
database; a bootstrap into a loaded database refuses and leaves nothing behind.

Not verified or not done:

- **Restart policy of a failed job.** The jobs set `restartPolicyType: NEVER`, but a bootstrap that failed was restarted by Railway several
  times (its refusal message appeared six times). It is harmless here (the loader refuses a non-empty database; the runner is idempotent),
  but the setting is not behaving as written. Check it before relying on a one-shot job for anything that is not idempotent.
- **TLS to the database.** The runner uses TLS to any non-local host but does not verify the certificate unless `MIGRATE_DATABASE_SSL_CA`
  is set. Inside Railway's private network the Postgres template presents its own certificate. It is accepted as is.
- **The rest of the stack** (`postgrest`, `backend`, `frontend`, `cad-engine`, `ecad-engine`, `cloudflared`), **file storage** (Cloudflare R2)
  and **production**: not created yet.

## Production

Create it after staging is complete, by duplicating it, then rotate its secrets before first use:

```bash
railway environment new production --duplicate staging
# new Postgres password, a new TUNNEL_TOKEN, new BFF_FORWARD_SECRET / DB_JWT_SECRET / engine keys, new Auth0 client if it has its own tenant
CONFIRM_PRODUCTION=yes deploy/railway/seed-environment.sh production ~/emithran-baseline
```

Isolation is weaker than `docker-compose.prod.yml`: Railway cannot give the CAD engines a network with no internet, read-only filesystems or
dropped capabilities (`docs/DEPLOYMENT_SECURITY.md`). Keep the engines on the private network with no public domain, and accept the
remaining risk consciously before real customer files are uploaded.

## Troubleshooting

- `Railway volume not mounted to the correct path` in the Postgres log: the volume is missing or at the wrong path; it must be
  `/var/lib/postgresql/data`.
- `refusing: the target already has N table(s)`: the database is already loaded. Use `--migrate-only`.
- A job's log is read with `railway service logs --service <name> --environment <env>`; the services are deleted when the script ends, so
  run the script again, or read the log it prints on failure.
