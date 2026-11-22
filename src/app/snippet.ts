export const SNIPPET = `// src/instrumentation.ts
import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError =
  async (err, request, context) => {
    const e = err instanceof Error ? err : new Error(String(err));
    await fetch(\`\${process.env.AUTOSANA_URL}/api/incidents\`, {
      method: "POST",
      headers: {
        authorization: \`Bearer \${process.env.AUTOSANA_KEY}\`,
      },
      body: JSON.stringify({
        name: e.name, message: e.message, stack: e.stack,
        request: { path: request.path, method: request.method },
        route: { path: context.routePath, type: context.routeType },
        commit: process.env.VERCEL_GIT_COMMIT_SHA,
      }),
    });
  };`;
