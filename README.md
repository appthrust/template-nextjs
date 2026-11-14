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

## Installing dependencies

`@appthrust/app-access` is served by GitHub Packages, which requires a token
even for public packages. `.npmrc` reads it from `NODE_AUTH_TOKEN`; never
commit a token.

```bash
gh auth refresh --scopes read:packages   # once
NODE_AUTH_TOKEN=$(gh auth token) npm ci
```

`npm run dev`, `npm run lint` and `npm run build` do not need the token. In
GitHub Actions, `deploy.yml` passes the workflow's `GITHUB_TOKEN` to the image
build as a build secret.

## App roles (optional)

App roles let a Project admin decide which groups and people may view, edit or
manage each kind of item in this app. The template ships the helper but does
not use it: until you enable it, the app behaves as before and
`GET /api/access` returns 404.

To enable:

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

`GET /api/access` then returns the signed-in user's permissions. Check a
permission on the server before every protected read or write; hiding a button
is not authorization. For example, to let only editors save messages in
`app/actions.ts`:

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

Permission names such as `messages:write` are the ones the Access tab shows
for each item type and level. Role changes reach the app within about a
minute. See the
[`@appthrust/app-access` README](https://github.com/appthrust/platform/tree/main/dashboard/packages/app-access)
for Route Handlers, errors and caching.
