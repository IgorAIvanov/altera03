/// <reference lib="deno.ns" />
// Директива — з тієї ж причини, що в assets_test.ts: `lib` пакета браузерний.
//
// Фреймворк у нотисах бандла: розпізнавання його модулів і вбудований текст
// ліцензії. Обидва ламаються тихо — збірка зелена, а `@altera/client` просто
// зникає з THIRD-PARTY-NOTICES.md.
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { FRAMEWORK_LICENSE, jsrPackageFromId } from "./vite-notices.ts";

Deno.test("FRAMEWORK_LICENSE збігається з client/LICENSE", async () => {
  const onDisk = (await Deno.readTextFile(join(import.meta.dirname!, "LICENSE")))
    .replaceAll("\r\n", "\n").trim();
  assertEquals(FRAMEWORK_LICENSE, onDisk, "LICENSE змінився — онови FRAMEWORK_LICENSE у vite-notices.ts");
});

Deno.test("модуль фреймворку впізнається в обох формах ідентифікатора", () => {
  const expected = { name: "@altera/client", version: "0.16.17" };

  // Аліас @client → вендорений каталог (Windows і POSIX).
  assertEquals(jsrPackageFromId(String.raw`C:\app\vendor\jsr.io\@altera\client\0.16.17\ui-kit\x.ts`), expected);
  assertEquals(jsrPackageFromId("/app/vendor/jsr.io/@altera/client/0.16.17/ui-kit/x.ts"), expected);

  // Віртуальний модуль плагіна deno.
  assertEquals(
    jsrPackageFromId("\0deno::TypeScript::@altera/client/bus::https://jsr.io/@altera/client/0.16.17/bus/bus.ts#deno"),
    expected,
  );

  // Модулі застосунку й npm — не JSR.
  assertEquals(jsrPackageFromId("/app/app/catalog/bank/bankList.ts"), undefined);
  assertEquals(jsrPackageFromId("/app/node_modules/lit/index.js"), undefined);
});
