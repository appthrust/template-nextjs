import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/app-access";
import { accessErrorResponse } from "@/lib/access-response";
import { isPublicRead } from "@/lib/public-routes";

export async function proxy(request: NextRequest) {
  if (isPublicRead(request.nextUrl.pathname, request.method)) {
    return NextResponse.next();
  }
  try {
    await requireUser();
    return NextResponse.next();
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export const config = { matcher: "/:path*" };
