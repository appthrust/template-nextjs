import { toResponse } from "@appthrust/app-access";
import { appAccess, appAccessEnabled } from "@/lib/app-access";

const noStore = { "Cache-Control": "no-store" };

// Returns what the signed-in user may do in this app. Absent (404) until app
// roles are enabled; see "App roles" in README.md.
export async function GET(request: Request) {
  if (!appAccessEnabled()) {
    return Response.json({ error: "not_found" }, { status: 404, headers: noStore });
  }

  try {
    const access = await appAccess().getAppAccess(request);
    return Response.json(
      {
        subject: access.subject,
        permissions: [...access.permissions].sort(),
        roles: access.roles,
        expiresAt: access.expiresAt,
      },
      { headers: noStore },
    );
  } catch (error) {
    return toResponse(error);
  }
}
