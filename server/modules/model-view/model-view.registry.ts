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

/**
 * Ключ у `dist/.vite/manifest.json` — шлях відносно КОРЕНЯ VITE, а маніфест в'ю
 * рахує шляхи від кореня репозиторію. Поки root Vite був самим репозиторієм, це
 * збігалося; після переїзду `index.html` у `app/` — ні, і prod-режим тихо
 * лишався з нулем маршрутів (dev не постраждав, бо він будує `/@fs/` від
 * `projectRoot`, і саме тому нікого це не турбувало).
 */
function toViteKey(moduleFile: string, appDir: string): string {
  const prefix = appDir ? `${appDir.replace(/^\/+|\/+$/g, "")}/` : "";
  return prefix && moduleFile.startsWith(prefix) ? moduleFile.slice(prefix.length) : moduleFile;
}

async function buildProdRegistry(
  entries: ViewManifestEntry[],
  projectRoot: string,
  appDir: string,
): Promise<Map<string, ViewEntry>> {
  const registry = new Map<string, ViewEntry>();
  const viteManifest = await readJson<ViteManifest>(`${projectRoot}/dist/.vite/manifest.json`);

  if (!viteManifest) {
    console.warn("[model-view] dist/.vite/manifest.json не знайдено, view routing недоступний");
    return registry;
  }

  for (const entry of entries) {
    const viteEntry = viteManifest[toViteKey(entry.moduleFile, appDir)];
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
  const { manifest, projectRoot, appDir, dev } = getServerConfig().views;
  const registry = dev
    ? buildDevRegistry(manifest, projectRoot)
    : await buildProdRegistry(manifest, projectRoot, appDir ?? "");

  console.log(`[model-view] режим: ${dev ? "dev" : "prod"}, маршрутів: ${registry.size}`);

  // Порожній реєстр при непорожньому маніфесті — це не «нема в'ю», а розсинхрон
  // шляхів. Мовчки він виглядає як біла сторінка: оболонка підніметься, а жодна
  // вкладка не відкриється.
  if (registry.size === 0 && manifest.length > 0) {
    console.error(
      `[model-view] жодного з ${manifest.length} в'ю не зіставлено з чанками. ` +
        `Перевір appDir (зараз ${JSON.stringify(appDir ?? "")}) і свіжість dist/.`,
    );
  }

  return registry;
}
