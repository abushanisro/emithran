# API conventions and rollout

The route-by-route redesign plan (target conventions, route map, migration plan) is the reference; this file records what is built.

## Prefix
- **Public prefix: `/api/v1/...`.** It is an alias for the existing controllers (`backend/src/common/http/api-v1.ts`), so every route is
  reachable under it today.
- **`/v1/api/...` still works** and is **deprecated**: each response carries `Deprecation: true` and
  `Link: </api/v1/...>; rel="successor-version"`, and `Sunset: <date>` once `LEGACY_API_SUNSET` (an HTTP-date) is set in the backend's
  environment. The old prefix is removed after its request log has shown no traffic for 30 days.
- Health checks stay at `/api/health/*`, outside both prefixes.
- The web app still calls the old prefix through its BFF (`API_URL`, `NEXT_PUBLIC_API_URL` end in `/v1/api`). Moving it is a config change
  (end them in `/api/v1`) plus a deploy of the frontend and backend together; the client already reads the new error format.

## Errors
On `/api/v1`, every error is RFC 9457 `application/problem+json`:

```json
{ "type": "about:blank", "title": "Bad Request", "status": 400, "detail": "The id is not valid",
  "instance": "/api/v1/projects/x", "code": "BAD_REQUEST", "requestId": "…", "errors": [ … ] }
```
`code` is stable and machine-readable; `errors` appears for validation failures; the query string is never echoed. The old prefix keeps
its previous body (`{ success: false, error: { code, message }, metadata }`) until it is removed.

## Built / not yet built (Phase 1)
| Convention | State |
|---|---|
| `/api/v1` prefix, old prefix deprecated | built |
| RFC 9457 errors on the new prefix | built |
| `429` with `Retry-After` | existing throttler and `TryAgainLaterException` |
| Cursor pagination (`limit` default 50, max 200, `cursor`, `{ data, page: { next } }`) | not built: each list needs its own change |
| `Idempotency-Key` on create, bulk and job routes | not built |
| `ETag` / `If-Match` on PUT and PATCH | not built |
| Shared `/jobs/{id}` resource for long work | not built (Phase 2) |
| OpenAPI generated from the route-policy inventory, naming-rule CI check | not built |
