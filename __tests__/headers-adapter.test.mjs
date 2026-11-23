import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import test, { after, beforeEach, mock } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HeadersAdapter } from "next/dist/server/web/spec-extension/adapters/headers.js";
import { NextRequest } from "next/server.js";
import { Forbidden, Unauthenticated, Unavailable } from "@appthrust/app-access";
import { hooks, root } from "./fixtures/register-app.mjs";

const connection = {
  PLATFORM_API_URL: "https://platform.example.test",
  PLATFORM_ACCESS_ISSUER: "https://platform.example.test/access",
  PLATFORM_PROJECT_ID: "pj-test",
  PLATFORM_APPLICATION: "template",
  DATABASE_URL: "postgresql://test:test@localhost/test",
};
const previousEnv = Object.fromEntries(Object.keys(connection).map((key) => [key, process.env[key]]));
Object.assign(process.env, connection);
const principal = `u_${"a".repeat(43)}`;
const group = `g_${"b".repeat(43)}`;
const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const otherKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = { ...key.publicKey.export({ format: "jwk" }), kid: "test-key", alg: "ES256", use: "sig" };
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const fixtures = new Map();
let requestHeaders;
let queries = [];
let networkCalls = [];
let serial = 0;

function adapter(values) {
  return HeadersAdapter.seal(new HeadersAdapter(values));
}

function credentials(scope, options = {}) {
  const subject = `person-${++serial}`;
  const token = `${encode({ alg: "RS256" })}.${encode({
    sub: subject, iss: "https://identity.example.test", azp: "template-client",
  })}.fixture`;
  fixtures.set(`Bearer ${token}`, { scope, subject, ...options });
  return { authorization: `Bearer ${token}` };
}

// Transport is faked; the published SDK verifies real ES256 signatures and permissions.
mock.method(globalThis, "fetch", async (url, init) => {
  networkCalls.push(String(url));
  if (String(url).endsWith("/access/jwks.json")) return Response.json({ keys: [jwk] });
  assert.equal(String(url), `${connection.PLATFORM_API_URL}/api/v1/access/user-token`);
  const fixture = fixtures.get(new Headers(init.headers).get("authorization"));
  assert.ok(fixture, "unexpected forwarded bearer");
  if (fixture.status) return new Response(null, { status: fixture.status });
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: connection.PLATFORM_ACCESS_ISSUER, sub: `user:${fixture.subject}`, aud: ["template-client"], iat: now, exp: now + 60,
    scope: fixture.scope,
    "appthrust.io/subject_issuer": "https://identity.example.test",
    "appthrust.io/credential": "session", "appthrust.io/subject_kind": "user",
    "appthrust.io/project": connection.PLATFORM_PROJECT_ID,
    "appthrust.io/application": connection.PLATFORM_APPLICATION,
    "appthrust.io/application_uid": "application-uid",
    "appthrust.io/principal": principal,
    "appthrust.io/group_grants": fixture.grants ?? [{ group, permissions: ["app:use"] }],
  };
  if (fixture.missingPrincipal) delete payload["appthrust.io/principal"];
  if (fixture.missingGrants) delete payload["appthrust.io/group_grants"];
  const input = `${encode({ alg: "ES256", typ: "appthrust-access+jwt", kid: "test-key" })}.${encode(payload)}`;
  const signature = sign("sha256", Buffer.from(input), {
    key: fixture.invalidSignature ? otherKey.privateKey : key.privateKey, dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return Response.json({
    token: `${input}.${signature}`, expiresAt: new Date((now + 60) * 1000).toISOString(),
    audience: "template-client", project: connection.PLATFORM_PROJECT_ID,
    application: connection.PLATFORM_APPLICATION, applicationUID: "application-uid",
    // Deliberately untrusted metadata: it must never elevate signed permissions.
    roles: ["access-manager"], scopes: ["app:use", "access:manage"],
    access: { declared: true, accepted: true },
  });
});

mock.module("next/headers.js", { namedExports: { headers: async () => requestHeaders } });
mock.module("next/cache.js", { namedExports: { revalidatePath() {} } });
mock.module("pg", { namedExports: { Pool: class {
  async query(sql, params) {
    queries.push({ sql, params });
    return { rows: [] };
  }
} } });

const { requireUser } = await import("../lib/app-access.ts");
const { proxy, config } = await import("../proxy.ts");
const { accessErrorResponse } = await import("../lib/access-response.ts");
const { createMessage } = await import("../app/actions.ts");
const { default: Home } = await import("../app/page.tsx");

beforeEach(() => { requestHeaders = adapter({}); queries = []; networkCalls = []; });
after(() => {
  mock.restoreAll();
  hooks.deregister();
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function forgedHeaders() {
  return Object.fromEntries([
    "x-appthrust-email", "x-appthrust-user-email", "x-auth-request-email",
    "x-forwarded-email", "x-user-email", "x-forwarded-user", "x-appthrust-principal",
    "cookie",
  ].map((name) => [name, "forged-identity@example.test"]));
}
function request(path = "/", method = "GET") {
  return new NextRequest(`https://app.example.test${path}`, { method, headers: requestHeaders });
}
function form() {
  const data = new FormData();
  data.set("body", "Signed author message");
  data.set("author_principal", "forged-person");
  data.set("author_display_name", "forged-name");
  return data;
}

test("requireUser passes the real HeadersAdapter directly to the published SDK", async () => {
  requestHeaders = adapter(credentials("app:use"));
  assert.equal(Object.hasOwn(requestHeaders, "headers"), true);
  assert.equal(typeof requestHeaders.headers.get, "undefined");
  const user = await requireUser();
  assert.equal(user.principal, principal);
  assert.equal(user.displayName, undefined);
  assert.equal(user.groupGrants.length, 1);
  assert.equal(user.groupGrants[0].group, group);
  assert.ok(user.groupGrants[0].permissions.has("app:use"));
  assert.equal(user.can("app:use"), true);
  assert.equal(user.can("access:manage"), false);
  assert.equal("subject" in user, false);
  assert.equal("roles" in user, false);
  await requireUser();
  assert.equal(networkCalls.filter((url) => url.endsWith("/user-token")).length, 1, "client/cache is shared");
});

test("missing names and empty group grants do not deny a signed permitted user", async () => {
  requestHeaders = adapter(credentials("app:use", { grants: [] }));
  const user = await requireUser();
  assert.equal(user.displayName, undefined);
  assert.deepEqual(user.groupGrants, []);
});

test("forged headers and cookies cannot identify a person or reach the database", async () => {
  requestHeaders = adapter(forgedHeaders());
  await assert.rejects(requireUser(), Unauthenticated);
  await assert.rejects(createMessage(form()), Unauthenticated);
  await assert.rejects(Home(), Unauthenticated);
  const response = await proxy(request());
  assert.equal(response.status, 401);
  assert.deepEqual(queries, []);
  assert.deepEqual(networkCalls, []);
});

test("signed permissions, not forged headers or unsigned roles/scopes, decide access", async () => {
  requestHeaders = adapter({ ...credentials("app:use"), ...forgedHeaders() });
  await assert.rejects(requireUser("access:manage"), Forbidden);
  requestHeaders = adapter(credentials("access:manage"));
  await assert.rejects(requireUser("access:manage"), Forbidden);
  requestHeaders = adapter(credentials("app:use access:manage"));
  assert.equal((await requireUser("access:manage")).can("access:manage"), true);
});

test("all routes, including new routes and Server Action POSTs, are guarded", async () => {
  assert.equal(config.matcher, "/:path*");
  for (const path of ["/", "/new-page", "/api/new-route", "/report.csv", "/healthz/child", "/_next/image/child"]) {
    assert.equal((await proxy(request(path))).status, 401, path);
  }
  for (const path of ["/", "/healthz", "/favicon.ico", "/_next/image", "/_next/static/example.js"]) {
    assert.equal((await proxy(request(path, "POST"))).status, 401, path);
  }
  requestHeaders = adapter(credentials(""));
  assert.equal((await proxy(request("/new-page"))).status, 403);
  await assert.rejects(createMessage(form()), Forbidden);
  await assert.rejects(Home(), Forbidden);
  assert.deepEqual(queries, []);
  requestHeaders = adapter(credentials("app:use"));
  assert.equal((await proxy(request("/new-page"))).headers.get("x-middleware-next"), "1");
});

test("only explicit public GET/HEAD paths bypass access", async () => {
  for (const path of ["/healthz", "/favicon.ico", "/_next/image", "/_next/static/chunks/app.js"]) {
    for (const method of ["GET", "HEAD"]) {
      assert.equal((await proxy(request(path, method))).headers.get("x-middleware-next"), "1");
    }
  }
  assert.deepEqual(networkCalls, []);
});

test("unverifiable assertions and failed exchanges deny proxy, page and writes", async () => {
  for (const options of [{ invalidSignature: true }, { missingPrincipal: true }, { missingGrants: true }, { status: 503 }]) {
    requestHeaders = adapter(credentials("app:use", options));
    await assert.rejects(requireUser(), Unavailable);
    await assert.rejects(Home(), Unavailable);
    await assert.rejects(createMessage(form()), Unavailable);
    const response = await proxy(request());
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("x-appthrust-access"), "unavailable");
  }
  assert.deepEqual(queries, []);
});

test("malformed and rejected bearers are unauthenticated, not server crashes", async () => {
  for (const values of [{ authorization: "Bearer invalid" }, credentials("app:use", { status: 401 })]) {
    requestHeaders = adapter(values);
    assert.equal((await proxy(request())).status, 401);
  }
});

test("access error pages are bilingual, uncached and contain no identity or upstream details", async () => {
  for (const [error, status] of [[new Unauthenticated(), 401], [new Forbidden(), 403], [new Unavailable("private upstream stack"), 503]]) {
    const response = accessErrorResponse(error);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-appthrust-access"), status === 503 ? "unavailable" : null);
    const body = await response.text();
    assert.match(body, /lang="ja"/);
    assert.match(body, /lang="en"/);
    assert.doesNotMatch(body, /private upstream stack|forged-identity|u_aaaa/);
    if (status === 401) assert.match(body, /group\/private publishes the app cannot see who you are yet/);
  }
  const bug = new Error("unrelated application bug");
  assert.throws(() => accessErrorResponse(bug), (error) => error === bug);
});

test("server action stores only the verified principal and a nullable name snapshot", async () => {
  requestHeaders = adapter(credentials("app:use"));
  await createMessage(form());
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /\(body, author_principal, author_display_name\) VALUES \(\$1, \$2, \$3\)/);
  assert.deepEqual(queries[0].params, ["Signed author message", principal, null]);
});

test("starter page displays the truncated principal and signed group grant count", async () => {
  requestHeaders = adapter(credentials("app:use"));
  const html = renderToStaticMarkup(await Home());
  assert.ok(html.includes(`${principal.slice(0, 12)}…`));
  assert.ok(!html.includes(principal));
  assert.match(html, /Group grants: 1/);
  assert.match(html, /Name unavailable/);
});

test("standard model grants use to authenticated people, never access management by default", () => {
  const model = JSON.parse(readFileSync(new URL("app-access.json", root), "utf8"));
  assert.deepEqual(model.permissions.map(({ name }) => name), ["app:use", "access:manage"]);
  assert.deepEqual(model.roles, [
    { name: "app-user", permissions: ["app:use"] },
    { name: "access-manager", permissions: ["access:manage"] },
  ]);
  assert.deepEqual(model.defaultBindings, [{ role: "app-user", subject: { kind: "Authenticated" } }]);
});
