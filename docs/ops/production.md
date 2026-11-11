# Production runbook (Emithran)

Written 2026-11-12 from what is running. It holds no secrets, only where each one lives. Companion documents: `infra/oracle/MICRO.md` (the two servers),
`docs/ops/capacity.md` (measured limits), `docs/ops/incident-response.md`, `docs/BRANCHING.md`.

## What runs where
| Piece | Where | Cost |
|---|---|---|
| Web tier: Postgres, PostgREST, backend, frontend, tunnel connector | Oracle `emithran-micro-1` (Always Free x86, 1 GB, 1/8 core), 129.154.34.103 | $0 |
| CAD + electronics engines (private network, no route out) | Oracle `emithran-micro-2`, 129.225.127.106 | $0 |
| Public address `app.emithran.com` | Cloudflare tunnel `emithran-prod` (connector on micro-1); TLS, caching, rate limits at Cloudflare | $0 |
| Sign-in | Auth0 tenant `dev-ahu0oilgxwkz8hhf` (custom domain `auth.emithran.com`), app "EMITHRAN Cloud"; sign-ups OFF; email+password only | $0 |
| Files (CAD uploads) | Cloudflare R2 bucket `emithran-prod` (private) | $0 under 10 GB |
| Staging `stage.emithran.com` | Docker on the developer Mac (project `emithran-stage`); not always on | $0 |
| Domain | `emithran.com` | about $10-15 a year |

A request: browser -> Cloudflare -> tunnel -> frontend (`/api/v1/*` is proxied with the session's token) -> backend (verifies the Auth0 token, checks the
invite list and the organization) -> PostgREST with a signed token -> Postgres (row-level security decides what each customer sees). The backend calls the
engines through an SSH tunnel (key restricted to two loopback ports). Nothing but SSH is open on either server.

## Where the secrets are (never commit, never paste)
- App server `/opt/emithran/env/prd.env` (mode 600): database, data-API, Auth0 app secret, session secret, R2 key, tunnel token, engine keys.
- Engine server `/opt/emithran/env/engines.env`: the same file with every secret that is not the engines' own replaced by `unused`.
- Developer Mac: `~/emithran-prod-run/env/prd.env` (the source the release builds from), `~/.ssh/emithran_prod_ed25519` (SSH to both servers),
  `~/emithran-backup-age.key` (opens backups), `~/.oci/emithran-vm-launcher.pem` (the Oracle retry's key).
- Rotating anything is a new value in the env file(s), then a release (`RESTART_TUNNEL=1` for the tunnel token).

## Release (about 5-15 minutes; the site is interrupted for seconds)
```
cd ~/Developer/emithran && git switch develop && git pull
DRY_RUN=1 infra/oracle/micro-release.sh origin/develop      # the plan, after read-only checks
infra/oracle/micro-release.sh origin/develop                # RESTART_TUNNEL=1 only to apply a changed tunnel setting
```
It builds amd64 images from the commit, runs its migrations FIRST (through an encrypted SSH forward, `--confirm`), ships only images whose layers changed,
updates the engines then the web tier with health waits, checks the public site, and restores the previous images by itself on any failure. Check the
step line before it ships anything (`== 3/6 migrations` then `== 4/6 ship what changed`), and always `git pull` first: a release is of the commit you name.

## Rollback
- A failed release rolls itself back. A bad release that passed its checks: `docker tag emithran-prd-<service>:good-<old sha> emithran-prd-<service>:latest`
  on the server, then `docker compose ... up -d --no-build --force-recreate <service>` (the previous images are kept as `good-<sha>`).
- Migrations are never rolled back: fix forward with a new migration (applied ones are immutable; CI enforces it). Old code keeps working with additive ones.
- Back to the Mac (emergency only): stop the servers' tunnel connector (`docker stop emithran-prd-cloudflared-1`), delete `~/emithran-prod-run/MOVED_TO_ORACLE`,
  `docker start` the Mac's postgres, backend, frontend, cloudflared. The Mac's data is frozen at the cutover (2026-11-11 20:12 IST).

## Everyday operations
- Status: `APP_HOST=... ENGINE_HOST=... ENGINE_PRIVATE_IP=... infra/oracle/micro-deploy.sh status` (`~/.emithran/micro.env` holds the three values).
- Logs: `ssh ubuntu@<app> 'docker logs --since 30m emithran-prd-backend-1'`. Logs rotate (10 MB x 3 per container).
- Invite a customer: copy `infra/oracle/authorize-user.sh` to the app server and run it there with `PG_CONTAINER=emithran-prd-postgres-1` and the emails; then create their
  email+password login in Auth0 (sign-ups are off, so only accounts you create can sign in; passwords need 15+ characters). They create their own organization on first login.
- Two sign-ins, two lists: the Auth0 account (who can authenticate) and `public.authorized_users` (who the app admits). Both must contain the person.

## Data safety
- Backups are OFF (test data only, by decision 2026-11-11). Before real customer data: schedule `infra/oracle/backup.sh` (age-encrypted dump -> R2 `backups/`, 30-day lifecycle)
  on the app server (cron or a systemd timer) and run a restore drill; the private key is on the developer Mac only.
- A database copy for a migration or rehearsal: `infra/oracle/micro-db.sh` (proves every table's row count against the source).

## Watching it
- Cloudflare emails `contact@emithran.com` if the production tunnel drops; Oracle emails at $1 of spend (budget `emithran-zero-spend`); Cloudflare has a billing-budget alert.
- NOT yet: an outside uptime check (UptimeRobot free on `https://app.emithran.com/api/health`). `monitor.emithran.com` has no DNS record and Grafana is not on the servers
  (it needs 500+ MB; each server has 1 GB). The Mac's Grafana watches staging only.

## Oracle ARM server (the real upgrade)
Free allowance: 2 OCPU + 12 GB (Oracle's documentation), 200 GB block storage in total (the two small servers use 100 GB). `~/.emithran/oracle-retry/retry.log` shows
one attempt every 10 minutes (launchd agent `com.emithran.oracle-retry`, key-based, runs from `~/.emithran/oracle/`). When it succeeds a notification appears and
`RESULT` holds the address; then run the same compose files and scripts there (`infra/oracle/deploy.sh`, `bootstrap-host.sh`).
Stop the retry: `launchctl bootout gui/$(id -u)/com.emithran.oracle-retry`.

## Known risks and open items
1. Capacity: a pilot of 3-5 comfortable, about 10 slow users, one CAD job at a time (`capacity.md`).
2. Backups off; no outside uptime check; no Grafana for production.
3. Dangling DNS: `backend.emithran.com` and `cad.emithran.com` still point at deleted Railway services (a takeover risk): delete them in Cloudflare DNS, with the `_railway-verify.*` TXT records.
4. Single points of failure: one app server, one database, no replica. The Mac is the only other copy of the code's build tooling.
5. Staging is on the developer Mac.
