import { headers } from "next/headers";
import {
  fromEnv,
  Unavailable,
  type AppAccess,
  type AppAccessClient,
} from "@appthrust/app-access";

export interface AppUser {
  readonly principal: string;
  // The platform does not deliver a personal display name yet. Never derive one.
  readonly displayName?: string;
  readonly groupGrants: AppAccess["groupGrants"];
  can(permission: string): boolean;
}

let client: AppAccessClient | Unavailable | undefined;

function appAccess(): AppAccessClient {
  if (!client) {
    try {
      client = fromEnv("PLATFORM");
    } catch {
      // Cache configuration failure too; changing connection env requires a restart.
      client = new Unavailable();
    }
  }
  if (client instanceof Unavailable) throw client;
  return client;
}

/** Require app:use plus any additional permission, before every protected read/write. */
export async function requireUser(permission = "app:use"): Promise<AppUser> {
  const access = await appAccess().getAppAccess(await headers());
  access.require("app:use");
  if (permission !== "app:use") access.require(permission);
  return {
    principal: access.principal,
    displayName: undefined,
    groupGrants: access.groupGrants,
    can: (requested) => access.has(requested),
  };
}
