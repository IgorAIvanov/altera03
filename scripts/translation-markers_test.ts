/**
 * Кожен маркер `@[ключ]`, який називає сервер, має переклад.
 *
 * Це та сама вимога fail-closed, що й з оголошенням прав нестандартної
 * команди: забутий ключ інакше видно лише тому, хто відтворив саме ту відмову,
 * а на екрані він виглядає як `core.documentNotFound` — не мова, а внутрішнє
 * ім'я. Проба знаходить це за секунду й називає файл із рядком.
 *
 * Два дерева й два словники, і межу видно з самої проби: SQL ЯДРА називає
 * ключі, які мусять лежати в локалях фреймворку (`client/_locales`) — тобто
 * нове повідомлення ядра потребує релізу `@altera/client`. SQL і TS-команди
 * ЗАСТОСУНКУ дивляться в обидва словники: свої ключі в них є, але
 * `@[common.fieldRequired]` вони беруть у фреймворку й дублювати його не
 * мусять.
 */
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { missingKeys, scanMarkers } from "@altera/tools/scan-translation-markers";

const ROOT = join(import.meta.dirname!, "..");

async function keysOf(path: string): Promise<string[]> {
  return Object.keys(JSON.parse(await Deno.readTextFile(path)));
}

const format = (uses: Array<{ file: string; line: number; key: string }>) =>
  uses.map((u) => `${u.file}:${u.line}  @[${u.key}]`);

Deno.test("маркери ядра перекладені у локалях фреймворку", async () => {
  const known = new Set(await keysOf(join(ROOT, "client", "_locales", "uk.json")));
  const uses = await scanMarkers(join(ROOT, "server"));

  assertEquals(
    format(missingKeys(uses, known)),
    [],
    "ключ названий у SQL ядра, але його немає в client/_locales — додай і виконай `deno task client:assets`",
  );
});

Deno.test("маркери застосунку перекладені", async () => {
  const known = new Set([
    ...await keysOf(join(ROOT, "client", "_locales", "uk.json")),
    ...await keysOf(join(ROOT, "app", "_locales", "uk.json")),
  ]);
  const uses = await scanMarkers(join(ROOT, "app"));

  assertEquals(
    format(missingKeys(uses, known)),
    [],
    "ключ названий у застосунку, але його немає в локалях — додай у _locales/ власника й виконай `deno task locales:build`",
  );
});

Deno.test("обидві мови знають ті самі ключі маркерів", async () => {
  // Перекладено українською й забуто англійською — та сама вада, просто
  // видно її лише тому, хто перемкнув мову.
  const uses = [
    ...await scanMarkers(join(ROOT, "server")),
    ...await scanMarkers(join(ROOT, "app")),
  ];

  const en = new Set([
    ...await keysOf(join(ROOT, "client", "_locales", "en.json")),
    ...await keysOf(join(ROOT, "app", "_locales", "en.json")),
  ]);

  assertEquals(format(missingKeys(uses, en)), []);
});

Deno.test("маркери справді розставлені — проба не проходить на порожньому місці", async () => {
  // Без цього кроку всі три проби вище лишалися б зеленими, якби сканер
  // перестав щось знаходити взагалі.
  const uses = await scanMarkers(join(ROOT, "server"));
  assertEquals(uses.length > 0, true, "у SQL ядра має бути хоч один маркер");
});
