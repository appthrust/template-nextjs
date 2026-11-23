import assert from "node:assert/strict";
import test, { after } from "node:test";
import { NextRequest } from "next/server.js";
import { Unavailable } from "@appthrust/app-access";
import { hooks } from "./fixtures/register-app.mjs";

const previousEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("PLATFORM_")));
for (const key of Object.keys(previousEnv)) delete process.env[key];
const { requireUser } = await import("../lib/app-access.ts");
const { proxy } = await import("../proxy.ts");
const { GET: health } = await import("../app/healthz/route.ts");
after(() => { Object.assign(process.env, previousEnv); hooks.deregister(); });

test("missing platform configuration fails closed without throwing at module import", async () => {
  await assert.rejects(requireUser(), Unavailable);
  for (const path of ["/", "/route-added-without-a-guard", "/api/new-route"]) {
    const response = await proxy(new NextRequest(`http://localhost${path}`));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("x-appthrust-access"), "unavailable");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(await response.text(), /App access is unavailable/);
  }
});

test("health probe still bypasses access with platform configuration missing", async () => {
  const response = await proxy(new NextRequest("http://localhost/healthz"));
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(health().status, 200);
  assert.equal(await health().text(), "ok");
});
