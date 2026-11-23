// Test-only route boundary; this does not authenticate a caller.
export function GET(requestHeaders) {
  return Response.json({ requestId: requestHeaders.get("x-request-id") });
}
