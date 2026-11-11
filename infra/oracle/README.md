# Production on Oracle Cloud (Always Free)

Production runs the repo's own compose files (`docker-compose.prod.yml` + `docker-compose.data.yml`, project `emithran-prd`) on one Always Free
Ampere VM (4 OCPU, 24 GB, Ubuntu 24.04 arm64), behind the Cloudflare tunnel `emithran-prod` at `app.emithran.com`. Two other hostnames are different live sites and must not be pointed here: `platform.emithran.com` (the Manufacturing Data Spider, Vercel) and `cloud.emithran.com` (the existing Vercel frontend); files go to the R2
bucket `emithran-prod`. Nothing here costs money: a $1 budget alerts on the first cent of spend, and the shape is inside the free allowance.

| Script | Where it runs | What it does |
|---|---|---|
| `network.sh` | your Mac (OCI CLI, session login) | VCN, internet gateway, public subnet; SSH is the only inbound port |
| `vm.sh` | your Mac | the VM; tries 4 OCPU / 24 GB, then smaller, and retries when Oracle has no free capacity |
| `launcher-setup.sh` | your Mac, once | a least-privilege IAM user with an API key (no expiring browser login) + a launchd agent that runs `vm-retry.sh` every 10 minutes |
| `vm-retry.sh` | launchd | ONE attempt; on success it records `~/.emithran/oracle-retry/RESULT`, notifies you and unschedules itself; it notifies (at most every 6 h) when the key is rejected |
| `bootstrap-host.sh` | the VM, as root | key-only SSH, fail2ban, automatic security updates, Docker with log rotation, swap, keep-alive timer |
| `production-db.sh` | the VM | loads the baseline, removes the QA fixtures, sets the data API password |
| `backup.sh` | the VM, nightly | `pg_dump` to the R2 bucket under `backups/` |
| `deploy.sh` | your Mac | ships a git ref + `env/prd.env` + the baseline, then runs the steps above |

```
oci session authenticate --region ap-hyderabad-1 --profile-name emithran     # temporary login, about 1 hour
infra/oracle/network.sh ; infra/oracle/vm.sh                                   # once (see the variables at the top of each script)
infra/oracle/deploy.sh <vm-public-ip> <release-tag>                            # every release
```

## The database
The baseline (`~/emithran-baseline`, the database at migration 917 with the reference catalog) plus `npm run db:migrate` is the repo's
install path. Verified on a throwaway Postgres built from the same compose files: all 58 reference and shared tables match stage row for row
(66,773 rows), 0 organizations, 0 projects. Two traps found by that test, both handled in `production-db.sh`:
- the baseline needs `DROP_DANGLING=1` (the old database did not enforce its foreign keys; the rows set aside belong to the delivery-module
  tables that migration 934 drops);
- the baseline carries a placeholder user that owns reference rows: deleting the user directory entries cascades to calculators and their fields.
  Only the QA organizations, their members and authorized users are removed.

## Free-tier habits
- Oracle reclaims an Always Free VM that stays under 20% CPU/network/memory for 7 days: `bootstrap-host.sh` installs a low-priority hourly burst.
- Free ARM capacity is often exhausted; `vm.sh` retries. A smaller VM resizes up in place later at no cost.
- Do not click Upgrade. Keep total A1 use at or under 4 OCPU / 24 GB and block storage at or under 200 GB.

## Watching production
- **Inside the VM:** `docker-compose.monitoring.yml` (Prometheus, Grafana, blackbox probes, host metrics; 16 alert rules; docs/ops/monitoring.md). Grafana is
  `https://monitor.emithran.com` behind Cloudflare Access (owners only), never public. Memory limits of the whole stack add up to 10.5 GB: it fits the
  24 GB VM and the 12 GB fallback.
- **From outside:** a free external uptime monitor on `https://app.emithran.com/api/health/live` (UptimeRobot: 5-minute checks, email). The monitor inside
  the VM cannot report that the VM itself is down.
- **Notifications:** Prometheus alerts fire but nothing is sent until a Grafana contact point is configured (email through your Resend account).
- Also free and already there: Cloudflare Analytics and the WAF event log, the Auth0 tenant logs, and `journalctl -u emithran-backup`.
