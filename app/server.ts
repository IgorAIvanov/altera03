/// <reference lib="deno.ns" />
// Composition root сервера: тут (і тільки тут) застосунок зустрічається з фреймворком.
// Завантажуємо згенеровані дані з app/_generated і реєструємо їх у server-runtime ДО
// bootstrap() — після цього сам server/ нічого не знає про конкретний застосунок.
import { fromFileUrl } from "jsr:@std/path@^1.1.2";
import { serveDir } from "jsr:@std/http@^1.0.18/file-server";

import { bootstrap, configFromEnv, type VersionInfo } from "@altera/server";

import { generatedModelRegistry } from "./_generated/model-registry.generated.ts";
import { generatedTsCommandBindings } from "./_generated/ts-commands.generated.ts";
import { agentModelRoutes } from "./_generated/agent-routes.generated.ts";
import { agentToolSchemas } from "./_generated/agent-tools.generated.ts";
import { viewManifest } from "./_generated/view-manifest.generated.ts";
import { devAuthMethods } from "./login/dev-redirect-auth.method.ts";

// Корінь репо — батьківський каталог app/.
const projectRoot = fromFileUrl(new URL("../", import.meta.url)).replace(/\/$/, "");

// Тут само збирає Vite (root: "app", outDir: "../dist").
const frontendDistDir = `${projectRoot}/dist/`;
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


/**
 * Збирає застосунок і віддає його обробником, нікуди не слухаючи.
 *
 * Порт з'являється тільки в `import.meta.main` нижче — завдяки цьому той самий
 * застосунок можна ганяти в процесі (`deno task smoke`, `deno task api`) без
 * вільного порту, очікування готовності й HTTP-клієнта.
 */
export async function createServer(): Promise<AppServer> {
  // Уся конфігурація сервера — один аргумент. Значення з оточення бібліотека
  // сама не читає: беремо їх явно через configFromEnv() і за потреби перекриваємо.
  //
  // `auth.methods` — місце для зовнішніх провайдерів входу. Фреймворк їх не
  // постачає: він дає контракт (`AuthDirectMethod` / `AuthRedirectMethod`) і
  // веде redirect-потік, а хто саме підтверджує особу — вибір застосунку:
  //   auth: { ...env.auth, methods: [new GoogleAuthMethod(...)] }
  // Зараз тут лише dev-заглушка, і лише коли її увімкнено явно.
  const env = configFromEnv();
  const application = await bootstrap({
    ...env,
    version: await solutionVersion(),
    auth: { ...env.auth, methods: devAuthMethods() },
    models: {
      registry: generatedModelRegistry,
      tsCommands: generatedTsCommandBindings,
    },
    agentRoutes: agentModelRoutes,
    agentTools: agentToolSchemas,
    views: {
      manifest: viewManifest,
      projectRoot,
      // Root Vite (vite.config.ts). Ключі в dist/.vite/manifest.json рахуються
      // від нього, а шляхи в маніфесті в'ю — від кореня репозиторію.
      appDir: "app",
      // Vite віддає вихідні модулі — беремо їх через /@fs замість зібраних чанків.
      dev: !!Deno.env.get("VITE_DEV_URL"),
    },
  });
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
  const viteDevUrl = Deno.env.get("VITE_DEV_URL");
  const { handler } = await createServer();
  Deno.serve({ port }, handler);
  console.log(`🚀 Altera server running on http://localhost:${port}`);

  // З VITE_DEV_URL в'ю віддає Vite (`/@fs/`-посилання на вихідні модулі), а цей
  // порт їх не обслуговує — сторінка підніметься, але жодна вкладка не
  // відкриється. Інтерфейс у цьому режимі відкривають за адресою Vite; сюди
  // ходить лише /api, куди Vite і проксює.
  if (viteDevUrl) {
    console.log(`   в'ю — з Vite: інтерфейс відкривай на ${viteDevUrl}, тут живе тільки /api`);
  }
}
