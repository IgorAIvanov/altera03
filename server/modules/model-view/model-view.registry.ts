import { fromFileUrl, join, relative, dirname } from "@std/path";
import type { ViewEntry, ViewManifest, ViteManifest } from "./model-view.types.ts";

const APP_DIR = fromFileUrl(new URL("../../../app/", import.meta.url));
const DIST_MANIFEST = fromFileUrl(new URL("../../../dist/.vite/manifest.json", import.meta.url));

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const raw = await Deno.readTextFile(path);
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function scanManifests(): Promise<Array<{ route: string; moduleFile: string; titleKey?: string }>> {
  const results: Array<{ route: string; moduleFile: string; titleKey?: string }> = [];

  async function walk(dir: string) {
    for await (const entry of Deno.readDir(dir)) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory) {
        await walk(fullPath);
      } else if (entry.name === "manifest.json") {
        const manifest = await readJson<ViewManifest>(fullPath);
        if (!manifest?.views) continue;

        const modelDir = dirname(fullPath);
        const routeBase = relative(APP_DIR, modelDir).replaceAll("\\", "/");

        for (const [viewName, view] of Object.entries(manifest.views)) {
          // нормализуем путь: ./supplierInvoiceCardPage.ts → app/operation/.../supplierInvoiceCardPage.ts
          const moduleFile = join(modelDir, view.module)
            .replace(/\\/g, "/")
            .replace(/\.tsx?$/, ".ts");

          results.push({
            route: `${routeBase}/${viewName}`,
            moduleFile: relative(fromFileUrl(new URL("../../../", import.meta.url)), moduleFile)
              .replaceAll("\\", "/"),
            titleKey: view.titleKey,
          });
        }
      }
    }
  }

  await walk(APP_DIR);
  return results;
}

async function buildDevRegistry(
  entries: Array<{ route: string; moduleFile: string; titleKey?: string }>,
  viteDevUrl: string,
): Promise<Map<string, ViewEntry>> {
  const registry = new Map<string, ViewEntry>();
  const projectRoot = fromFileUrl(new URL("../../../", import.meta.url))
    .replaceAll("\\", "/").replace(/\/$/, "");

  for (const entry of entries) {
    // /@fs/ позволяет Vite отдавать файлы вне своего root
    const absPath = `${projectRoot}/${entry.moduleFile}`;
    registry.set(entry.route, {
      route: entry.route,
      chunkUrl: `${viteDevUrl}/@fs/${absPath}`,
      titleKey: entry.titleKey,
    });
  }

  return registry;
}

async function buildProdRegistry(
  entries: Array<{ route: string; moduleFile: string; titleKey?: string }>,
): Promise<Map<string, ViewEntry>> {
  const registry = new Map<string, ViewEntry>();
  const viteManifest = await readJson<ViteManifest>(DIST_MANIFEST);

  if (!viteManifest) {
    console.warn("[model-view] dist/.vite/manifest.json не знайдено, view routing недоступний");
    return registry;
  }

  for (const entry of entries) {
    const viteEntry = viteManifest[entry.moduleFile];

    if (!viteEntry) {
      console.warn(`[model-view] чанк для ${entry.moduleFile} не знайдено в manifest.json`);
      continue;
    }

    registry.set(entry.route, {
      route: entry.route,
      chunkUrl: `/${viteEntry.file}`,
      titleKey: entry.titleKey,
    });
  }

  return registry;
}

export async function buildViewRegistry(): Promise<Map<string, ViewEntry>> {
  const entries = await scanManifests();
  const viteDevUrl = Deno.env.get("VITE_DEV_URL");
  const isDev = !!viteDevUrl;

  const registry = isDev
    ? await buildDevRegistry(entries, viteDevUrl!)
    : await buildProdRegistry(entries);

  console.log(`[model-view] режим: ${isDev ? "dev" : "prod"}, маршрутів: ${registry.size}`);

  return registry;
}
