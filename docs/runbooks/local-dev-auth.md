# Running locally without Auth0

For one developer on their own machine. The app runs with no Auth0 login, and the API acts as one account you name (it must already exist in
`auth.users`; the platform and organization roles of that account apply, so pick an admin to see admin screens).

## Turn it on

```
node scripts/dev-local-auth.mjs on you@your-company.com
```

This sets three keys in your own `.env` and prints only those: `ALLOW_DEV_AUTH_BYPASS=true`, `ADMIN_FALLBACK_EMAIL=<that email>`,
`NEXT_PUBLIC_DEV_AUTH_BYPASS=true`. **Restart the backend and the frontend** (`NEXT_PUBLIC_` values are read when Next.js starts).

`node scripts/dev-local-auth.mjs off` switches it back, `status` shows the three values. The script works the same on Windows and macOS and
refuses when the file says `NODE_ENV=production`.

## How it is kept out of production

| Gate | Where | Effect |
|---|---|---|
| `NODE_ENV !== 'production'` and `ALLOW_DEV_AUTH_BYPASS=true` | API guard, checked on every request (`DatabaseService.isDevAuthBypassEnabled`) | a request with no token is served as `ADMIN_FALLBACK_EMAIL`; otherwise 401 |
| `ALLOW_DEV_AUTH_BYPASS=true` with `NODE_ENV=production` | `env.validation.ts` | the API refuses to start |
| `NODE_ENV !== 'production'` and `NEXT_PUBLIC_DEV_AUTH_BYPASS=true` | `lib/auth/dev-bypass.ts` | the BFF forwards a call with no session and no token (instead of refusing it), and the sign-in state is read from the API |

A request that carries a token is verified as always; the bypass only covers a call with none.

## Limits

The few Next.js routes that call Auth0 themselves (`requireUser`, e.g. the drawing-analysis proxy to the CAD engine) still need a real session.
