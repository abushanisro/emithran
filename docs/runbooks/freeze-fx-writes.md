# Freeze FX writes

Use when exchange rates are being changed wrongly or maliciously (an organization's budget rates, or the global rate cache) and the
change must stop before the cause is understood. Reads keep working: costing goes on with the rates as they are.

FX is written in three places:

| What | Written by | Path |
|---|---|---|
| an organization's budget rates (`organization_exchange_rates`, migration 940) | members, through `set_organization_exchange_rate()` as the signed-in user | `PUT /api/v1/exchange-rates/:currency` |
| the global market-rate cache (`fx_rate_snapshots`) | the backend's service connection | `POST /api/v1/exchange-rates/refresh` and the scheduled refresh |
| the global default rates (`exchange_rates`) | migrations and operators only | none |

## 1. Stop it at the edge (seconds)

Cloudflare → the zone → Security → WAF → Custom rules → create a rule, action **Block**:

```
(http.request.uri.path wildcard "/api/v1/exchange-rates/*" and http.request.method eq "PUT")
or (http.request.uri.path eq "/api/v1/exchange-rates/refresh" and http.request.method eq "POST")
```

## 2. Stop it in the database (holds whatever the path)

Connect as the database owner (`MIGRATE_DATABASE_URL`). First save the current grants, so the unfreeze restores exactly them:

```sql
SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name IN ('organization_exchange_rates', 'fx_rate_snapshots', 'exchange_rates')
 ORDER BY 2, 1, 3;
SELECT grantee, column_name, privilege_type FROM information_schema.column_privileges
 WHERE table_schema = 'public' AND table_name = 'organization_exchange_rates' AND privilege_type = 'UPDATE';
```

Then freeze, in one transaction:

```sql
BEGIN;
REVOKE EXECUTE ON FUNCTION public.set_organization_exchange_rate(uuid, text, numeric, text) FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.organization_exchange_rates FROM authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON public.fx_rate_snapshots, public.exchange_rates FROM authenticated, service_role;
COMMIT;
```

Writes now fail with "permission denied" (the API answers an error; nothing is half-written). Check: a rate edit in the app fails,
`SELECT max(created_at) FROM public.fx_rate_snapshots` stops moving, and the costing pages still load.

## 3. Find what changed

`organization_exchange_rates` keeps replaced rates as inactive rows with `set_by`, `reason` and timestamps; compare with
`fx_rate_snapshots` history. Correct bad rows as the owner while frozen.

## Unfreeze

Re-grant what the saved output listed. For a database at migration 940 that is:

```sql
BEGIN;
GRANT EXECUTE ON FUNCTION public.set_organization_exchange_rate(uuid, text, numeric, text) TO authenticated;
GRANT INSERT ON public.organization_exchange_rates TO authenticated;
GRANT UPDATE (is_active, updated_at) ON public.organization_exchange_rates TO authenticated;
GRANT ALL ON public.organization_exchange_rates TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.fx_rate_snapshots, public.exchange_rates TO service_role;  -- only those the saved output had
COMMIT;
```

then delete the Cloudflare rule. The nightly schema-drift job ([schema-drift.md](schema-drift.md)) does not compare grants, so
check the saved output against `information_schema.role_table_grants` by hand.
