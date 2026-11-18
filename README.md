# AppThrust Next.js PostgreSQL template

This starter proves the AppThrust managed PostgreSQL path:

- AppThrust injects `DATABASE_URL` through `ComponentConnection`.
- The initial schema is applied through `DatabaseChange`.
- The Next.js app reads and writes `appthrust_demo_messages`.

The Docker image is a code-only artifact run by the AppThrust Managed Runtime
`nodejs-24`, which supplies Node.js and launches `node server.js` in
`/workspace/app` as UID/GID 1000 with a writable `.next/cache` volume. It is not
runnable standalone with `docker run`. For local development, use `npm run dev`.

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

Local development does not supply a signed-in person. To test protected features
without Platform, use an isolated fixture that exercises the same exchange and
signature checks. No identity fixture ships with this template.

## Platform health probes

For this template, startup, liveness and readiness probe `GET /healthz`. Keep its `ok` response independent of the database and sign-in. The AI development preview checks `/` separately; neither check proves authorization.

## Signed-in person

Platform authenticates; the app decides who may use it and what they may do.
Passing a sign-in gateway means only “signed in.” A public publish supplies no
verified person. Never infer one from guessed headers, cookies, client input or
the claims in a forwarded IdP token.

**Today:** On a `company` publish without external authorization, the gateway
forwards `Authorization: Bearer …`. With a platform connection and app access
model configured, use the server-side client's `getAppAccess` (setup below).
It exchanges the bearer at `POST /api/v1/access/user-token`, verifies the
Platform assertion and returns `subjectIssuer`, `subject` and permissions.
On `group` and `private` publishes, external authorization strips both
`Authorization` and `Cookie`; the app cannot identify the caller today. If a
feature cannot get a verified person, leave it closed and report what is
missing. Do not widen sharing, add a login screen or invent a fallback user.

The published `@appthrust/app-access` 0.2.0 client is not a template dependency.
Its `require` and `has` permission checks work today. The exchange already
signs a `principal` (`u_…`), but `getAppAccess` does not expose it. Until it
does, leave author-recording writes closed and report the missing helper
support. Do not write a verifier, derive the key or trust unsigned JSON.

Once the helper exposes it, use the signed `principal` as the only author key
(`author_principal`). Snapshot the display name in `author_display_name` at write
time. The assertion supplies no personal name today; when a name is absent,
store NULL and show “Name unavailable.” Never key a person by name or email. Signed group grants
contain group keys and permissions, not names. Group labels come from a
separate directory that requires app declaration, admin consent and caller
permission; it is not a source of personal names.

Before each protected read or write, including inside a Server Action, verify
the caller and enforce the app's permissions and row ownership rules. Deny
before touching the database: 401 for missing or invalid credentials, 403 for
a verified caller without the required permission, 503 if the exchange or
assertion cannot be verified. Keep protected data out of public static files.

**Planned, not available in this template:** `requireUser(request)` is the single
server entry point for `company`, `group` and `private`. It will require `app:use`,
assigned respectively to all signed-in people, selected groups, or the owner and
invitees. The standard model will be active at creation; only additional business
permissions will be optional. The app's `access:manage` holders will manage
assignments, with changes taking effect in about a minute without rebuilding.
The planned result includes an optional `displayName` and `user.can(permission)`
for additional checks. Neither default-deny middleware nor the AI-build
authorization check ships today.

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
