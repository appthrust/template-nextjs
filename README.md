# AppThrust Next.js PostgreSQL template

A signed-in starter with default-deny access and managed PostgreSQL. Platform
authenticates the person; this app authorizes with signed facts from
`@appthrust/app-access` **0.3.1**. No hand-written token verifier or fallback user.

The code-only Docker image runs on AppThrust Managed Runtime `nodejs-24`,
which launches `node server.js` in `/workspace/app` as UID/GID 1000 with a writable
`.next/cache` volume. It is not a standalone `docker run` image.

## Install and run locally

Use Node.js 24, npm and a GitHub token with `read:packages`:

```bash
gh auth refresh --scopes read:packages   # once, if the token lacks this scope
NODE_AUTH_TOKEN=$(gh auth token) npm ci
npm run dev
```

The committed `.npmrc` selects GitHub Packages and contains only
`${NODE_AUTH_TOKEN}`, never a token. The token is needed for installation, not
for `dev`, typechecking, tests or builds.

Without platform configuration, `/` deliberately renders a **503** page in
Japanese and English, with `Cache-Control: no-store` and
`x-appthrust-access: unavailable`. This is not a crash. `/healthz` remains 200.
There is no fake identity or auto-login mode.

To connect local development to a real platform, copy these four values from
the web component's `platform` connection into an uncommitted `.env.local`:

```dotenv
PLATFORM_API_URL=https://your-platform-api
PLATFORM_ACCESS_ISSUER=https://your-platform-access-issuer
PLATFORM_PROJECT_ID=your-project-resource-id
PLATFORM_APPLICATION=your-application-resource-name
```

Use the actual generated values, not a display name or component name.
Restart `npm run dev` after changing them: the SDK client (or configuration
failure) is initialized once per process. These values are configuration,
**not credentials**. Requests still need the real platform's signed-in gateway
path forwarding the caller's bearer for this application; opening localhost
directly with only these variables returns 401. Do not copy identity headers or
cookies to simulate a person. Unit tests use isolated signed fixtures, not a
development login.

For local PostgreSQL, set `DATABASE_URL` and apply every migration in order:

```bash
export DATABASE_URL='postgresql://app:password@localhost:5432/app'
for migration in db/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done
```

Platform creates the initial schema from `db/migrations` through
`DatabaseChange`; the app never runs DDL on startup. When upgrading an existing
app, apply `0002_message_authors.sql` through the usual DatabaseChange flow
before using the new message form. Seed/legacy rows have NULL author fields;
no person is invented for them. New messages store a signed `author_principal`
and a nullable `author_display_name` snapshot.

## Operator setup: two steps per application

The template includes the SDK, guard and access declaration, but the platform
connection and accepted model must still be configured for each app.
Start with an existing application and its web component. Use Bash with `apth`,
`jq`, `curl` and Node.js installed. Find the resource IDs in the Dashboard.

```bash
read -rp 'Platform API URL (https://...): ' API_URL
API_URL="${API_URL%/}"
read -rp 'Project resource ID: ' PROJECT
read -rp 'Application resource name: ' APPLICATION
read -rp 'Web component resource ID: ' WEB_COMPONENT
PROFILE=template-setup
apth login --profile "$PROFILE" --api-url "$API_URL" --project "$PROJECT"
apth whoami --profile "$PROFILE"
```

### 1. Create the platform connection

```bash
CONNECTION_ID=$(
  apth component-connections create "$PROJECT" "$WEB_COMPONENT" \
    --destination-platform --name platform --profile "$PROFILE" --json |
    jq -er '.id'
)
apth component-connections get "$PROJECT" "$CONNECTION_ID" \
  --profile "$PROFILE" --json | jq '{id, state, generatedEnvKeys}'
```

If the connection already exists, use its ID from
`apth component-connections list "$PROJECT" --profile "$PROFILE" --json`
instead of creating another. Re-run the `get` readback until `state` is
**Ready** and `generatedEnvKeys` includes all four SDK inputs:
`PLATFORM_API_URL`, `PLATFORM_ACCESS_ISSUER`, `PLATFORM_PROJECT_ID`,
`PLATFORM_APPLICATION`. Do not manually set an `APP_ACCESS_APPLICATION`
override. A half-configured app stays closed with 503.

### 2. Declare and accept App roles

`app-access.json` is the body for
`PUT /api/v1/projects/<p>/applications/<app>/access/model`. It declares:

| Permission | Role | Default assignment |
| --- | --- | --- |
| `app:use` | `app-user` | `Authenticated` (Everyone signed in) |
| `access:manage` | `access-manager` | None; assign explicitly |

Declaring requires `project.write`. Acceptance and current Dashboard binding
administration require a **`project.manage` holder**. That caller's PUT accepts
automatically; otherwise a manager must accept in the Dashboard. Merely
declaring the model does not authorize anyone.

The CLI has no application-access-model command yet. Use its saved login
credential for this API request; do not print the token or use `set -x`:

```bash
CREDENTIALS="${APTH_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/appthrust}/credentials.json"
PLATFORM_TOKEN=$(jq -er --arg profile "$PROFILE" '.profiles[$profile].accessToken' "$CREDENTIALS")
platform_api() {
  printf 'Authorization: Bearer %s\n' "$PLATFORM_TOKEN" |
    curl --fail-with-body --silent --show-error --header @- "$@"
}
ACCESS_URL="$API_URL/api/v1/projects/$PROJECT/applications/$APPLICATION/access"
platform_api --request PUT --header 'Content-Type: application/json' \
  --header "Idempotency-Key: $(node -p 'crypto.randomUUID()')" \
  --data-binary @app-access.json "$ACCESS_URL/model" |
  jq '{declared, pending, offeredDigest, acceptedDigest}'
```

In Dashboard: **app → Access → Roles → accept** as a `project.manage` holder
if pending. Then **Who can do what → Everyone signed in → app-user**: verify
the default binding (add it if missing), and explicitly assign
`access-manager` only to the intended people/groups. This role is declared for
app-side sharing controls; it does not replace today's `project.manage`
requirement on the Platform management API.

Read back after acceptance and reconciliation:

```bash
platform_api "$ACCESS_URL" |
  jq '{declared, pending, bindings, snapshot}'
# Required: declared=true, pending=false; app-user bound to Authenticated.
# If pending, re-run this GET after reconciliation; do not treat the PUT as readiness.
unset PLATFORM_TOKEN
unset -f platform_api
```

Keep this single model when adding business permissions: add permissions and
roles to `app-access.json`, PUT it again and accept the new model. Permission
and role names are append-only. Check additional permissions with
`await requireUser("messages:write")` or `user.can(...)`, never role labels.
Role-binding changes normally take effect within about a minute without a
rebuild; first activation can require signing in again.

### Current share-scope limitation

On **company** publishes, the gateway forwards `Authorization`. On today's
**group/private** publishes, external authorization strips both `Authorization`
and `Cookie` until the per-app edge cutover. Those requests receive a clear
401 “not available yet” page: the app cannot see who you are yet.
A public publish supplies no verified person either. Do not widen sharing,
invent a login or use a fallback identity to work around this limitation.

## Application code contract

`lib/app-access.ts` is the single server entry point:

```ts
const user = await requireUser(); // always requires app:use
user.principal;                  // signed durable person key (u_…)
user.groupGrants;                // signed per-app groups and their permissions
user.can("access:manage");        // signed permission check
user.displayName;                // undefined: platform does not deliver names yet
```

It calls `getAppAccess(await headers())` directly. Version 0.3.1 supports the
real Next.js `HeadersAdapter`; no adapter workaround is needed. Missing
configuration throws `Unavailable`, missing/invalid credentials throw
`Unauthenticated`, insufficient signed permissions throw `Forbidden`.
Unverifiable identity never falls back. Missing names and empty group grants
are valid for an otherwise permitted person.

`proxy.ts` matches **every route**, including newly added pages, Route Handlers
and Server Action POSTs. Only GET/HEAD for `/healthz`, `/favicon.ico`,
`/_next/static/*` and `/_next/image` bypass the guard. The explicit allowlist
lives in `lib/public-routes.ts`; any new public page needs an exact path and a
stated reason. Do not rewrite public exceptions into protected routes. Static
assets and optimized images must contain only public data, never secrets.

The proxy returns fixed bilingual 401/403/503 pages with `Cache-Control:
no-store`, no identity details and no exception messages. Only deliberate
access-unavailable 503 responses carry `x-appthrust-access: unavailable`.

Also call `requireUser` before each protected read/write inside pages, Route
Handlers and actions; the guard is not a substitute for operation/row checks.
The starter page displays a truncated principal and group-grant count.
`app/actions.ts` stores `user.principal` and `user.displayName ?? null`, never
an author sent by the browser. Names/emails are labels, not keys; row ownership
must compare the complete signed principal, not its truncated display.

## Build, deploy and checks

Both `.github/workflows/deploy.yml` and the platform-generated deploy workflow
(platform PR #7417) pass `node_auth_token=GITHUB_TOKEN` to the Docker build.
The generated workflow grants `packages: read`; this template workflow grants
`packages: write` because it also publishes the image. GitHub Packages must
allow the generated repository's Actions token to read `@appthrust/app-access`.

The Dockerfile copies the committed `.npmrc` (not excluded by `.dockerignore`)
and requires the BuildKit secret only for `npm ci`. Never put a token in a
Docker ARG, ENV, source file or image layer. No platform connection or database
is needed to build.

```bash
npm run typecheck
npm test
npm run test:smoke
```

These gates run before image publication. Unit tests exercise the real helper,
real HeadersAdapter and SDK with signed fixtures, including forged-header
rejection, default-deny routes and author persistence.

The smoke unsets `PLATFORM_*`, `APP_ACCESS_*`, `APTH_*` and `DATABASE_URL`,
builds and starts the standalone server, then requires `/healthz` = 200.
`/` must be 200/3xx/401/403, or **503 with
`x-appthrust-access: unavailable`**. An unmarked 503, any 500/502/504 or
connection failure fails CI. Keep local `.env*` configuration out of this
check. Port 3000 is the default; set `SMOKE_PORT` to an unused local port.
Startup/requests are bounded and the server is stopped on success or failure.

Platform startup, liveness and readiness probes use `/healthz`, never `/`.
Its constant `ok` response proves process health, not authorization or database
readiness. After per-app setup, sign in through the real publish and save one
message to prove the runtime/author path; offline smoke alone does not prove it.
