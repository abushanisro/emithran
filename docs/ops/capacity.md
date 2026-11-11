# Capacity of the production servers (measured 2026-11-11)

Production runs on two Always Free `VM.Standard.E2.1.Micro` servers (1 GB RAM and one-eighth of a CPU core with bursts, each; `infra/oracle/MICRO.md`).
These numbers are measurements from the live servers with a real signed-in session (`scripts/loadtest/`), not estimates.

| Layer | Sustained | Notes |
|---|---|---|
| Front door (Cloudflare, tunnel, frontend) | about 25-30 requests/s | `/api/health`; 45/s without a session cookie, 29/s with one (session handling is about 12 ms CPU per request) |
| Signed-in API (frontend proxy, backend, data API, database) | about 4 requests/s | a trivial call; latency 2 s at 10 parallel users, 4 s at 25 |
| Data API + database | 30-36 queries/s | no failures up to 50 parallel; 0.3-1.5 s per query |
| CAD engine | about 1 analysis/s, one at a time | 21, 137 and 391 KB parts; more in parallel are refused (429) by the engine's own gate |
| Per-user throttle | 100 requests/min per route | by design (`backend/src/common/throttling`) |

The hypervisor takes 45-76 % of the CPU under load (CPU steal): the small shape's burst limit, not a fault.

## What that means for users
Opening one page makes 10-20 API calls, so the sustainable rate is roughly one page load every 3-5 seconds for everybody together:
**comfortable for 3-5 people working at once, usable for about 10 with 2-5 s pages, not for 50.** One CAD job at a time.

## Where the cost is (profiled on the backend, 1,350 real requests)
- The Node backend is not the bottleneck: 95 % of its time is waiting for the data API; about 6 ms CPU per request on a fast core.
- The six machine-rate "distinct" lists cost 25-80 times an ordinary call (138-258 ms vs 3-10 ms): each read all 6,472 rows in 7 sequential pages.
  Cached per user for 5 minutes since #377; a DISTINCT in the database would also remove the first-load cost (needs a migration).
- Cloudflare already caches static files and compresses API answers at its edge.

## Levers that cost nothing
1. Tunnel connector on HTTP/2 with 2 connections (it used up to 124 % of a CPU thread with QUIC): in `docker-compose.micro-app.yml`; apply with `RESTART_TUNNEL=1 infra/oracle/micro-release.sh`.
2. Move the frontend and the tunnel connector to the engine server (idle): each server has its own CPU share, so roughly 50-100 % more headroom. Not done: needs a second SSH tunnel.
3. The free Ampere A1 server: 2 OCPU and 12 GB is the Always Free allowance (Oracle's documentation; not 4 / 24), about 16 times the CPU of one small server. `infra/oracle/vm-retry.sh` keeps asking.
4. Fewer calls per page (the Database pages ask for about nine lists each) and a DISTINCT in the database.

## Re-measuring
`LOAD_EMAIL=... LOAD_PASSWORD=... node scripts/loadtest/session.mjs <cookie-file>` then `node scripts/loadtest/http-load.mjs --cookie-file <cookie-file> --steps 10,25,50 --paths ...`.
Keep each route under the per-user throttle (100/min) or the result is a measurement of the throttle.
