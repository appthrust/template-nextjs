import "server-only";

import { headers } from "next/headers";
import {
  fromEnv,
  type AppAccess,
  type AppAccessClient,
} from "@appthrust/app-access";

// App roles are opt-in. Nothing here runs until APP_ACCESS_APPLICATION is set
// and your code calls currentAccess(); see "App roles" in README.md.

// Environment prefix of the platform connection (a connection named
// "platform" supplies PLATFORM_API_URL, PLATFORM_PROJECT_ID and
// PLATFORM_ACCESS_ISSUER).
const CONNECTION_PREFIX = "PLATFORM";

let client: AppAccessClient | undefined;

export function appAccessEnabled() {
  return Boolean(process.env.APP_ACCESS_APPLICATION?.trim());
}

// One client per server process so requests share its caches. Throws when the
// platform connection is missing: a half-configured app fails closed.
export function appAccess(): AppAccessClient {
  client ??= fromEnv(CONNECTION_PREFIX, {
    application: process.env.APP_ACCESS_APPLICATION?.trim() ?? "",
  });
  return client;
}

// Permissions of the signed-in user for the current request. Use it in Server
// Actions and Server Components; Route Handlers can pass their Request to
// appAccess().getAppAccess(request) instead.
export async function currentAccess(): Promise<AppAccess> {
  return appAccess().getAppAccess(await headers());
}
