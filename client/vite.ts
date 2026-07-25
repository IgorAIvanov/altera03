// Пресет Vite для застосунків на цьому фреймворку — те, що в кожному застосунку
// має бути однаковим і оновлюватися разом із бібліотекою, а не копіюватися.
//
//   import { defineAlteraConfig } from "@ihor/altera-client/vite";
//   export default defineAlteraConfig({ appDir: "app", apiPort: 3000 });
//
// Каталог фреймворку пресет знаходить від власного розташування (`import.meta`),
// тому працює однаково і в монорепо (файл лежить у `client/`), і у встановленому
// пакеті (`node_modules/@ihor/altera-client/`). Аліаси Vite сюди не дістають —
// конфіг вантажиться до того, як вони визначені, — тож шлях беремо з ФС.
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, readFile } from "node:fs/promises";
import { defineConfig, type Plugin, type UserConfig } from "npm:vite@^6.3.5";
import { viteStaticCopy } from "npm:vite-plugin-static-copy@^2.3.0";
import tailwindcss from "npm:@tailwindcss/vite@^4.3.0";

/** Каталог самого фреймворку (`client/`). Стабільний і в монорепо, і в пакеті. */
const FRAMEWORK_DIR = (import.meta as { dirname?: string }).dirname ??
  dirname(fileURLToPath(import.meta.url));

const toPosix = (path: string) => path.replaceAll("\\", "/");

export interface AlteraConfigOptions {
  /** Каталог застосунку (де `index.html`, `main.ts`, моделі). Відносно cwd. */
  appDir: string;
  /** Порт бекенду, куди Vite проксює `/api` у dev. Дефолт — 3000. */
  apiPort?: number;
}

// ── Плагін view-модулів ─────────────────────────────────────────────────────
// Сканує застосунок на manifest.json і додає кожну в'ю окремим build-входом, щоб
// вона стала власним чанком (динамічний імпорт у рантаймі). Був окремим файлом у
// корені репо; переїхав сюди як частина машинерії фреймворку, параметризований
// каталогом застосунку — знання про конкретний застосунок у ньому не лишилося.

interface ManifestView {
  module: string;
  titleKey?: string;
}

interface AppManifest {
  model: string;
  views?: Record<string, ManifestView>;
}

async function scanManifests(appRoot: string): Promise<Record<string, string>> {
  const input: Record<string, string> = {};

  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name === "manifest.json") {
        const manifest: AppManifest = JSON.parse(await readFile(fullPath, "utf-8"));
        if (!manifest.views) continue;

        // Маршрут — шлях до манифесту відносно кореня застосунку:
        // app/operation/supplier_invoice/manifest.json → operation/supplier_invoice
        const modelDir = dirname(fullPath);
        const routeBase = toPosix(relative(appRoot, modelDir));

        for (const [viewName, view] of Object.entries(manifest.views)) {
          input[`${routeBase}/${viewName}`] = resolve(modelDir, view.module);
        }
      }
    }
  }

  await walk(appRoot);
  return input;
}

function appModulesPlugin(appRoot: string): Plugin {
  return {
    name: "vite-plugin-app-modules",

    async config(config) {
      const moduleInputs = await scanManifests(appRoot);

      const count = Object.keys(moduleInputs).length;
      if (count > 0) {
        console.log(`[app-modules] знайдено ${count} view(s):`);
        for (const [route, file] of Object.entries(moduleInputs)) {
          console.log(`  ${route} → ${relative(process.cwd(), file)}`);
        }
      }

      return {
        build: {
          rollupOptions: {
            input: {
              ...((config.build?.rollupOptions?.input as Record<string, string>) ?? {}),
              ...moduleInputs,
            },
          },
        },
      };
    },
  };
}

// ── Пресет ───────────────────────────────────────────────────────────────────

export function defineAlteraConfig(options: AlteraConfigOptions): UserConfig {
  const { appDir, apiPort = 3000 } = options;
  const appRoot = resolve(appDir);

  return defineConfig({
    // Корінь — застосунок: index.html і main.ts належать йому, а не бібліотеці.
    root: appDir,
    publicDir: false,
    build: {
      outDir: resolve("dist"),
      emptyOutDir: true,
      manifest: true,
      // top-level await у точці входу (setLocale, динамічний preload) потребує
      // es2022; інакше rollup-мініфікація падає з дефолтним es2020-таргетом.
      target: "es2022",
      rollupOptions: {
        input: {
          client: `${toPosix(appDir)}/index.html`,
        },
        output: {
          // shell-registry — в окремий чанк примусово. Інакше Rollup складає його
          // в entry-чанк (його статично тягне main.ts застосунку), а
          // `tab-controller`, який main.ts підвантажує динамічно, імпортує звідти
          // `shellTags` — і виникає цикл entry → import(tab-controller) → entry.
          // Разом із верхньорівневим await у main.ts це давало дедлок (біла
          // сторінка за живої сесії). Винесення модуля в лист прибирає й саму
          // можливість циклу.
          manualChunks(id) {
            if (id.includes("/client/shell/shell-registry")) return "shell-registry";
          },
        },
      },
    },
    server: {
      port: 5173,
      fs: {
        // Vite віддає вихідні модулі застосунку через /@fs; дозволяємо і корінь
        // застосунку, і каталог фреймворку (у пакеті це node_modules).
        allow: [process.cwd(), appRoot, FRAMEWORK_DIR],
      },
      proxy: {
        // 127.0.0.1, а НЕ localhost. Бекенд слухає IPv4 (`Deno.serve` за
        // замовчуванням `0.0.0.0`), а `localhost` на Windows резолвиться спершу в
        // IPv6 `::1` — там нікого немає. Кожен проксьований запит робив приречену
        // спробу по IPv6 і лише потім падав на IPv4: подвійна витрата сокетів, а
        // коли їх забракне — падіння з `AggregateError` у
        // `_internalConnectMultiple` замість зрозумілої помилки.
        "/api": {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
    esbuild: {
      target: "es2022",
    },
    // Явна entry для dep-сканера: інакше оптимізатор бере build.rollupOptions.input
    // і не може його зрезолвити відносно root, що валить холодний старт (masked
    // TypeError у Vite).
    //
    // include: view-модулі застосунку вантажаться динамічно (@vite-ignore /@fs),
    // тож їх залежності (@lit-labs/signals, @sinclair/typebox) не потрапляють у
    // стартовий scan і виявляються пізно → Vite дооптимізовує й робить full-reload,
    // а до перезавантаження виникає другий екземпляр Lit ("Multiple versions of
    // Lit") і роздвоєний граф (другий bus → "немає обробника для data.load").
    // Пре-бандлимо весь набір залежностей одразу, щоб не було пізнього re-optimize.
    optimizeDeps: {
      entries: ["index.html"],
      include: [
        "lit",
        "lit/decorators.js",
        "@lit-labs/signals",
        "@sinclair/typebox",
        "@sinclair/typebox/value",
        "signal-utils/deep",
        "signal-polyfill",
      ],
    },
    resolve: {
      alias: {
        "@app": appRoot,
        "@client": FRAMEWORK_DIR,
        "@shared": resolve(appRoot, "shared"),
      },
    },
    plugins: [
      tailwindcss(),
      appModulesPlugin(appRoot),
      viteStaticCopy({
        targets: [
          {
            src: toPosix(resolve(appRoot, "_public")) + "/*",
            dest: ".",
          },
          {
            src: toPosix(join(FRAMEWORK_DIR, "_locales")) + "/*",
            dest: "locales/client",
          },
          {
            src: toPosix(resolve(appRoot, "_locales")) + "/*",
            dest: "locales/app",
          },
        ],
      }),
    ],
  });
}
