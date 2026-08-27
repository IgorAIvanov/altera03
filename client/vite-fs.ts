// Дрібні файлові помічники пресету Vite, спільні для кількох його плагінів.
//
// Окремим модулем, а не в vite.ts: обхід CSS застосунку потрібен і перевірці
// `@source` (там), і збиранню нотисів (vite-notices.ts). Тримати його в одному
// з двох означало б або цикл імпортів, або другу копію — а розходяться такі
// копії тихо: досить, щоб один з обходів навчився пропускати ще один каталог.
import { join } from "node:path";
import { readdir } from "node:fs/promises";

/** Каталоги, які не є вихідниками застосунку. */
export const SKIP_DIRS = new Set(["node_modules", "vendor", "dist"]);

/** Усі `.css` застосунку, рекурсивно, повз SKIP_DIRS і сховані каталоги. */
export async function collectCssFiles(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await collectCssFiles(full, out);
    else if (entry.name.endsWith(".css")) out.push(full);
  }
  return out;
}
