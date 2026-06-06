import { readdir, readFile } from "node:fs/promises";
import { join, relative, dirname, resolve } from "node:path";
import type { Plugin } from "npm:vite@^6.3.5";

interface ManifestView {
  module: string;
  titleKey?: string;
}

interface AppManifest {
  model: string;
  views?: Record<string, ManifestView>;
}

async function scanManifests(
  appDir: string
): Promise<Record<string, string>> {
  const input: Record<string, string> = {};

  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name === "manifest.json") {
        const raw = await readFile(fullPath, "utf-8");
        const manifest: AppManifest = JSON.parse(raw);

        if (!manifest.views) continue;

        // маршрут из пути к манифесту относительно app/
        // app/operation/supplier_invoice/manifest.json → operation/supplier_invoice
        const modelDir = dirname(fullPath);
        const routeBase = relative(appDir, modelDir).replaceAll("\\", "/");

        for (const [viewName, view] of Object.entries(manifest.views)) {
          // operation/supplier_invoice/edit
          const routeKey = `${routeBase}/${viewName}`;

          // абсолютный путь к .ts файлу
          const modulePath = resolve(modelDir, view.module);

          input[routeKey] = modulePath;
        }
      }
    }
  }

  await walk(appDir);
  return input;
}

export function appModulesPlugin(): Plugin {
  const appDir = resolve("app");

  return {
    name: "vite-plugin-app-modules",

    async config(config) {
      const moduleInputs = await scanManifests(appDir);

      const count = Object.keys(moduleInputs).length;
      if (count > 0) {
        console.log(`[app-modules] найдено ${count} view(s):`);
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
