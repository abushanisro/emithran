# Running the ecad-engine

Everyday runbook. What the service does and how it is tested: [`README.md`](./README.md).

The engine is pure Python (Gerbonara, openpyxl), so unlike the CAD engine it runs **natively** as well as in Docker. It refuses
every request until `ECAD_ENGINE_API_KEY` is set. The backend must be given the **same** key.

## 1. Start it

**Native Windows (no Docker)** - one command from the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File ecad-engine/scripts/start-local.ps1
```

It needs Python 3.11 or 3.12 (the pinned pydantic-core has no wheel for 3.14 yet). The first run creates `ecad-engine/.venv`
from the first one it finds: `-Python <path>`, the py launcher (`py -3.12`, `py -3.11`), or a conda environment with 3.12/3.11
(on this machine: the conda env `mithran`). Later runs reuse `.venv`. The API key is read from `ECAD_ENGINE_API_KEY`, then
`ecad-engine/.env`, then `backend/.env`, so the engine and the backend share one key without copying it by hand (a random key
is generated only when none exists). Leave the window open; Ctrl+C stops it. If port 5100 is busy the script says which process
holds it. Check: `curl http://127.0.0.1:5100/ready` answers `{"ready": true}`.

**Docker (the production image, source mounted, reloader on)** - same WSL pattern as the CAD engine:

```powershell
wsl -d Ubuntu-24.04 -- bash -lc "cd /mnt/c/Users/singi/OneDrive/Desktop/mithran/ecad-engine && ECAD_ENGINE_API_KEY=<key> docker compose -f docker-compose.dev.yml up --build"
```

**Whole platform** - `docker compose up` at the repo root starts `ecad-engine` beside the backend and wires `ECAD_ENGINE_URL` for you
(it needs `ECAD_ENGINE_API_KEY` in the environment).

## 2. Point the backend at it

In `backend/.env` (same key as the engine):

```
ECAD_ENGINE_URL=http://127.0.0.1:5100
ECAD_ENGINE_API_KEY=<the key>
ELECTRONICS_QUEUE_DRIVER=memory      # local development: jobs run in-process (use pg-boss + ELECTRONICS_QUEUE_DATABASE_URL elsewhere)
```

Restart the backend: it reads `.env` at start. Migrations 912 to 916 must be applied.

## 3. Check it

```powershell
curl http://127.0.0.1:5100/health          # status ok, capabilities, limits, library versions
curl http://127.0.0.1:5100/ready           # {"ready": true}: the API key is configured
```

To check extraction, upload a real board set in a project's Electronics module and compare the measured values with your drawing.

## 4. Test it

| What | Command | Needs |
|---|---|---|
| Engine service and contract tests (no board files needed) | `python -I -m pytest -q` in `ecad-engine/` (or `docker compose -f docker-compose.dev.yml run --rm tests`) | requirements-dev |
| Backend unit specs | `cd backend && npx jest src/modules/electronics-costing` | - |
| Whole stack | upload a real board set in the project's Electronics module | dev servers on :3000 and :4000, engine running, migrations 912 to 916 |

## 5. Endpoints

| | |
|---|---|
| `GET /` `GET /health` `GET /ready` | information, capabilities and limits, readiness (no key needed) |
| `POST /extract/board` | multipart `files` + JSON `manifest` -> feature graph, attached documents, file report (header `X-API-Key`) |
| `POST /render/board` | same request shape -> layered SVG preview on one shared frame |

Every response carries `X-Request-ID` (your own is echoed); logs carry it too and never carry file names or content.

## Settings (environment)

| Variable | Default | |
|---|---|---|
| `ECAD_ENGINE_API_KEY` | none | required; the service refuses requests without it |
| `PORT` / `HOST` | 5100 / 0.0.0.0 | |
| `ECAD_MAX_FILE_MB` / `ECAD_MAX_FILES` | 25 / 40 | per-file size and files per request |
| `ECAD_RATE_LIMIT` | 30/minute | per client address |
| `CORS_ORIGINS` | localhost:3000, localhost:4000 | comma separated; `*` is refused in production |
| `LOG_LEVEL` / `ENVIRONMENT` | INFO / development | |

## Troubleshooting

- **`Address already in use` on start**: an old instance still holds the port. `netstat -ano | findstr :5100`, then `taskkill /PID <pid> /F`.
- **Upload fails with `extraction_unavailable`**: the backend cannot reach the engine or has no key. Check the two `.env` lines and restart the backend.
- **`Failed to build pydantic-core`**: you are on Python 3.14. Use 3.12 (`py -3.12`).
- **Jobs sit in `queued`**: the backend has `ELECTRONICS_QUEUE_DRIVER` unset or pg-boss without `ELECTRONICS_QUEUE_DATABASE_URL`.
