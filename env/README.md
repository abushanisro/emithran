# Environment files

**Local development** uses exactly one file: the repo-root `.env` (copy `.env.example`; git-ignored). Next.js, the backend, both
engines and the tests all read it, so there is no `.env.local`, `.env.development`, `backend/.env` or `cad-engine/.env`. Per-service
names where one name would collide (`BACKEND_PORT`, `CAD_ENGINE_PORT`, `ECAD_ENGINE_PORT`); `NODE_ENV` is never set (each tool sets
it). **Deployed environments** below keep one file each, on the host.

One env file per environment, kept **on the host that runs it**, never in git (`env/*.env` is ignored). Copy the template,
fill in the secrets, and pass it to compose:

```bash
cp env/stage.env.example env/stage.env        # then edit env/stage.env
docker compose -p emithran-stage  -f docker-compose.prod.yml --env-file env/stage.env  build
docker compose -p emithran-stage  -f docker-compose.prod.yml --env-file env/stage.env  up -d
```

`-p` gives each environment its own container and network names, so stage and PRD can sit side by side on one host.
Build the frontend image **per environment**: `NEXT_PUBLIC_*` values are compiled into the browser bundle at build time.

| Variable | What it is | Where it comes from |
|---|---|---|
| `APP_ENV` | `stage` or `prd`; the backend refuses to boot in production without it | you |
| `MIGRATE_DATABASE_URL` | Postgres connection string for the migration runner and the nightly backup only (the app reaches the database through PostgREST) | your managed Postgres |
| `POSTGREST_DB_URI` | connection string of the `authenticator` role, used by the PostgREST service | your managed Postgres (password set outside git) |
| `DB_JWT_SECRET` | the one secret the backend signs database tokens with and PostgREST verifies; **server only** | generate: `openssl rand -hex 32` |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | the file bucket and a key limited to it; `S3_ENDPOINT` only for R2 or MinIO | your S3-compatible provider |
| `TRUSTED_STORAGE_HOSTS` | the bucket's download host, which the file proxy and the browser's 3D viewer may fetch from | your S3-compatible provider |
| `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `AUTH0_CLAIM_NAMESPACE` | the tenant, the API identifier and the post-login Action's claim namespace | Auth0 (docs/CUTOVER_AUTH0_POSTGRES.md) |
| `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `APP_BASE_URL` | the web app's Auth0 application, its session secret and the public app URL; **server only** | Auth0; `AUTH0_SECRET`: `openssl rand -hex 32` |
| `CAD_ENGINE_API_KEY`, `ECAD_ENGINE_API_KEY` | shared secrets between the backend and the engines | generate: `openssl rand -hex 32` |
| `TUNNEL_TOKEN` | the Cloudflare Tunnel token; the tunnel is the only way into the host (no published ports) | Cloudflare Zero Trust, Tunnels |
| `NEXT_PUBLIC_API_GATEWAY_URL`, `CORS_ORIGIN` | the public URL of the app, the same value for both: Cloudflare serves the frontend there and routes `/v1/*` to the backend, so the API is same-origin. The engines have no public URL | your DNS |

Never paste a secret key, a database password or a connection string into chat, an issue or a commit.
