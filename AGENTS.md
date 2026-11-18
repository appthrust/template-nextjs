<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Signed-in person

Access to the published URL does not tell the app who the person is. The table lists possible paths, not proof of configuration. If Platform supplies a build context, use only the helper it identifies for this publish.

| Share scope | What reaches the backend today | Server helper today |
| --- | --- | --- |
| `public` | No sign-in required; no verified person. | None |
| `company` | After sign-in (no external authorization), the edge forwards only `Authorization: Bearer <IdP access token>`. No name or email headers; no guaranteed app audience. | `getAppAccess` with a platform connection and a stack access model; verified subject key, no display name |
| `group` | After external authorization allows the request, the edge removes `Authorization`. No verified person. | None |
| `private` | After external authorization allows the request, the edge removes `Authorization`. No verified person. | None |

- Never infer identity from headers such as `x-forwarded-*`, `x-auth-request-*` or `x-appthrust-*`, cookies you did not set, form/JSON/query input, or a token decoded without verification.
- If a feature needs a verified person and this publish cannot provide one, stop and report the missing prerequisite. Do not widen sharing or invent a login screen, demo user or name picker.
- Resolve identity on the server for reads and writes. Re-verify the caller in each protected Server Action before accessing the database; do not accept the author from the client.
- Persist the author as the verified `(subjectIssuer, subject)` pair. Store any display label separately, never as a key. A missing name does not mean the person is signed out.
- Verify identity behavior through the real authenticated path, never by sending identity headers you set yourself.
