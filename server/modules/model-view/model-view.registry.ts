import type { ViewEntry, ViteManifest } from "./model-view.types.ts";
import { getServerConfig } from "../../config/server-config.ts";

/** Запис view-маніфесту: маршрут → файл модуля (відносно кореня репо) → titleKey. */
export interface ViewManifestEntry {
  route: string;
  moduleFile: string;
  titleKey?: string;
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await Deno.readTextFile(path)) as T;
  } catch {
    return null;
  }
}

function buildDevRegistry(entries: ViewManifestEntry[], projectRoot: string): Map<string, ViewEntry> {
  const registry = new Map<string, ViewEntry>();
  for (const entry of entries) {
    // chunkUrl навмисно origin-relative (без хоста): динамічний import у браузері
    // резолвить його відносно origin сторінки. Інакше localhost vs 127.0.0.1
    // дублюють модулі (два bus → "немає обробника", дві копії lit).
    const absPath = `${projectRoot}/${entry.moduleFile}`;
    registry.set(entry.route, {
      route: entry.route,
      chunkUrl: `/@fs/${absPath}`,
      titleKey: entry.titleKey,
    });
  }
  return registry;
}

async function buildProdRegistry(
  entries: ViewManifestEntry[],
  projectRoot: string,
): Promise<Map<string, ViewEntry>> {
  const registry = new Map<string, ViewEntry>();
  const viteManifest = await readJson<ViteManifest>(`${projectRoot}/dist/.vite/manifest.json`);

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
  const { manifest, projectRoot, dev } = getServerConfig().views;
  const registry = dev
    ? buildDevRegistry(manifest, projectRoot)
    : await buildProdRegistry(manifest, projectRoot);

  console.log(`[model-view] режим: ${dev ? "dev" : "prod"}, маршрутів: ${registry.size}`);
  return registry;
}
