<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Signed-in person

Platform authenticates. Passing a sign-in gateway means “signed in,” not “allowed to use this app.” The app decides who may enter and what they may read or change. A public publish supplies no verified person.

- On a `company` publish without external authorization, the gateway forwards a bearer. Use the server-side `@appthrust/app-access` client's `getAppAccess` with a configured platform connection. It exchanges the bearer and verifies the result. Never infer identity from guessed headers, cookies, client input or decoded IdP claims; do not write a token verifier.
- On today's `group` and `private` publishes, external authorization removes `Authorization` and `Cookie` before the request reaches the app. No verified person is available.
- Check identity, permission and any row ownership before each protected read or write, including inside each Server Action. If identity is missing or unverifiable, deny access. Do not widen sharing, invent a login or substitute a demo user.
- `getAppAccess` returns `subjectIssuer` and `subject`, not the signed `principal` (`u_…`) or a display name. If a feature must record an author, report the missing helper support and leave the write closed. Do not derive the key yourself.
- The author record needs only `author_principal` and a snapshot of the display name at write time (`author_display_name`, NULL if absent). Render a neutral label for a missing name; never use a name or email as a key. Build context indicates readiness, not a choice of identity schemes.
- **Planned, not available:** `requireUser(request)` will check `app:use` for `company`, `group` and `private` alike. Only the assignment differs. Do not import it or assume routes are protected by default.
- Test through the real exchange or an independent fixture that exercises the same exchange and verification. Use self-asserted headers only to test rejection, never to simulate a signed-in user.
