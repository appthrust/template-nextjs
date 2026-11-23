// Exact GET/HEAD exceptions only. Add a reason beside every public path.
export const publicReadPaths: Readonly<Record<string, true>> = {
  "/healthz": true, // Constant health probe, independent of identity and the database.
  "/favicon.ico": true, // Public site icon, contains no user data.
  "/_next/image": true, // Next's image optimizer; serve only public images through it.
};

export function isPublicRead(pathname: string, method: string): boolean {
  return (method === "GET" || method === "HEAD") && (
    Object.hasOwn(publicReadPaths, pathname) ||
    pathname.startsWith("/_next/static/") // Next-generated public JS/CSS assets.
  );
}
