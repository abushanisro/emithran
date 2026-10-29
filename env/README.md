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
| `SUPABASE_URL` | the project URL | Supabase, Project Settings, API |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...`, safe for the browser; becomes the frontend's key and the backend's `SUPABASE_ANON_KEY` | API Keys |
| `SUPABASE_SECRET_KEY` | `sb_secret_...`, **server only, never in the frontend**; becomes the backend's `SUPABASE_SERVICE_KEY` | API Keys |
| `MIGRATE_DATABASE_URL` | Postgres connection string for the migration runner only (the app holds no database connection); use the **session-mode pooler, port 5432** (not 6543, not the IPv6-only direct host) | Connect, Session pooler |
| `CAD_ENGINE_API_KEY`, `ECAD_ENGINE_API_KEY` | shared secrets between the backend and the engines | generate: `openssl rand -hex 32` |
| `TUNNEL_TOKEN` | the Cloudflare Tunnel token; the tunnel is the only way into the host (no published ports) | Cloudflare Zero Trust, Tunnels |
| `NEXT_PUBLIC_API_GATEWAY_URL`, `CORS_ORIGIN` | the public URL of the app, the same value for both: Cloudflare serves the frontend there and routes `/v1/*` to the backend, so the API is same-origin. The engines have no public URL | your DNS |

Never paste a secret key, a database password or a connection string into chat, an issue or a commit.
