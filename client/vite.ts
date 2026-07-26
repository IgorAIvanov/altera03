// Пресет Vite для застосунків на цьому фреймворку — те, що в кожному застосунку
// має бути однаковим і оновлюватися разом із бібліотекою, а не копіюватися.
//
//   import { defineAlteraConfig } from "@altera/client/vite";
//   export default defineAlteraConfig({ appDir: "app", apiPort: 3000 });
//
// Каталог фреймворку пресет знаходить сам — і в монорепо, і у встановленому
// застосунку. Він потрібен трьом речам, і всім трьом — як СПРАВЖНІЙ каталог на
// диску: аліасу `@client` (через нього Tailwind тягне `styles/theme.css`),
// копіюванню `_locales` і `server.fs.allow`. Аліаси Vite сюди не дістають:
// конфіг вантажиться до того, як вони визначені.
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { defineConfig, type Plugin, type UserConfig } from "npm:vite@^6.3.5";
import { viteStaticCopy } from "npm:vite-plugin-static-copy@^2.3.0";
import tailwindcss from "npm:@tailwindcss/vite@^4.3.0";
import deno from "npm:@deno/vite-plugin@^1";

/**
 * Каталог самого фреймворку (`client/`).
 *
 * Два розклади, і другий не такий, як очікувалося спершу:
 *
 * - **монорепо** — модуль має `file:`-URL, тож просто його каталог;
 * - **встановлений застосунок** — модуль виконується з `https://jsr.io/...`
 *   **навіть при `"vendor": true`**. Вендоринг міняє джерело байтів, а не
 *   ідентичність модуля, тому `import.meta.dirname` тут `undefined`, а
 *   `fileURLToPath(import.meta.url)` кидає «The URL must be of scheme file».
 *   Версія при цьому є в самому URL, тож каталог рахуємо з нього:
 *   `vendor/jsr.io/@altera/client/<версія>`.
 *
 * Кеш DENO_DIR не годиться принципово: там не дерево, а плаский список файлів
 * з іменами-хешами й без розширень. Тому `"vendor": true` у застосунку —
 * не побажання, а вимога; якщо каталогу немає, кажемо про це прямо, бо інакше
 * зламається не тут, а пізніше й тихо (зникнуть стилі фреймворку).
 */
function resolveFrameworkDir(): string {
  const url = import.meta.url;

  if (url.startsWith("file:")) {
    return (import.meta as { dirname?: string }).dirname ?? dirname(fileURLToPath(url));
  }

  // https://jsr.io/@altera/client/0.3.2/vite.ts → ["@altera","client","0.3.2",...]
  const [scope, name, version] = new URL(url).pathname.split("/").filter(Boolean);
  const vendored = resolve(process.cwd(), "vendor", "jsr.io", scope, name, version);

  if (!existsSync(vendored)) {
    throw new Error(
      `Не знайдено каталог фреймворку ${vendored}.\n` +
        `Пресет Vite потребує вихідників на диску (аліас @client, тема Tailwind, локалі),\n` +
        `а кеш JSR — це файли з іменами-хешами. Додай у deno.json застосунку\n` +
        `"vendor": true і виконай \`deno install\` ПЕРЕД збіркою.`,
    );
  }

  return vendored;
}

const FRAMEWORK_DIR = resolveFrameworkDir();

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
      // Масив, а не об'єкт: потрібен запис із RegExp (див. нижче).
      alias: [
        // `deno publish` запікає в опублікований код ПОВНІ специфікатори
        // (`npm:@sinclair/typebox@^0.34.0` замість голого імені). Rollup таких
        // не розуміє, а `@deno/vite-plugin` резолвить не всі: `npm:lit@^3.3.1`
        // проходить, а typebox падає з `Could not load … ENOENT` — заважає
        // подвійний cjs/esm-`exports`. Аліас повертає специфікатор до голого
        // імені, яке резолвиться з node_modules штатно.
        //
        // У монорепо це правило не спрацьовує жодного разу (застосунок пише
        // голі імена), тож ціни тут немає — воно потрібне саме встановленому
        // застосунку, який тягне фреймворк із jsr.
        { find: /^npm:\/?(@?[^@]+)@[^/]*(\/.*)?$/, replacement: "$1$2" },
        { find: "@app", replacement: appRoot },
        { find: "@client", replacement: FRAMEWORK_DIR },
        { find: "@shared", replacement: resolve(appRoot, "shared") },
      ],
    },
    plugins: [
      // Vite сам не резолвить ані `jsr:`, ані карту імпортів Deno: без цього
      // плагіна встановлений застосунок падає на першому ж імпорті фреймворку
      // (`Rollup failed to resolve import "@altera/client/..."`). У монорепо
      // фреймворк приходить аліасом `@client`, тому там плагін не потрібен —
      // але він і не заважає, а пресет має працювати в обох розкладках.
      deno(),
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
