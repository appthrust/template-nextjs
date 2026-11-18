# AppThrust Next.js PostgreSQL template

This starter proves the AppThrust managed PostgreSQL path:

- AppThrust injects `DATABASE_URL` through `ComponentConnection`.
- The initial schema is applied through `DatabaseChange`.
- The Next.js app reads and writes `appthrust_demo_messages`.

The Docker image is a code-only artifact run by the AppThrust Managed Runtime
`nodejs-24`, which supplies Node.js and launches `node server.js` in
`/workspace/app` as UID/GID 1000 with a writable `.next/cache` volume. It is not
runnable standalone with `docker run`. Local development is unchanged: use
`npm run dev`.

The app does not run migrations on startup. For local development, apply
`db/migrations/0001_init.sql` to your PostgreSQL database, then set:

```bash
DATABASE_URL=postgresql://app:password@localhost:5432/app
```

Run locally:

```bash
npm install
npm run dev
```

## Platform health probes

The platform probes `GET /healthz` for startup and liveness, and `GET /` for readiness. Keep `/healthz` static and database-independent so startup and liveness do not depend on database availability.

## Signed-in person

A publish's share scope decides **who may open the published URL**. That does
not tell the app **who made a request**. Even a verified identity does not decide
**what that person may do**: check app permissions before each protected operation.

| Share scope | What reaches the backend today | Server helper today |
| --- | --- | --- |
| `public` | No sign-in required; no verified person. | None |
| `company` | After sign-in (no external authorization), the edge forwards only `Authorization: Bearer <IdP access token>`. No name or email headers; no guaranteed app audience. | `getAppAccess` with a platform connection and a stack access model; verified subject key, no display name |
| `group` | After external authorization allows the request, the edge removes `Authorization`. No verified person. | None |
| `private` | After external authorization allows the request, the edge removes `Authorization`. No verified person. | None |

**Supported today:** On a `company` publish with a platform connection and an
access model on the stack, call `getAppAccess(await headers())` on the server
as shown below. The `@appthrust/app-access` client exchanges the forwarded
bearer token with Platform. Use the verified `(subjectIssuer, subject)` pair
as the author key; the helper does not return a display name. A neutral label
such as “Signed in” is accurate when the person is verified but unnamed.
On `public`, `group` or `private`, or if the exchange is not configured, stop
and report the missing prerequisite for any feature that needs a verified
person. Do not guess a name or change the share scope to make the feature work.

**Upcoming, not yet released or enabled:** The server-side helper
`getPrincipal(await headers())` from `@appthrust/app-access` will verify a
Platform-signed assertion in the reserved `X-AppThrust-Principal` header and
return `{ subjectIssuer, subject, displayName? }`. Until Platform reports
principal delivery available for that publish, the helper will fail with
`Unavailable`. It will verify the assertion against the `APPTHRUST_PRINCIPAL_*`
settings supplied by Platform. Never set these reserved names in the app or
read the header as a substitute for verification.

## App roles (optional)

App roles let a Project admin decide which groups and people may view, edit or
manage each kind of item in this app. Roles grant permissions; they do not
supply a person's display name. The template does not include them. Add
them only to an app that needs them: the helper package comes from GitHub
Packages, which requires a token to install even though the package is public.

### 1. Install the helper

Create `.npmrc` (it holds a variable reference; never commit a token):

```ini
@appthrust:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Install with a token that has `read:packages`:

```bash
gh auth refresh --scopes read:packages   # once
NODE_AUTH_TOKEN=$(gh auth token) npm install --save-exact @appthrust/app-access
```

From now on `npm ci` needs `NODE_AUTH_TOKEN` too. `npm run dev`, `lint` and
`build` do not.

### 2. Let the image build install it

In `.github/workflows/deploy.yml`, uncomment the `secrets:` lines of the
"Build and push Docker images" step. The `Dockerfile` already reads that build
secret.

### 3. Add the server code

`lib/app-access.ts`:

```ts
import "server-only";

import { headers } from "next/headers";
import {
  fromEnv,
  type AppAccess,
  type AppAccessClient,
} from "@appthrust/app-access";

let client: AppAccessClient | undefined;

// One client per server process so requests share its caches. "PLATFORM" is
// the environment prefix of a platform connection named "platform". Throws
// when the connection is missing: a half-configured app fails closed.
export function appAccess(): AppAccessClient {
  client ??= fromEnv("PLATFORM", {
    application: process.env.APP_ACCESS_APPLICATION?.trim() ?? "",
  });
  return client;
}

// Permissions of the signed-in user for the current request, for Server
// Actions and Server Components.
export async function currentAccess(): Promise<AppAccess> {
  return appAccess().getAppAccess(await headers());
}
```

Check a permission on the server before every protected read or write; hiding
a button is not authorization. For example, to let only editors save messages
in `app/actions.ts`:

```ts
import { currentAccess } from "@/lib/app-access";

export async function createMessage(formData: FormData) {
  // Throws Unauthenticated (not signed in), Forbidden (not permitted) or
  // Unavailable (platform unreachable); nothing below runs.
  (await currentAccess()).require("messages:write");
  // ...save the message
}
```

A Route Handler passes its `Request` and maps those errors to 401 / 403 / 503
with `toResponse`:

```ts
import { toResponse } from "@appthrust/app-access";
import { appAccess } from "@/lib/app-access";

export async function GET(request: Request) {
  try {
    const access = await appAccess().getAppAccess(request);
    access.require("messages:read");
    return Response.json({ canWrite: access.has("messages:write") });
  } catch (error) {
    return toResponse(error);
  }
}
```

### 4. Turn it on in AppThrust

1. In the Dashboard, open the Application's **Access** tab, define the item
   types and roles, and assign roles to groups or people.
2. For an endpoint intended for `company` sharing, require sign-in and add a
   platform connection to the web component. Do not switch a `group` or
   `private` publish to this mode:

   ```bash
   apth publishes access set <project> <publish> --mode Authenticated
   apth component-connections create <project> <web component> --destination-platform --name platform
   ```

3. Set `APP_ACCESS_APPLICATION` to the Application resource name:

   ```bash
   apth apps env set <application> APP_ACCESS_APPLICATION=<application>
   ```

Permission names such as `messages:write` are the ones the Access tab shows
for each item type and level. Role changes reach the app within about a
minute; the first activation can take up to five minutes for users who were
already signed in. See the
[`@appthrust/app-access` README](https://github.com/appthrust/platform/tree/main/dashboard/packages/app-access)
for errors and caching.
