import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";

export const root = new URL("../../", import.meta.url);
// Resolve the app's Next/TypeScript imports only inside this Node test process.
export const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (["next/headers", "next/cache", "next/server"].includes(specifier)) {
      return nextResolve(`${specifier}.js`, context);
    }
    if (specifier.startsWith("@/") || specifier.startsWith(".")) {
      const url = new URL(specifier.startsWith("@/") ? specifier.slice(2) : specifier,
        specifier.startsWith("@/") ? root : context.parentURL);
      for (const suffix of [".ts", ".tsx"]) {
        if (existsSync(new URL(`${url.href}${suffix}`))) return nextResolve(`${url.href}${suffix}`, context);
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(root.href) && url.endsWith(".tsx")) {
      return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
      }).outputText };
    }
    return nextLoad(url, context);
  },
});
