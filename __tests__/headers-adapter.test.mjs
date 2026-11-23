import assert from "node:assert/strict";
import test from "node:test";
import { HeadersAdapter } from "next/dist/server/web/spec-extension/adapters/headers.js";
import { GET } from "./fixtures/headers-route.mjs";

test("stub route reads headers through Next.js's real read-only adapter", async () => {
  const requestHeaders = HeadersAdapter.seal(
    new HeadersAdapter({ "x-request-id": "adapter-request" }),
  );

  // Unlike a plain Headers mock, the adapter also owns a non-Headers object.
  assert.equal(Object.hasOwn(requestHeaders, "headers"), true);
  assert.equal(typeof requestHeaders.headers.get, "undefined");

  const response = GET(requestHeaders);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { requestId: "adapter-request" });
});
