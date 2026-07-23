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

/** Обробник запиту — те саме, що бачить `Deno.serve`. */
export type AppHandler = (request: Request) => Promise<Response>;

/** Піднятий застосунок без прив'язки до порту: обробник + коректне згортання. */
export interface AppServer {
  handler: AppHandler;
  /** Виконує APP_CLOSE-хуки (зокрема закриває пул БД). */
  close(): Promise<void>;
}

/**
 * Збирає застосунок і віддає його обробником, нікуди не слухаючи.
 *
 * Порт з'являється тільки в `import.meta.main` нижче — завдяки цьому той самий
 * застосунок можна ганяти в процесі (`deno task smoke`, `deno task api`) без
 * вільного порту, очікування готовності й HTTP-клієнта.
 */
export async function createServer(): Promise<AppServer> {
  const application = await bootstrap();
  // `router` — публічний геттер Danet на внутрішній Hono-застосунок.
  const hono = application.router;
  const apiHandler = hono.fetch.bind(hono);
  const hasFrontendDist = await pathExists(frontendDistDir);

  const handler: AppHandler = async (request: Request) => {
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

  return {
    handler,
    close: () => application.close(),
  };
}

if (import.meta.main) {
  const port = Number(Deno.env.get("PORT") || 3000);
  const { handler } = await createServer();
  Deno.serve({ port }, handler);
  console.log(`🚀 Altera server running on http://localhost:${port}`);
}
