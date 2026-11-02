# Self-hosted data tier (Postgres and file storage on your own machine)

Emithran needs a Postgres 16+ and an S3-compatible bucket. It does not care where they run. Two ways:

- **Managed services** (RDS, Cloud SQL, Azure, Neon; S3 or a gateway): use `docker-compose.prod.yml` alone and put their addresses in the env file.
- **Your own server or a customer's** (any cloud, on-premises): layer `docker-compose.data.yml` over it. It adds Postgres 17 and SeaweedFS (S3 API) on the private `db` network, each hardened like the other services (read-only filesystem, no capabilities, resource limits).

Checked on 2026-11-03: on a fresh `docker-compose.data.yml` Postgres, a schema-only baseline loads and migrations 930-954 apply with no errors; the storage container creates a bucket with the configured key and refuses a wrong one.

## First start

Env file (`env/stage.env` or `env/prd.env`), besides the settings in `env/*.env.example`:

```
POSTGRES_PASSWORD=<long random>          # the superuser; db:migrate and backups use it
S3_ENDPOINT=http://storage:8333
S3_FORCE_PATH_STYLE=true
S3_REGION=us-east-1
S3_BUCKET=emithran
S3_ACCESS_KEY_ID=<random>                # the only key the file store accepts
S3_SECRET_ACCESS_KEY=<long random>
POSTGREST_DB_URI=postgres://authenticator:<authenticator password>@postgres:5432/postgres
MIGRATE_DATABASE_URL=postgresql://postgres:<POSTGRES_PASSWORD, percent-encoded>@127.0.0.1:5432/postgres
```

```
P="docker compose -p emithran-prd -f docker-compose.prod.yml -f docker-compose.data.yml --env-file env/prd.env"
$P up -d postgres storage                       # data tier first

# 1. Create the bucket (once)
docker run --rm --network emithran-prd_db -e AWS_ACCESS_KEY_ID=<key> -e AWS_SECRET_ACCESS_KEY=<secret> -e AWS_DEFAULT_REGION=us-east-1 \
  amazon/aws-cli --endpoint-url http://storage:8333 s3 mb s3://emithran

# 2. Load the data (from the old database) or start empty
cd backend
./scripts/baseline-dump.sh '<old database url>' ~/emithran-baseline        # read-only on the old database
DOCKER_NETWORK=emithran-prd_db ./scripts/baseline-load.sh ~/emithran-baseline 'postgres://postgres:<POSTGRES_PASSWORD>@postgres:5432/postgres'
# (new installation with no old data: use --schema-only on a reference database, or ask for the schema baseline)

# 3. Password of the data API's role (once), then the migrations
docker exec -i $(docker compose -p emithran-prd ps -q postgres) psql -U postgres -c "ALTER ROLE authenticator WITH LOGIN PASSWORD '<authenticator password>'"
npm run db:migrate -- --env prd --dry-run && npm run db:migrate -- --env prd --confirm

cd .. && $P up -d --build                       # then the application
```

## Operations
- Postgres listens on `127.0.0.1:${PG_PORT:-5432}` of the host only, for `db:migrate` and backups. Nothing is published to the network.
- Back up the database with `backend/scripts/baseline-dump.sh` (or `pg_dump`) and the `storage-data` volume with a volume snapshot. `backend/scripts/restore-check.sh` proves a backup restores.
- Files are fetched by the browser through signed URLs on `S3_ENDPOINT`: for a deployment people reach from outside, publish the file store behind your reverse proxy under a public hostname, set `S3_ENDPOINT` and `TRUSTED_STORAGE_HOSTS` to it. (The enterprise reverse-proxy compose, plan step 8, is not built yet.)
