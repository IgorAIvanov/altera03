/// <reference lib="deno.ns" />
// Composition root сервера: тут (і тільки тут) застосунок зустрічається з фреймворком.
// Завантажуємо згенеровані дані з app/_generated і реєструємо їх у server-runtime ДО
// bootstrap() — після цього сам server/ нічого не знає про конкретний застосунок.
import { fromFileUrl } from "jsr:@std/path@^1.1.2";
import { serveDir } from "jsr:@std/http@^1.0.18/file-server";

import { bootstrap } from "../server/bootstrap.ts";
import { registerModelRegistry } from "../server/modules/model-runtime/model-registry.ts";
import { registerAgentRoutes } from "../server/modules/agent/agent-routes.ts";
import { registerViewManifest } from "../server/modules/model-view/model-view.registry.ts";

import { generatedModelRegistry, generatedTsCommandBindings } from "./_generated/model-registry.generated.ts";
import { agentModelRoutes } from "./_generated/agent-routes.generated.ts";
import { viewManifest } from "./_generated/view-manifest.generated.ts";

// Корінь репо — батьківський каталог app/.
const projectRoot = fromFileUrl(new URL("../", import.meta.url)).replace(/\/$/, "");

registerModelRegistry(generatedModelRegistry, generatedTsCommandBindings);
registerAgentRoutes(agentModelRoutes);
registerViewManifest(viewManifest, projectRoot);

const frontendDistDir = `${projectRoot}/frontend/dist/`;
const frontendIndexFile = `${frontendDistDir}index.html`;

async function pathExists(path: string) {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function createHandler() {
  const application = await bootstrap();
  const danetInternalApp = (application as unknown as { app: { fetch: (request: Request) => Promise<Response> } }).app;
  const apiHandler = danetInternalApp.fetch.bind(danetInternalApp);
  const hasFrontendDist = await pathExists(frontendDistDir);

  return async (request: Request) => {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (!pathname.startsWith("/api")) {
      if (hasFrontendDist) {
        const staticResponse = await serveDir(request, { fsRoot: frontendDistDir, quiet: true });
        if (staticResponse.status !== 404) {
          return staticResponse;
        }

        const lastSegment = pathname.split("/").pop() ?? "";
        const looksLikeAsset = lastSegment.includes(".");
        if (request.method === "GET" && !looksLikeAsset) {
          const body = await Deno.readFile(frontendIndexFile);
          return new Response(body, {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
      }
    }

    return await apiHandler(request);
  };
}

const port = Number(Deno.env.get("PORT") || 3000);
const handler = await createHandler();
Deno.serve({ port }, handler);
console.log(`🚀 Altera server running on http://localhost:${port}`);
