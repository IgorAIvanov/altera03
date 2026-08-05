/// <reference lib="deno.ns" />
// Composition root бекенду: тут (і тільки тут) застосунок зустрічається з
// фреймворком. Бібліотека нічого не шукає сама — усе приходить одним
// типізованим аргументом bootstrap().
import { fromFileUrl } from "jsr:@std/path@^1.1.2";
import { serveDir } from "jsr:@std/http@^1.0.18/file-server";

import { bootstrap, configFromEnv } from "@altera/server";

import { generatedModelRegistry } from "./_generated/model-registry.generated.ts";
import { generatedTsCommandBindings } from "./_generated/ts-commands.generated.ts";
import { agentModelRoutes } from "./_generated/agent-routes.generated.ts";
import { viewManifest } from "./_generated/view-manifest.generated.ts";

// Корінь проєкту — батьківський каталог app/.
const projectRoot = fromFileUrl(new URL("../", import.meta.url)).replace(/\/$/, "");
// Сюди збирає Vite (root: "app", outDir: "../dist").
const frontendDistDir = `${projectRoot}/dist/`;
const frontendIndexFile = `${frontendDistDir}index.html`;

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function createServer() {
  const application = await bootstrap({
    ...configFromEnv(),
    models: { registry: generatedModelRegistry, tsCommands: generatedTsCommandBindings },
    agentRoutes: agentModelRoutes,
    views: {
      manifest: viewManifest,
      projectRoot,
      // Root Vite: ключі в dist/.vite/manifest.json рахуються від нього, а
      // шляхи в маніфесті в'ю — від кореня проєкту.
      appDir: "app",
      // З VITE_DEV_URL в'ю віддає Vite (вихідні модулі через /@fs).
      dev: !!Deno.env.get("VITE_DEV_URL"),
    },
  });

  const hono = application.router;
  const apiHandler = hono.fetch.bind(hono);
  const hasFrontendDist = await pathExists(frontendDistDir);

  const handler = async (request: Request): Promise<Response> => {
    const pathname = new URL(request.url).pathname;

    if (!pathname.startsWith("/api") && hasFrontendDist) {
      const staticResponse = await serveDir(request, { fsRoot: frontendDistDir, quiet: true });
      if (staticResponse.status !== 404) return staticResponse;

      // SPA-фолбек: усе, що не схоже на файл, віддаємо index.html.
      const looksLikeAsset = (pathname.split("/").pop() ?? "").includes(".");
      if (request.method === "GET" && !looksLikeAsset) {
        return new Response(await Deno.readFile(frontendIndexFile), {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
    }

    return await apiHandler(request);
  };

  return { handler, close: () => application.close() };
}

if (import.meta.main) {
  const port = Number(Deno.env.get("PORT") || 3000);
  const viteDevUrl = Deno.env.get("VITE_DEV_URL");
  const { handler } = await createServer();
  Deno.serve({ port }, handler);
  console.log(`🚀 {{name}} на http://localhost:${port}`);
  if (viteDevUrl) {
    console.log(`   в'ю — з Vite: інтерфейс відкривай на ${viteDevUrl}, тут живе тільки /api`);
  }
}
