"use server";

import { revalidatePath } from "next/cache";
import { insertDemoMessage } from "@/lib/db";
import { requireUser } from "@/lib/app-access";

export async function createMessage(formData: FormData) {
  const user = await requireUser();
  const body = String(formData.get("body") ?? "").trim();
  if (!body) {
    return;
  }

  await insertDemoMessage(body, user.principal, user.displayName ?? null);
  revalidatePath("/");
}
