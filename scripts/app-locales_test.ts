/**
 * Зібрані локалі застосунку не розійшлися з джерелами.
 *
 * Та сама проба, що `client/assets_test.ts` для теми й `tools/generate-icons-doc_test.ts`
 * для переліку гліфів, і з тієї ж причини: `app/_locales/*.json` виглядає як
 * звичайний файл перекладів, тож правити його руками природно — а наступний
 * `deno task locales:build` цю правку мовчки зітре. Ключ `"//"` у самому файлі
 * попереджає того, хто дивиться; проба ловить того, хто не подивився.
 *
 * Живе в scripts/, а не в tools/: вона звіряє КОНКРЕТНИЙ застосунок цього
 * репозиторію, а `@altera/tools` про застосунок нічого не знає — каталог він
 * отримує аргументом.
 */
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  collectLocaleSources,
  generateAppLocales,
  LOCALE_INDEX_FILE,
  mergeLocales,
} from "@altera/tools/generate-app-locales";

const ROOT = join(import.meta.dirname!, "..");
const APP = join(ROOT, "app");

const normalize = (text: string) => text.replaceAll("\r\n", "\n");

Deno.test("локалі застосунку", async (t) => {
  const built = await generateAppLocales({ appDir: APP, dryRun: true });

  await t.step("склад файлів той самий, що на диску", async () => {
    const onDisk: string[] = [];
    for await (const entry of Deno.readDir(join(APP, "_locales"))) {
      if (entry.isFile && entry.name.endsWith(".json")) onDisk.push(entry.name);
    }
    assertEquals([...built.files.keys()].sort(), onDisk.sort());
  });

  await t.step("файли збігаються з джерелами", async () => {
    for (const [name, text] of built.files) {
      const onDisk = normalize(await Deno.readTextFile(join(APP, "_locales", name)));
      assertEquals(
        normalize(text),
        onDisk,
        `${name} розійшовся з джерелами — виконай \`deno task locales:build\``,
      );
    }
  });

  await t.step("перелік мов названий і збігається зі складом", () => {
    const index = JSON.parse(built.files.get(LOCALE_INDEX_FILE)!) as { locales: string[] };
    assertEquals(index.locales, [...built.locales.keys()].sort());
  });

  await t.step("один ключ — один власник", () => {
    assertEquals(built.collisions, []);
  });

  await t.step("мови застосунку однаково повні", () => {
    // Порожній список, а не «попередження»: у цьому застосунку обидві мови
    // перекладені цілком, і саме це перевіряється. Неповний переклад у
    // ЧУЖОМУ застосунку — не помилка (відсутнє добереться з FALLBACK_LOCALE),
    // тому інструмент лише друкує ⚠, а вимогу ставить проба конкретного дерева.
    assertEquals(built.gaps, []);
  });
});

Deno.test("джерела лежать поряд із кодом, а не в app/_locales", async () => {
  const sources = await collectLocaleSources(APP);
  assertEquals(sources.some((source) => source.owner === "" || source.owner === "."), false);

  // Кожен власник — існуючий каталог застосунку: модель, shared або оболонка.
  for (const source of sources) {
    const stat = await Deno.stat(join(APP, source.owner));
    assertEquals(stat.isDirectory, true, `${source.owner} має бути каталогом`);
  }

  // Склейка джерел дає рівно те, що складає повний прогін.
  const merged = mergeLocales(sources);
  assertEquals(merged.collisions, []);
});
