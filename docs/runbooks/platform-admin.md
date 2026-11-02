# Grant or revoke platform admin

Platform admins may perform the few global actions (decision D2): everything else is organization-scoped and governed by
`organization_members.role`. There is deliberately no API or UI to grant the role: it is a row in `public.platform_admins`, inserted
by an operator with the database owner connection, and every change is audited.

**`platform_admins` is created by the authorization workstream's migration, not by the change that added this runbook.** Before using
the SQL below, read the table as deployed (`\d public.platform_admins`) and adapt the column names if they differ; the shape assumed
here is `user_id uuid` (references `auth.users`), `granted_by`, `reason`, `created_at`.

Connect as the database owner (`MIGRATE_DATABASE_URL` of the environment), stage first when practical.

## Grant

```sql
BEGIN;
-- the person, by the verified email they sign in with
SELECT id, email FROM auth.users WHERE lower(email) = lower('person@example.com');
INSERT INTO public.platform_admins (user_id, granted_by, reason)
VALUES ('<user id from above>', '<your user id>', '<ticket or reason>')
ON CONFLICT (user_id) DO NOTHING;
COMMIT;
```

## Revoke

```sql
BEGIN;
DELETE FROM public.platform_admins WHERE user_id = '<user id>' RETURNING user_id;
COMMIT;
```

The change takes effect on the person's next request (the guard reads the table per request; if the deployed guard caches the
decision, the cache time is in its code: wait it out or restart the backend for an urgent revoke).

## Check

```sql
SELECT p.user_id, u.email, p.granted_by, p.reason, p.created_at
  FROM public.platform_admins p JOIN auth.users u ON u.id = p.user_id ORDER BY p.created_at;
```

Review this list monthly and on every departure. Every grant and revoke must appear in `audit_events` (the table's trigger, from the
same migration); if it does not, stop and treat it as an incident. Any platform-admin write is meant to alert (design section 11).
