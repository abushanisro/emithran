# Deployment and security

How eMithran runs in **stage** (the team's QA and testing environment) and **production**, and why each choice was made.
Everything that can be enforced in code is enforced by a test or a CI job; this page covers the rest (dashboard settings and
procedures). Standards used: OWASP ASVS and Top 10, CIS Docker Benchmark, OpenSSF Scorecard, SLSA. All tooling is open source.

## Shape

```
visitor ──► Cloudflare ──► cloudflared (outbound tunnel) ──► frontend  ─┐   network "edge"    (can reach the internet:
            WAF, rate limits,                              └► backend  ─┤                     Supabase, Cloudflare)
            Access (stage only)                                          │
                                                                         ▼   network "internal" (no internet, no host port)
                                                            cad-engine, ecad-engine   ◄── parse untrusted uploaded files
backend / frontend ──► Supabase project for this environment (stage and prd are separate projects)
```

- **The host publishes no ports.** `cloudflared` dials out to Cloudflare, so there is nothing to scan or attack on the host.
- **Engines are private.** They parse untrusted CAD and board files, so they get no internet and cannot be reached from outside.
- **One image set per environment.** `NEXT_PUBLIC_*` values are compiled into the browser bundle, so stage and prd build their own
  frontend from their own env file.
- **Same-origin API.** The browser calls `https://<app host>/v1/api/...`; Cloudflare routes `/v1/*` to the backend and everything
  else to the frontend. No CORS, and one Cloudflare Access login covers both.

## Environments and promotion

| | local | stage | prd |
|---|---|---|---|
| Purpose | development | the team's QA and testing | customers |
| Supabase project | stage (shared) | `mhhyilxeoxzlbiytwdcm` | `udvcydhvlgjfsohueryv` |
| `APP_ENV` | `local` | `stage` | `prd` |
| Reached by | localhost | Cloudflare Access (team only) | public |
| e2e suites may run | yes | yes | **no** (the suites refuse) |

Flow: pull request → CI (`ci.yml`, `security.yml`) → merge to `main` → deploy to **stage** → team QA sign-off → deploy to **prd**.

```bash
# on the host, per environment (env/<name>.env holds that environment's secrets; see env/README.md)
docker compose -p emithran-stage -f docker-compose.prod.yml --env-file env/stage.env up -d --build
npm run db:migrate -- --env stage --dry-run     # then without --dry-run
npm run db:migrate -- --env prd --confirm       # production needs the flag
```

Rollback: redeploy the previous commit with the same command (images are rebuilt from the repo); migrations are forward-only, so a
bad migration is fixed by a new migration.

## What is enforced where

| Control | Where | Standard |
|---|---|---|
| Containers read-only, no capabilities, no privilege escalation, memory/CPU/process limits, no published ports | `docker-compose.prod.yml`, checked by `test/deploy/compose-hardening.test.ts` | CIS Docker 5.x |
| Non-root users; pinned base images (digest); supported Node (24); no compilers or package manager at runtime | Dockerfiles, same test | CIS Docker 4.x, SLSA |
| No env file or log ever enters an image | `.dockerignore` files, same test | ASVS V14 |
| Engines isolated on a network with no internet | compose `internal` network, same test | defence in depth |
| A secret key can never reach the browser | `lib/supabase/env.ts` stops the app if `sb_secret_` or a service-role JWT is in a `NEXT_PUBLIC_` variable | ASVS V14.3 |
| Production refuses to boot without `APP_ENV` and with the dev auth bypass | `backend/src/config/env.validation.ts` | ASVS V14.1 |
| Data-creating tests refuse to run against production | `backend/src/common/environment-guard.ts`, `playwright.config.ts` | change control |
| Real client IP behind the tunnel for rate limiting | `backend/src/common/client-ip.ts` (`TRUST_CLOUDFLARE_HEADERS`) | ASVS V13 |
| Row-level security and no stray service-role use | `npm run check:rls`, `backend/docs/rls-bypass-inventory.md` | ASVS V4 |
| Upload content checks, zip limits, no path traversal | `cad-uploads/check-upload.ts`, `common/archive/expand-archive.ts` | ASVS V12 |
| Secrets in history, vulnerable dependencies, container and config scans, SAST | `.github/workflows/security.yml` | OWASP A06, OpenSSF |
| Actions pinned by commit SHA, read-only token, bumps proposed weekly | `ci.yml`, `security.yml`, `.github/dependabot.yml` | OpenSSF Scorecard |
| Migrations tracked, immutable once applied, aimed at the right environment | `backend/scripts/migrate.ts` | change control |

## Cloudflare setup (dashboard; once per environment)

Zero Trust → Networks → Tunnels → create a tunnel per environment (`emithran-stage`, `emithran-prd`) and put its token in
`TUNNEL_TOKEN` in that environment's env file. Then:

1. **Public hostnames** for the tunnel, in this order (the more specific path first):
   `app.<domain>` + path `/v1/*` → `http://backend:4000`; then `app.<domain>` (no path) → `http://frontend:3000`.
   Set `NEXT_PUBLIC_API_GATEWAY_URL` and `CORS_ORIGIN` to `https://app.<domain>`.
2. **Access (stage only):** an Access application on the stage hostname, policy *Allow* the team (email domain or your SSO group),
   session 24 h. Add a service token for CI smoke tests. Production has no Access application.
3. **WAF:** enable the Cloudflare Managed Ruleset and the OWASP Core Ruleset. Add rate-limiting rules: `POST /v1/api/cad-uploads`
   (about 10 per minute per IP), and a general `/v1/*` limit.
4. **TLS:** minimum TLS 1.2, Always Use HTTPS, HSTS. **Cache:** bypass `/v1/*` and `/api/*`.
5. **Host firewall:** allow outbound only. `cloudflared` needs outbound TCP/UDP 7844 (and 443). No inbound rules at all.

> **Upload size.** One value, `MAX_UPLOAD_MB` in the env file, feeds the backend, the engine and the upload card (default 50, which is the
> Supabase free tier's cap on one stored object). Cloudflare's proxy accepts bodies up to 100 MB on Free and Pro, so the default fits with room
> for multipart overhead. After moving to a paid Supabase plan, raising it to 100 is the most that Cloudflare Free/Pro will carry.

## Supabase settings (dashboard; once per project)

- **API keys:** the publishable key goes to the frontend; the secret key goes only in the server env file. Never paste either into
  chat, a ticket or a commit.
- **Auth:** Site URL and an exact redirect-URL allowlist for this environment (`/auth/callback`); disable providers you do not use;
  minimum password length 12 and leaked-password protection on; email confirmation on; Google provider with this project's callback
  `https://<ref>.supabase.co/auth/v1/callback` registered in Google's console; JWT expiry 1 h.
- **Organization:** MFA required for everyone with dashboard access; least-privilege roles.
- **Database:** SSL enforcement on; network restrictions limited to the host's egress IP (and the migration runner's); backups on
  (PITR for prd); RLS on for every table (`npm run check:rls`).
- **Storage:** every bucket private (`bom-files`, `electronics-uploads`, `avatars`, `delivery-attachments`); policies come with the
  baseline.
- **Connection strings:** the app holds none (the job queue and the event bus need no database connection). Only
  `MIGRATE_DATABASE_URL` (migration runner, nightly backup) is one: the session-mode pooler (port 5432), not the transaction
  pooler (6543) and not the IPv6-only direct host.

## Free-tier budget and how the app stays inside it

| Limit | Budget | What keeps it there |
|---|---|---|
| Database 0.5 GB | reference data <= 250 MB, app data <= 150 MB, audit <= 50 MB, headroom 50 MB | `backend/scripts/db-size.sql` measures it; migration 918 prunes `api_request_logs` (14 d), `fx_rate_snapshots` (90 d), `cad_analysis_history` (last 3 per item), failed uploads (30 d) every night with `pg_cron` |
| Storage 1 GB, 50 MB per object | parts <= 700 MB, electronics <= 200 MB, headroom 100 MB | the original zip is deleted once processed (failed ones after 7 days); a part used by many nodes is stored once; a repeat upload stores nothing; files are only deleted when `file_paths_in_use()` says nothing references them |
| Egress 5 GB / month | alert at 70% | the upload runner wakes when a job is queued and polls only every 30 s as a fallback; signed URLs are cached |
| No backups, pause after a week idle | nightly encrypted dump, keep-alive, usage guard | `.github/workflows/ops.yml` (see Operations below) |

Every limit is an env value, so moving to Supabase Pro is a configuration change (raise `MAX_UPLOAD_MB`, enable backups), not a code change.
Migrations are tested on a throwaway Postgres: `npm run test:sql` (also a CI job).

## Operations (free tier)

`.github/workflows/ops.yml` runs every night for **stage first, then production** (production only runs if stage passed):

1. **Keep-alive:** one request to the project's auth health endpoint, so a quiet project never reaches the one-week pause.
2. **Usage guard:** database and storage size against 0.5 GB and 1 GB; a warning at 70%, a failed run at 85%.
3. **Backup:** `pg_dump` of the `public` schema plus exact row counts, encrypted with `age` to the public key in `BACKUP_AGE_RECIPIENT`,
   kept as a workflow artifact for 7 days (Sundays: 28). **Not in the backup:** auth users and stored files (the free tier has no
   automated backups for them; export users from the dashboard before risky changes).

One-time setup, per GitHub Environment (`stage`, `production`): secrets `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`MIGRATE_DATABASE_URL` (session pooler, port 5432), `BACKUP_AGE_RECIPIENT`. Make the key pair once on a trusted machine
(`age-keygen -o backup-age.key`), put only the `age1...` public line in the secret, and keep the private file offline. Run the
workflow once by hand (Actions -> Operations -> Run workflow) and confirm the artifact appears.

**Prove a backup restores** (monthly, and after any schema change): download the artifact, then
`AGE_IDENTITY=backup-age.key backend/scripts/restore-check.sh backup-stage.tar.age`. It restores into a throwaway Postgres container
and compares every table's row count with the count taken at dump time; it exits non-zero on any difference.

## Secrets

- Env files live only on the host (`env/<name>.env`, mode `600`, owned by the deploy user) and in GitHub Environments for CI.
  Images contain no secrets (a scan of the built images found none).
- **Rotate on any suspicion**, and always after a move like this one. Rotation, not history rewriting, is the real fix.
- **Known history:** git history contains 39 committed credentials (older `.env.development`/`.env.production`, example files and
  docs: JWTs, an Anthropic key, a Google API key, generic API keys). They are listed, redacted, in `.github/gitleaks-baseline.json`
  so CI fails only on **new** leaks. **Rotate all of them** (Anthropic, Google, the old Supabase project's keys, the engine API
  keys) and then regenerate the baseline.

## GitHub settings (cannot be set from the repo)

Branch protection on `main` (required reviews and the `ci.yml` and `security.yml` checks, no force pushes); GitHub Environments
`stage` and `production` (production with required reviewers); secret scanning with push protection; Dependabot alerts; two-factor
authentication for all members.

## Open items

- **zod** `^3.25.76` has an advisory (GHSA-mrhx-c7xc-m3w5, memory exhaustion on very large validated collections) fixed only in zod 4.
  It is used in 6 files (forms and catalog parsing); migrate when convenient.
- **cloudflared** carries one HIGH CVE in its bundled go-jose with no upstream fix yet; `.trivyignore.yaml` records the exception and
  it expires on 2026-12-15 so it is re-checked.
- The cad-engine image is `linux/amd64` only (`pythonocc-core` 7.7.2 is not published for aarch64).
- The browser-side helper `lib/api/cad-engine.ts` still has two direct engine calls (`/convert/step-to-stl`, `/health`) that cannot
  work against a key-protected, private engine. The working path is the `/api/cad` proxy.
