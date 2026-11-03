# eMithran API design guide

How the API is shaped, so that anyone calling it can predict a path without reading code, and so that new routes stay consistent. Each rule says what we do, why, and shows a real route. Rules 2 to 4 are checked by a test (see the end); the others are reviewed.

The public API is under **`/api/v1`**.

## 1. Accept and respond with JSON

Requests and responses are JSON (`Content-Type: application/json`). The exceptions are file uploads (multipart) and file downloads.

Every successful response has the same envelope, so a client reads one shape:

```json
{ "success": true, "data": { "id": "…", "name": "Bracket" }, "metadata": { "timestamp": "…", "requestId": "…" } }
```

Property names are camelCase. Dates are ISO 8601 strings.

## 2. Use nouns, not verbs

The HTTP method is the verb, so the path names a thing.

| Do | Don't |
|---|---|
| `GET /projects` | `GET /getProjects` |
| `POST /projects` | `POST /projects/create` |
| `PUT /projects/:id` | `POST /projects/update` |
| `DELETE /projects/:id` | `POST /projects/:id/delete` |

One exception: a **state change** that is not a plain update is a `POST` to an action on one item: `POST /rfqs/:id/send`, `POST /process-routes/:id/approve`. The allowed actions are `send`, `close`, `approve`, `reject`, `submit`, `activate`, `archive`, `apply`, `discard`, `refresh`, `execute`.

Work that is not a state change is a noun too: a file import creates an *import* (`POST /imports`), an analysis creates an *analysis* (`POST /bom-items/:id/analyses`), not `import-excel` or `analyze-cad`.

## 3. Name collections with plural nouns

`/projects`, `/boms`, `/vendors`, `/raw-materials`, `/machine-rates`, not `/project` or `/mhr`. Spell names out: an abbreviation only the author understands (`mhr`, `lhr`, `rfq`) is not part of a contract. One-per-caller resources have no plural: `/auth`, `/profile`, `/copilot`.

## 4. Nest for hierarchy, but only two levels

Children of one item sit under it:

```
GET  /boms/:bomId/items            the items of a BOM
POST /boms/:bomId/items            add one
GET  /boms/:bomId/items/:itemId
```

After the second level, stop. A deeper child gets its own top-level route and the parent becomes a filter, or the response returns the child's URL:

```
GET /bom-requirements?bomItemId=…        not /boms/:id/items/:itemId/requirements/:reqId
```

Paths do not mirror table names: they describe what a caller sees, not how data is stored.

## 5. Handle errors gracefully and return standard status codes

On `/api/v1` every error is [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) `application/problem+json`:

```json
{ "type": "about:blank", "title": "Bad Request", "status": 400, "detail": "The id is not valid",
  "instance": "/api/v1/projects/x", "code": "BAD_REQUEST", "requestId": "…", "errors": [ … ] }
```

`code` is stable and machine-readable (clients branch on it, not on the text). `errors` lists validation failures. The text never contains a stack trace, a table name, a query string or another customer's data; the detail goes to the log under the `requestId`.

| Status | Meaning here |
|---|---|
| 200 | Read or update succeeded |
| 201 | Created (with a `Location` header) |
| 204 | Deleted, or nothing to return (no body) |
| 400 | The input fails validation |
| 401 | No valid sign-in |
| 403 | Signed in, not allowed (role, or not invited) |
| 404 | No such item, or not yours (the two are not told apart) |
| 409 | Conflict with the current state (duplicate name, item in use) |
| 429 | Rate limit; `Retry-After` says when |
| 500 | Our fault; the body carries only an error id |
| 502 / 503 | An engine or the database is unreachable |

## 6. Allow filtering, sorting and pagination

A list never returns "everything":

```
GET /vendors?processId=…&q=casting&sort=+name,-createdAt&page=2&limit=50
```

- **Filter** with query parameters named after the field, never with path segments.
- **Sort** with `sort=+field,-field` (`+` ascending, `-` descending), only on documented fields.
- **Paginate** with `page` and `limit`; `limit` defaults to 50 and is capped at 200. The response says where it is: `metadata.page = { page, limit, total }`.

## 7. Keep good security practice

- **TLS only.** The edge terminates it; nothing is served over plain HTTP.
- **Default deny.** A route without a declared policy is refused (`@Public`, `@Authenticated`, `@OrgRole('viewer' | 'member' | 'admin')`, `@PlatformAdmin`); `route-policies.spec.ts` lists every route and who may call it.
- **Least privilege.** A viewer reads, a member edits project data, an admin changes organization-wide settings, deletes everything in a table (with `?confirm=delete-all`, audited) or forces a delete.
- **Row-level security** in the database scopes every read and write to the caller's organization, whatever the API code does.
- Limits per caller, tighter on AI, import and upload routes. Destructive and security decisions go to the audit trail.

## 8. Cache data to improve performance

- API responses carry `Cache-Control: private, no-store` unless the route opts in. Data is per organization, so a shared cache (`public`) is never allowed.
- Reference data that changes rarely (rates, lookup tables, materials) opts in with `Cache-Control: private, max-age=300` and a weak `ETag`; a repeat request with `If-None-Match` gets `304`.

## 9. Version the API

The version is the first path segment: `/api/v1/…`. A change that can break a client ships as `/api/v2`. Within `v1` changes only add. The old prefix **`/v1/api/…`** still works and is deprecated: each response carries `Deprecation: true`, `Link: </api/v1/…>; rel="successor-version"` and, once `LEGACY_API_SUNSET` is set, `Sunset`. It is removed after its request log has shown no traffic for 30 days. Health checks stay at `/api/health/*`.

## Renamed paths

A route that was renamed keeps answering on its old path until nobody uses it. The table is `backend/src/common/http/legacy-paths.ts` (old path prefix to new path prefix, on whole segments): a request to the old path is routed to the new one and answered with `Deprecation: true` and `Link: </api/v1/new-path>; rel="successor-version"`. The controllers carry only the new name, so the route inventory lists each route once. A rule is removed once the deprecated-path log shows no traffic for 30 days.

| Old | New |
|---|---|
| `/mhr`, `/mhr/…` | `/machine-rates`, `/machine-rates/…` |
| `/mhr/import-excel` | `/machine-rates/imports` |
| `/lhr`, `/lhr/…` | `/labour-rates`, `/labour-rates/…` |
| `/lhr/import-excel` | `/labour-rates/imports` |
| `/lhr/bulk` | `/labour-rates/batches` |
| `/rfq`, `/rfq/…` | `/rfqs`, `/rfqs/…` |
| `/rfq/tracking`, `/rfq/tracking/…` | `/rfq-trackings`, `/rfq-trackings/…` |
| `/fx/exchange-rates`, `/fx/exchange-rates/:currency` | `/exchange-rates`, `/exchange-rates/:currency` |
| `/fx/rate` | `/exchange-rates/effective` |
| `/fx/refresh` | `/exchange-rates/refresh` |
| `/fx/currencies`, `/fx/factories` | `/currencies`, `/factories` |
| `/fx/factory-currency` | `/factory-currencies` |

## How the rules are enforced

- `backend/src/test/common/api-design.spec.ts` reads the route inventory and fails on a new route that has a verb in its path (rule 2), a singular collection (rule 3) or more than two levels of nesting (rule 4).
- Routes that existed before the rules are listed in `api-design-violations.json`. The list can only shrink: renaming or flattening a route makes its entry stale and the test asks for its removal.
- After changing routes: `UPDATE_API_DESIGN_VIOLATIONS=1 npx jest src/test/common/api-design.spec.ts`, and `npx jest route-policies -u` for the inventory.

## Where the API stands

| Rule | State |
|---|---|
| 1 JSON | Done |
| 2 Nouns | 50 existing routes break it (`analyze-*`, `bulk-total`, `init`, `batch`, `calculate`, `PATCH rfqs/:id/send` and `close` (actions are POST), …) |
| 3 Plural | 102 routes under 6 singular, abbreviated or area names (`vave`, `production-planning`, `quality-control`, `process-planning`, …). Done: `machine-rates`, `labour-rates`, `rfqs`, `rfq-trackings`, `exchange-rates` |
| 4 Nesting | 26 routes have five or more segments |
| 5 Errors | Problem details on `/api/v1`; deletes still answer 200 with a body in about 40 places; no `Location` on create |
| 6 Filter, sort, paginate | About 20 lists page; no shared helper or cap; sorting is uneven |
| 7 Security | Done, two open items: a `reference-data:write` permission, and the approver not being the submitter |
| 8 Caching | Not started |
| 9 Versioning | `/api/v1` live and `/v1/api` deprecated; the web app still calls the old prefix (a config change, `API_URL` and `NEXT_PUBLIC_API_URL`) |

Not built: cursor pagination, `Idempotency-Key` on creates, `ETag`/`If-Match` on writes, a shared `/jobs` resource for long work.
