<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Signed-in person

Platform authenticates. Passing a sign-in gateway means “signed in,” not “allowed to use this app.” The app decides who may enter and what they may read or change. A public publish supplies no verified person.

- **Single entry point:** use `await requireUser()` from `lib/app-access.ts` in server code. It calls the bundled `@appthrust/app-access` 0.3.1 client with `getAppAccess(await headers())` and always requires `app:use`. `requireUser("permission")` additionally requires that permission. Do not create a second authentication helper or token verifier.
- Never infer identity or authorization from raw headers, cookies, browser input, decoded claims or unsigned role metadata. Authorize only with `user.principal`, `user.groupGrants` and `user.can(permission)`.
- `proxy.ts` guards every route by default. Add new pages and APIs under this guard. Public pages need an exact GET/HEAD entry in `lib/public-routes.ts` and a stated reason; POSTs remain protected. Do not exempt paths by file extension, rewrite a public exception into a protected route, or put private data in static assets/optimized images.
- Check identity, permission and any row ownership before each protected read or write, including inside each Server Action. Hiding a button is not authorization.
- Store only the signed `user.principal` as the person key (`author_principal`), never the original subject/issuer, a name or an email. A truncated principal is for display only, never ownership comparisons.
- Snapshot `user.displayName ?? null` in `author_display_name` at write time; ignore browser-supplied author fields. The platform does not deliver personal display names yet, so the wrapper returns `undefined`. Missing names are fine; display a neutral label. Never invent a name or treat its absence as logout.
- Fail closed: missing configuration is `Unavailable` (503); missing/invalid credentials are `Unauthenticated` (401); missing signed permissions are `Forbidden` (403). Unverifiable assertions deny access. Keep the fixed bilingual pages and `Cache-Control: no-store`; mark only deliberate access-unavailable 503s with `x-appthrust-access: unavailable`. Never render exception messages, identities or stack traces on denial pages.
- On today's `company` publishes the gateway forwards the bearer. On `group/private`, it strips Authorization and Cookie until the per-app edge cutover. The 401 page explains that those publishes are not available yet. Do not widen sharing, invent a login or substitute a demo user.
- `app-access.json` is the only role model: `app-user` grants `app:use` to `Authenticated` by default; `access-manager` grants `access:manage` and requires explicit assignment. Merge business permissions into that model. Each app still needs the two operator steps in README: a Ready platform connection and a declared, accepted access model (`pending=false`).
- Keep the four connection variables `PLATFORM_API_URL`, `PLATFORM_ACCESS_ISSUER`, `PLATFORM_PROJECT_ID`, `PLATFORM_APPLICATION`; initialize `fromEnv("PLATFORM")` once per process. No fake identity mode for local development: without env, render the deliberate 503 and keep `/healthz` healthy.
- Tests must call the real `requireUser` with Next.js's real `HeadersAdapter` and exercise SDK verification with signed fixtures. A plain `Headers` mock misses the adapter regression. Forged headers are rejection fixtures only, never a positive identity source.

## Before image publication

Run `npm run typecheck`, `npm test`, and `npm run test:smoke`. The last command builds and starts the standalone server without platform configuration, requires `/healthz` = 200 and `/` = 200/3xx/401/403 or a 503 carrying `x-appthrust-access: unavailable`, then stops the server. An unmarked 503, 500/502/504 or connection failure must fail. Keep these gates ahead of image publication in `.github/workflows/deploy.yml`; never ignore a failure. Keep the committed `.npmrc` variable reference and the Docker `node_auth_token` secret mount working; never embed a token. Offline smoke proves startup/default denial, not live sign-in or database persistence.
