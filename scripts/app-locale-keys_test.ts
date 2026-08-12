/**
 * Кожен ключ, названий у `t("…")` в застосунку, має переклад.
 *
 * Названий ключ без перекладу гірший за неперекладений текст: на екрані
 * з'являється внутрішнє ім'я (`header.passwordTitle`), і побачить це не той, хто
 * писав, а користувач. Мовчить тут усе — типи ключа не знають (це просто рядок),
 * збірка зелена, `locales:build` складає рівно те, що є в джерелах, і про
 * ненаписаний рядок знати не може.
 *
 * Спіймано саме так: діалог зміни пароля в `app/header/` кликав сім ключів, яких
 * не було в жодному словнику, — і показував їх іменами. Проба перевіряє те, що
 * перевіряється дешево: рядковий літерал у `t()`.
 *
 * Межі навмисні:
 *
 * - **лише `app/`.** У `client/` ті самі рядки трапляються в прикладах усередині
 *   коментарів і в пробах локалізації, тож звірка там ловила б розмітку тексту, а
 *   не помилку;
 * - **лише літерал.** `t(variable)` і `t(`x.${y}`)` пропускаються: ключ там
 *   складається в рантаймі, і статично його не видно;
 * - **словник — англійський.** Він повний за побудовою (`FALLBACK_LOCALE`), а
 *   повноту решти мов звіряє `app-locales_test.ts`.
 */
import { assertEquals } from "@std/assert";
import { join, relative } from "@std/path";

const ROOT = join(import.meta.dirname!, "..");

/** `t("key")` — але не `.t("key")` і не `someT("key")`. */
const CALL = /(?<![\w.$])t\(\s*"([^"]+)"/g;

async function collectKeys(dir: string, found: Map<string, string>): Promise<void> {
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) {
      // `_locales` — самі словники, `_generated` — вихід кодогенерації.
      if (entry.name !== "_locales" && entry.name !== "_generated") await collectKeys(path, found);
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    const text = await Deno.readTextFile(path);
    for (const match of text.matchAll(CALL)) {
      if (!found.has(match[1])) found.set(match[1], relative(ROOT, path).replaceAll("\\", "/"));
    }
  }
}

Deno.test("кожен ключ t() у застосунку має переклад", async () => {
  const app = JSON.parse(await Deno.readTextFile(join(ROOT, "app", "_locales", "en.json")));
  // Ключі ядра (`common.*`, `core.*`) приходять зі словників фреймворку — у
  // застосунку їх немає й бути не мусить.
  const core = JSON.parse(await Deno.readTextFile(join(ROOT, "client", "_locales", "en.json")));
  const known = new Set([...Object.keys(app), ...Object.keys(core)]);

  const used = new Map<string, string>();
  await collectKeys(join(ROOT, "app"), used);

  const missing = [...used].filter(([key]) => !known.has(key))
    .map(([key, file]) => `${key} (${file})`);

  assertEquals(missing, [], "ключі без перекладу — додай їх у _locales поряд із кодом");
});
