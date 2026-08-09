/**
 * Перелік гліфів у скілі не розійшовся з `client/ui-kit/icons.ts`.
 *
 * Та сама проба, що `client/assets_test.ts` для теми, і з тієї ж причини:
 * доданий гліф без `deno task skills:build` інакше не видно ніяк — прикладник
 * отримає вчорашній перелік і намалює власний SVG для іконки, яка вже є.
 */
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { buildIconsDoc, parseIcons } from "./generate-icons-doc.ts";

const ROOT = join(import.meta.dirname!, "..");
const ICONS = join(ROOT, "client", "ui-kit", "icons.ts");
const DOC = join(ROOT, "skills", "src", "screen-design-rules", "icons.md");

const normalize = (text: string) => text.replaceAll("\r\n", "\n");

Deno.test("перелік гліфів скіла", async (t) => {
  const source = await Deno.readTextFile(ICONS);

  await t.step("icons.md збігається з icons.ts", async () => {
    const onDisk = normalize(await Deno.readTextFile(DOC));
    assertEquals(
      normalize(buildIconsDoc(source)),
      onDisk,
      "набір іконок змінився — виконай `deno task skills:build`",
    );
  });

  await t.step("кожен гліф має опис", () => {
    // Fail-closed, як з аудиторією скіла: з імені `save` чи `data` не видно, що
    // гліф малює, тож перелік без описів не відповідає на питання, заради
    // якого існує.
    const undocumented = parseIcons(source).filter((e) => !e.description).map((e) => e.name);
    assertEquals(undocumented, [], "додай коментар над записом у icons.ts");
  });

  await t.step("розібрані всі записи набору", () => {
    // Запобіжник на сам розбір: якщо регулярка перестане ловити форму запису,
    // перелік мовчки схудне, а проба вище цього не помітить — вона звіряє
    // згенероване зі згенерованим.
    const declared = [...source.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*): (?:glyph|record)\(/gm)]
      .map((m) => m[1]);
    assertEquals(parseIcons(source).map((e) => e.name), declared);
  });
});
