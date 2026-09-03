/// <reference lib="deno.ns" />
// Composition root бекенду: тут (і тільки тут) застосунок зустрічається з
// фреймворком. Бібліотека нічого не шукає сама — усе приходить одним
// типізованим аргументом bootstrap().
import { fromFileUrl } from "jsr:@std/path@^1.1.2";
import { serveDir } from "jsr:@std/http@^1.0.18/file-server";

import { bootstrap, configFromEnv, mergeMessageDictionaries, type VersionInfo } from "@altera/server";
import { CLIENT_LOCALES } from "@client/locales.ts";

// Тексти повідомлень для каналу зовнішнього агента. Обидва словники є тільки
// тут: рядки ядра везе `@altera/client`, рядки моделей збирає
// `deno task locales:build`. Додав мову — додай її сюди рядком.
import appLocaleUk from "./_locales/uk.json" with { type: "json" };
import appLocaleEn from "./_locales/en.json" with { type: "json" };

import { generatedModelRegistry } from "./_generated/model-registry.generated.ts";
import { generatedTsCommandBindings } from "./_generated/ts-commands.generated.ts";
import { agentModelRoutes } from "./_generated/agent-routes.generated.ts";
import { agentToolSchemas } from "./_generated/agent-tools.generated.ts";
import { agentModelRules } from "./_generated/agent-rules.generated.ts";
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

/**
 * Як звуть цю установку — назва рішення й пін фреймворку.
 *
 * Читається з двох джерел, бо установки бувають двох родів. Пакетна поставка
 * лишає манифест `app/.solution.json` — там і назва, і піни, під якими рішення
 * зібране. Розгортання з репозиторію (git push на платформу) манифеста не має
 * зовсім, тож пін беремо з карти імпортів кореня — це те саме, чим застосунок і
 * запущений.
 *
 * Помилка тут не має ламати старт: без версії зауваження просто небагатослівне,
 * а без сервера немає нічого.
 */
async function solutionVersion(): Promise<VersionInfo> {
  const pin = (value: unknown): string | undefined => {
    const text = typeof value === "string" ? value : "";
    return text.match(/@altera\/server@(.+?)\/?$/)?.[1];
  };

  try {
    const raw = await Deno.readTextFile(new URL("./.solution.json", import.meta.url));
    const m = JSON.parse(raw) as {
      name?: string;
      version?: string;
      installedFramework?: Record<string, string>;
      framework?: Record<string, string>;
    };
    const fw = m.installedFramework?.["@altera/server"] ?? m.framework?.["@altera/server"];
    return {
      solution: m.name && m.version ? `${m.name} ${m.version}` : m.name,
      framework: pin(fw),
    };
  } catch {
    // Манифеста немає — це не помилка, а інший рід установки.
  }

  try {
    const raw = await Deno.readTextFile(new URL("../deno.json", import.meta.url));
    const cfg = JSON.parse(raw) as { name?: string; version?: string; imports?: Record<string, string> };
    return {
      solution: cfg.name && cfg.version ? `${cfg.name} ${cfg.version}` : cfg.name,
      framework: pin(cfg.imports?.["@altera/server"] ?? cfg.imports?.["@altera/server/"]),
    };
  } catch {
    return {};
  }
}


export async function createServer() {
  const application = await bootstrap({
    ...configFromEnv(),
    version: await solutionVersion(),
    models: { registry: generatedModelRegistry, tsCommands: generatedTsCommandBindings },
    agentRoutes: agentModelRoutes,
    agentTools: agentToolSchemas,
    agentRules: agentModelRules,
    // Маркер `@[ключ]` розгортає клієнт — але в каналі зовнішнього агента
    // клієнта немає, і там замість речення їхало б внутрішнє ім'я ключа.
    messages: {
      dictionaries: mergeMessageDictionaries(CLIENT_LOCALES, { uk: appLocaleUk, en: appLocaleEn }),
    },
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
