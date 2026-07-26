/// <reference lib="deno.ns" />
// Проба читає диск, а `lib` пакета — браузерний (`dom`, без `deno.ns`), тому
// директива вище потрібна: інакше `deno check` не бачить ні `Deno`, ні
// `import.meta.dirname`. На сам пакет це не впливає — проби в публікацію не йдуть.
//
// Вбудовані ресурси не розійшлися з вихідниками на диску.
//
// Та сама проба, що й `server/sql/core-sql_test.ts`, і з тієї ж причини: правку
// `theme.css` чи `_locales/*.json` без `deno task client:assets` інакше не видно
// ніяк — застосунок мовчки збереться зі старою темою.
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { THEME_CSS } from "./styles/theme.generated.ts";
import { CLIENT_LOCALES } from "./_locales.generated.ts";

const CLIENT_DIR = import.meta.dirname!;
const normalize = (text: string) => text.replaceAll("\r\n", "\n");

Deno.test("theme.generated.ts збігається з theme.css", async () => {
  const onDisk = normalize(await Deno.readTextFile(join(CLIENT_DIR, "styles", "theme.css")));
  assertEquals(THEME_CSS, onDisk, "тема змінилася — виконай `deno task client:assets`");
});

Deno.test("_locales.generated.ts збігається з _locales/*.json", async (t) => {
  const dir = join(CLIENT_DIR, "_locales");
  const codes: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && entry.name.endsWith(".json")) codes.push(entry.name.slice(0, -5));
  }

  await t.step("склад локалей той самий", () => {
    assertEquals(Object.keys(CLIENT_LOCALES).sort(), codes.sort());
  });

  await t.step("рядки ті самі", async () => {
    for (const code of codes) {
      const onDisk = JSON.parse(await Deno.readTextFile(join(dir, `${code}.json`)));
      assertEquals(
        CLIENT_LOCALES[code],
        onDisk,
        `локаль ${code} змінилася — виконай \`deno task client:assets\``,
      );
    }
  });
});
