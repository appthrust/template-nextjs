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

## App roles (optional)

App roles let a Project admin decide which groups and people may view, edit or
manage each kind of item in this app. The template does not include them. Add
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
import { toResponse } from "@appthrust/app-access";
import { currentAccess } from "@/lib/app-access";

export async function createMessage(formData: FormData) {
  try {
    (await currentAccess()).require("messages:write");
  } catch (error) {
    // 401 not signed in, 403 not permitted, 503 platform unreachable.
    return { ok: false as const, status: toResponse(error).status };
  }
  // ...save the message
}
```

A Route Handler passes its `Request` instead: `appAccess().getAppAccess(request)`.

### 4. Turn it on in AppThrust

1. In the Dashboard, open the Application's **Access** tab, define the item
   types and roles, and assign roles to groups or people.
2. Require sign-in on the published endpoint and add a platform connection to
   the web component:

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
