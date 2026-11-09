# Railway environments

How a Railway environment's database is created and seeded, and the rules that came out of doing it. Scripts: `provision-postgres.sh`,
`seed-environment.sh`, `deploy-data-api.sh`, `deploy-engine.sh` (shared helpers in `common.sh`). Everything runs from your machine with the Railway CLI (`brew install railway`, then `railway login`).

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

## Deploy the services

After the database is seeded, in this order, each refusing to run twice and reading its settings from `env/stage.env` (staging) or
`env/prd.env` (production), never printing a value:

```bash
deploy/railway/deploy-data-api.sh staging            # sets the authenticator password (private job), then PostgREST
deploy/railway/deploy-engine.sh staging ecad-engine  # built from ecad-engine/Dockerfile
deploy/railway/deploy-engine.sh staging cad-engine   # built from cad-engine/Dockerfile (conda + OpenCASCADE: heavy)
deploy/railway/deploy-backend.sh staging             # backend/Dockerfile unchanged (Rust nester + Nest app); needs the storage and Auth0 values
deploy/railway/deploy-frontend.sh staging            # Dockerfile.frontend unchanged; needs AUTH0_CLIENT_ID / AUTH0_CLIENT_SECRET
deploy/railway/probe-environment.sh staging          # from INSIDE the environment: can each service reach its neighbours (IPv4 / IPv6)?
```

- **The backend** needs `core/` as a named build context, which Railway cannot pass: the build folder holds backend/ plus `core/{Cargo.toml,Cargo.lock,crates}`, and a
  `Dockerfile.railway` that is the repo's Dockerfile unchanged behind `FROM scratch AS core` / `COPY core /`, so `COPY --from=core` resolves to that stage.
- **The frontend** builds from the repo root, so the upload is the tracked files minus the folders `.dockerignore` already excludes (11 MB instead of 83 MB).
- **Railway's Free plan allows 5 services per project** (`Free plan resource provision limit exceeded`). Staging's postgres, postgrest, two engines and backend are five.
  The frontend, the `cloudflared` tunnel service, the probe and a production environment need a paid plan.

- **PostgREST** is the image pinned in `docker-compose.prod.yml` (read from it, so there is one pin) with that service's settings. It connects as
  `authenticator` over the private address with TLS. `DB_JWT_SECRET` must be the value the backend uses (compose passes it to both).
- **The engines** have no public domain; only the backend reaches them (`http://<engine>.railway.internal:<port>`). Their API key is the value the backend sends.
- **Never run a bare `railway domain`**: without a subcommand it *creates* a public domain. List with `railway domain list`.

Lessons the scripts encode (each was a real failure while building them, and a test now prevents it):

- Never search `railway`'s output through a pipe whose reader can stop early (`| grep -q`, `| awk '{...; exit}'`): the writer dies with SIGPIPE and under
  `pipefail` + `set -e` the script **exits silently**. Capture the text, then use a here-string.
- Never run these scripts with `bash -x`: trace mode prints the secrets they handle. The scripts install an ERR trap that names the failing line instead.
- `railway add` echoes every variable it is given, so secrets are set afterwards through stdin.

## What was verified, and what was not

Verified on staging: PostgREST connects as `authenticator` and loads the schema (234 relations, 94 functions); `ecad-engine` and `cad-engine` start and serve on their ports;
no service has a public domain. Postgres 17 starts on its volume; the baseline loads (216 tables, 3 users, every row count matches); all 54
migrations apply; a second run applies none; production without `CONFIRM_PRODUCTION=yes` is refused; the provisioner refuses an existing
database; a bootstrap into a loaded database refuses and leaves nothing behind.

Not verified or not done:

- **Restart policy of a failed job.** The jobs set `restartPolicyType: NEVER`, but a bootstrap that failed was restarted by Railway several
  times (its refusal message appeared six times). It is harmless here (the loader refuses a non-empty database; the runner is idempotent),
  but the setting is not behaving as written. Check it before relying on a one-shot job for anything that is not idempotent.
- **TLS to the database.** The runner uses TLS to any non-local host but does not verify the certificate unless `MIGRATE_DATABASE_SSL_CA`
  is set. Inside Railway's private network the Postgres template presents its own certificate. It is accepted as is.
- **`backend`, `frontend` and `cloudflared`**: not deployed. The backend needs the file-storage values (Cloudflare R2: bucket, S3 keys, endpoint,
  `TRUSTED_STORAGE_HOSTS`) and the frontend needs `AUTH0_CLIENT_ID` / `AUTH0_CLIENT_SECRET`; none exist yet. `cloudflared` needs the tunnel's
  published routes pointed at the Railway private addresses.
- **`cad-engine` under load.** It builds (conda + OpenCASCADE) and starts serving on staging, but a real CAD analysis has not been run: that needs the
  backend and file storage. Its memory use under a real part is unmeasured, and compose's limits (CPU, memory, one analysis at a time) are not
  applied on Railway. Measure it with a real upload before relying on it, and watch `railway metrics`.
- **Production**: not created yet (duplicate the finished staging environment, then rotate every secret).

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
