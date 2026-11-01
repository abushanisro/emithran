# Incident response and disaster recovery

What to do when production is down, data is lost, or a secret or vulnerability is exposed. Keep it short while it is happening:
contain first, then restore, then write it up.

## Severity

| Level | Meaning | Examples | Respond |
|---|---|---|---|
| **SEV1** | Customers cannot work, or data is exposed or lost | site returns 500; credential leaked; tenant data visible to another tenant | at once |
| **SEV2** | A feature is broken or degraded, with a workaround | costing for one process family wrong; uploads slow | same working day |
| **SEV3** | Minor, no customer impact | a failing scheduled job; a low-severity advisory | next planned work |

## For every incident

1. **Own it.** One person leads (today the maintainer). Note the start time and keep a timeline: what was seen, what was done, when.
2. **Contain** before fixing: roll back, revoke, or take the affected part offline. Do not debug on production.
3. **Restore** service using the runbooks below.
4. **Tell** affected customers for SEV1, once the facts are known: what happened, what data is affected, what they should do.
5. **Write the review** within five working days (template at the end), and turn each lesson into a test, check or setting.

## Runbooks

### Site down after a release (frontend)

Production does not follow `main`; it is whatever deployment was last promoted. Put the last good one back:

```bash
npx vercel@latest ls mithran-so59 --environment production    # find the last good deployment URL
npx vercel@latest promote <last-good-deployment-url>           # or: redeploy <url> --environment production
curl -s -o /dev/null -w '%{http_code}\n' https://cloud.emithran.com/
```

Then find the cause on a preview deployment, never on production. (On 2026-10-31 a merge deployed code needing settings production
did not have; `vercel.json` now stops `main` deploying to production on its own.)

### Backend, engines or database down

Check the host and stage first ([monitoring.md](monitoring.md) dashboards and alerts). To roll back a service, deploy the previous
image or commit with the same compose command used to release it ([DEPLOYMENT_SECURITY.md](../DEPLOYMENT_SECURITY.md)). Migrations
are immutable once applied: undo a bad one with a new forward migration, tested on stage.

### Leaked secret

1. **Revoke and replace** the credential at its provider first. Rotation is the fix; deleting it from git is not (copies remain).
2. Update it everywhere it is used (host env files, GitHub Environments, Vercel), then confirm the old value is refused.
3. Check the provider's logs for use between the leak and the revocation; if it was used, treat it as a data incident.
4. If it was committed, stop it recurring: GitHub push protection is on; gitleaks fails CI on new findings.

### Data loss or corruption

Two copies exist: the managed Postgres's own point-in-time backups (use these first), and the nightly `ops.yml` run's encrypted
`pg_dump` of the `public` and `auth` schemas per environment (7 days; Sunday runs 28 days). With the nightly copy alone up to one day
of data can be lost (recovery point objective: 24 hours). Stored files live in the bucket and are in neither.

1. Stop writes to the affected data if the damage is still happening.
2. Restore to a point in time before the damage from the managed Postgres. If that is not available, download the nightly artifact
   `backup-<env>-<run id>` from before the damage (Actions → Operations → the run → artifacts).
3. Prove it first: `AGE_IDENTITY=backup-age.key backend/scripts/restore-check.sh backup-<env>.tar.age` (restores into a throwaway
   container and compares row counts).
4. Restore into the environment, stage first if time allows, and check the affected tenants' data with them.

Time each restore drill; the measured time becomes the recovery time objective.

### Vulnerability reported or found

Reports arrive through GitHub private vulnerability reporting ([SECURITY.md](../SECURITY.md)). Acknowledge within two working days,
reproduce, fix on a private fork or branch for anything exploitable, release, then credit the reporter if they wish. Alerts from
Dependabot and CodeQL are triaged the same way: fix, or dismiss with a written reason.

## Review template

```markdown
# <date> <one-line summary> (SEV<n>)
- Impact: who was affected, for how long, what data
- Timeline: detection, containment, recovery (with times)
- Cause: the technical cause, and why checks did not catch it
- What went well / what did not
- Actions: each with an owner and a pull request or setting that prevents a repeat
```
