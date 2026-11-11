# Running production on two small Always Free servers

Two `VM.Standard.E2.1.Micro` servers (1 GB RAM, 1/8 core with bursts, 50 GB disk each; free forever, two per tenancy). Used while the 4-core ARM server
(`vm.sh`) has no capacity; when it appears, move there (same compose files, same scripts).

| Server | Runs | Memory ceilings |
|---|---|---|
| app (micro-1) | Postgres, PostgREST, backend, frontend, cloudflared | 300 + 96 + 420 + 200 + 64 MB, plus 4 GB swap |
| engines (micro-2) | CAD engine, electronics engine, two loopback forwarders | 700 + 200 + 2 x 16 MB |

The engines stay on the private `internal` network (no route out, none in). A forwarder container on `internal` + `edge` publishes each engine on the
engine server's **loopback only**; an SSH tunnel from the app server (a key that may forward exactly two loopback ports, nothing else) carries it. No
new port is open on either server or in the cloud firewall (SSH only). Oracle's Ubuntu image rejects every host-bound connection but SSH; the one
rule `micro-deploy.sh` adds lets only Docker's private networks (172.16.0.0/12) reach the two tunnel ports.

## Build, ship, start (nothing public changes)
```
DOCKER_DEFAULT_PLATFORM=linux/amd64 docker compose -p emithran-amd64 -f docker-compose.prod.yml -f docker-compose.data.yml --env-file <env> build backend frontend ecad-engine cad-engine
export APP_HOST=<ip> ENGINE_HOST=<ip> ENGINE_PRIVATE_IP=<10.x>
infra/oracle/micro-deploy.sh engines      # engine server
infra/oracle/micro-deploy.sh app          # app server: Postgres, tunnel to the engines, images
infra/oracle/micro-db.sh                  # rehearsal copy of the database + row-count proof; starts PostgREST
ssh ubuntu@$APP_HOST 'cd /opt/emithran && docker compose -p emithran-prd -f docker-compose.prod.yml -f docker-compose.data.yml -f docker-compose.micro-app.yml --env-file env/prd.env up -d --no-build backend frontend'
infra/oracle/micro-deploy.sh status
```
Check: `GET /api/health/ready` inside the backend container answers 200 with database, cadEngine and ecadEngine "up".

## Cutover (about 5 minutes of downtime; do it at a quiet hour)
The public site is served by whichever machine runs the tunnel connector (`cloudflared`, same tunnel token on both). Two connectors at once would split
traffic between an old and a new copy of the data, so the order matters.
1. Old host: `docker stop <project>-cloudflared-1` (site down), then stop its backend and frontend (no more writes).
2. `RESET=1 infra/oracle/micro-db.sh` (final copy; it empties only the app server's copy and proves every table's row count).
3. App server: `docker compose ... up -d --no-build backend frontend cloudflared`.
4. Verify the public URL (login redirect, `/api/health`, one project opens). 

## Rollback (seconds)
App server: `docker stop emithran-prd-cloudflared-1`. Old host: `docker start` its backend, frontend, cloudflared. Anything written on the new
server after step 3 is not on the old host: copy it back first if the window was long.
