# Auth0 tenant as code

`tenant.yaml` is the intended state of the eMithran Auth0 tenant: the API (RS256), the web application (callback and logout URLs, no
wildcards), the grant that lets the app call the API, the database connection with **public sign-up off**, and the post-login Action that
adds the claims the backend reads. Change the tenant here, never by hand in the dashboard.

## Settings per environment
Copy `env/local.example.json` to `env/<local|stage|prd>.json` (git-ignored) and fill in that environment's audience, namespace, database
connection name and `APP_BASE_URL`. Use a **separate Auth0 tenant per environment** (at least one for prd, one for stage/local).

## Check for drift (read-only, safe on any tenant)
```bash
cd backend
npm run auth0:check     # your .env: settings present and the tenant answers
npm run auth0:drift     # compares the live tenant with auth0/tenant.yaml's rules
```
`auth0:drift` needs a machine-to-machine app in the tenant authorized for the Management API with only `read:clients read:client_grants
read:connections read:resource_servers read:actions read:triggers`. Put its id and secret in your shell (not in the repo):
`AUTH0_MGMT_CLIENT_ID`, `AUTH0_MGMT_CLIENT_SECRET`. It reports FAIL lines for: sign-up on, a public social login enabled for the app
(for example "Continue with Google"), wrong callback or logout URLs, a non-RS256 API, a missing app-to-API grant, and a post-login Action
that is not deployed and bound.

## Deploy (changes the tenant: you run it, after drift shows what differs)
Use a deploy-only M2M app (the Auth0 "Deploy CLI" extension creates one). Try it on the stage or local tenant first.
```bash
cd auth0
AUTH0_DOMAIN=<tenant> AUTH0_CLIENT_ID=<deploy app id> AUTH0_CLIENT_SECRET=<deploy app secret> \
  npx auth0-deploy-cli@9.3.0 import --input_file tenant.yaml --config_file config.json
```
`config.json` is `{"AUTH0_ALLOWED_ORIGINS": [], "AUTH0_ALLOW_DELETE": false, "AUTH0_KEYWORD_REPLACE_MAPPINGS": { ...contents of env/<env>.json... }}`.
Deleting is off, so a Google social connection that already exists is not removed by deploy: switch it off for the app in the dashboard
once (Authentication > Social > Google > Applications), and `auth0:drift` then stays green.

The company SSO connection (Google Workspace / Entra / SAML) is created in the dashboard because it holds a client secret from the
identity provider; drift only checks it is the sole non-database login enabled for the app.
