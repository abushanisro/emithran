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
`APP_HOST=<ip> infra/oracle/micro-cutover.sh` (run on the old host; `DRY_RUN=1` first prints every step). It stops the old connector FIRST, then the
old backend and frontend, copies the database one last time (`RESET=1 micro-db.sh`, proven table by table), starts the new backend, frontend and
connector, and checks the public URL. If any step or the public checks fail it rolls back by itself.

Why the order: the tunnel connector (`cloudflared`, same token on both hosts) decides which copy of the data the public sees. Two at once would split
traffic between an old and a new copy.

## Rollback (seconds)
The old host's containers are stopped, never removed. On the app server `docker stop emithran-prd-cloudflared-1`, then on the old host `docker start`
its postgres, backend, frontend and cloudflared. Anything written on the new server after the cutover is not on the old host: copy it back first if
the window was long.
