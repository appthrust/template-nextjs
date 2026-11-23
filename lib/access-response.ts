import { Forbidden, Unauthenticated, Unavailable } from "@appthrust/app-access";

/** Render only fixed public copy, never exception messages or identity details. */
export function accessErrorResponse(error: unknown): Response {
  let status: number;
  let japanese: string;
  let english: string;
  if (error instanceof Unauthenticated) {
    status = 401;
    japanese = "サインインが必要です。グループ共有・非公開では、現在アプリに利用者の情報が届かないため、まだ利用できません。";
    english = "Sign-in required. On group/private publishes the app cannot see who you are yet, so it is not available yet.";
  } else if (error instanceof Forbidden) {
    status = 403;
    japanese = "このアプリを利用する権限がありません。アプリの管理者にお問い合わせください。";
    english = "You do not have permission to use this app. Contact the app administrator.";
  } else if (error instanceof Unavailable) {
    status = 503;
    japanese = "現在、利用者と権限を確認できません。管理者はプラットフォーム接続の設定を確認してください。しばらくしてから再度お試しください。";
    english = "App access is unavailable. An administrator should check the platform connection. Please try again later.";
  } else {
    throw error;
  }

  return new Response(
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${status} — App access</title></head><body><main><h1>${status}</h1><p>${japanese}</p><p lang="en">${english}</p></main></body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        ...(status === 503 ? { "x-appthrust-access": "unavailable" } : {}),
      },
    },
  );
}
